// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./security/LightweightGuardsUpgradeable.sol";
import "./fixed-probability/FixedProbabilityTypes.sol";
import "./libraries/FixedProbabilityConfigValidation.sol";
import "./libraries/FixedProbabilitySettlement.sol";
import "./libraries/FixedProbabilityBuybackValidation.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "./interfaces/IDoudoVRFCallback.sol";
import "./interfaces/IDoudoVRFRouter.sol";

interface IFixedProbabilityMembershipUpgradeableV3 {
    function effectiveLevelOf(address wallet) external view returns (uint8);

    function recordConsumption(
        address wallet,
        uint256 pointsConsumed,
        bytes32 authorizationId
    )
        external
        returns (
            uint256 rewardPoints,
            uint8 previousLevel,
            uint8 newLevel,
            uint64 expiresAt
        );

    function reverseConsumption(
        address wallet,
        uint256 pointsConsumed,
        bytes32 reversalId
    )
        external
        returns (
            uint8 previousLevel,
            uint8 newLevel,
            uint256 currentQualifyingSpend,
            uint256 lifetimeSpend
        );
}

/// @title FixedProbabilityLotteryV3Upgradeable
/// @notice Each purchase immediately mints one ERC-721 per draw. Chainlink VRF
/// through DoudoVRFRouter later reveals the prize on those same NFTs. There is
/// no buyer claim step; exchange remains the only post-reveal buyer action.
contract FixedProbabilityLotteryV3Upgradeable is
    ERC721Upgradeable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable,
    FixedProbabilityTypes,
    IDoudoVRFCallback
{
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant BUYBACK_AUTHORIZER_ROLE = keccak256("BUYBACK_AUTHORIZER_ROLE");
    uint256 public constant BUYBACK_PROTOCOL_VERSION = 1;
    uint256 public constant MAX_BUYBACK_BATCH = 50;
    error InvalidBuybackAuthorization();
    error InvalidBuybackItems();
    event PrizeBuybackBurned(
        bytes32 indexed batchId, address indexed buyer, address indexed coreAddress,
        uint256[] tokenIds, uint256[] points, uint256 totalPoints, bytes32 quoteHash
    );


    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SERIES_DOMAIN = keccak256("FIXED_PROBABILITY_SERIES_V3");
    bytes32 public constant MEMBERSHIP_DOMAIN = keccak256("FIXED_PROBABILITY_MEMBERSHIP_V3");
    uint16 public constant MAX_BATCH = 10;
    uint256 public constant TOTAL_WEIGHT = 10_000;
    uint16 public constant NO_TRIGGER = type(uint16).max;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant AUTHORIZATION_NAME_HASH = keccak256("FixedProbabilityLottery");
    bytes32 private constant AUTHORIZATION_VERSION_HASH = keccak256("3");
    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256(
        "DrawAuthorization(bytes32 authorizationId,address buyer,uint256 seriesId,bytes32 configHash,uint16 quantity,uint256 grossPoints,uint256 rebatePoints,uint256 netPoints,bool freeOrderChallenge,bytes32 eligibilityKey,uint256 deadline)"
    );

    IDoudoVRFRouter public router;
    IFixedProbabilityMembershipUpgradeableV3 public membershipV2;
    address public authorizationSigner;
    address public operator;

    uint256 public nextSeriesId;
    uint256 public nextOrderId;
    uint256 public nextDrawId;
    mapping(uint256 => Series) private _series;
    mapping(uint256 => Order) private _orders;
    mapping(uint256 => Draw) internal _draws;
    mapping(uint256 => uint256) public requestToOrder;
    mapping(bytes32 => bool) public authorizationUsed;
    mapping(bytes32 => mapping(bytes32 => uint256)) public eligibleDrawsUsed;
    mapping(bytes32 => bytes32) public eligibilityScopePolicy;
    mapping(bytes32 => uint256) public eligibilityScopeMaximum;

    mapping(bytes32 => bool) public consumed;
    uint256[49] private __gap;

    error AccountingAlreadyFinalized();
    error AuthorizationAlreadyUsed();
    error AuthorizationExpired();
    error DrawCapExceeded();
    error EligibilityScopeConflict();
    error FreeOrderNotEligible();
    error Ineligible();
    error InvalidAuthorization();
    error InvalidConfig();
    error InvalidOrderState();
    error InvalidQuantity();
    error InvalidSeriesStatus();
    error NotTheTokenOwner();
    error OnlyBuyer();
    error OnlyRouter(address caller);
    error TokenAlreadyExchanged();
    error TokenNotRevealed();
    error UnknownDraw();
    error UnknownOrder();
    error UnknownSeries();

    event SeriesCreated(uint256 indexed seriesId, bytes32 indexed configHash, bytes configData);
    event SeriesStatusChanged(
        uint256 indexed seriesId,
        SeriesStatus previousStatus,
        SeriesStatus nextStatus
    );
    event EligibilityScopeRegistered(
        bytes32 indexed scope,
        bytes32 indexed policyId,
        uint256 maxEligibleDraws
    );
    event EligibilityConsumed(
        bytes32 indexed scope,
        bytes32 indexed eligibilityKey,
        uint256 indexed orderId,
        uint16 quantity,
        uint256 usedAfter
    );
    event OrderRequested(
        uint256 indexed orderId,
        uint256 indexed requestId,
        address indexed buyer,
        uint256 seriesId,
        bytes32 configHash,
        bytes32 authorizationId,
        uint16 quantity,
        uint256 firstDrawId,
        uint256 grossPoints,
        uint256 rebatePoints,
        uint256 netPoints,
        bool freeOrderChallenge,
        bytes32 eligibilityKey,
        uint8 levelAtRequest,
        uint256 acceptedDrawsBefore
    );
    event RandomnessStored(uint256 indexed orderId, uint256 indexed requestId, uint256[] randomWords);
    event DrawSettled(
        uint256 indexed orderId,
        uint256 indexed drawId,
        uint16 drawIndex,
        uint256 roll,
        uint256 prizeId
    );
    event OrderSettled(
        uint256 indexed orderId,
        bool freeOrderWon,
        uint16 firstTriggerIndex,
        uint256 refundPoints
    );
    event OrderAccountingFinalized(
        uint256 indexed orderId,
        address indexed buyer,
        bytes32 indexed membershipConsumptionId,
        uint256 finalPointsConsumed,
        uint256 refundPoints,
        uint256 membershipRewardPoints,
        uint8 previousLevel,
        uint8 newLevel,
        uint64 expiresAt
    );

    // Existing user history and asset views already understand these shapes.
    event TicketPurchaseMinted(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 priceInPoints,
        bool revealImmediately,
        uint256 firstTokenID
    );
    event DatabasePointsPurchaseMinted(
        bytes32 indexed authorizationId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 grossPoints,
        uint256 rebatePoints,
        uint256 netPointsConsumed,
        uint256 membershipRewardPoints,
        bool revealImmediately,
        bool freeOrderChallenge,
        uint256 firstTokenID,
        uint256 challengeRequestId
    );
    event DatabasePointsRebateEntitled(
        bytes32 indexed authorizationId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 rebatePoints
    );
    event DatabasePointsFreeOrderChallengeRefunded(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 refundPoints
    );
    event NewTicketStatus(
        uint256 indexed tokenID,
        uint256 indexed seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed,
        address owner,
        uint16 luckyNumber
    );
    event UpdateTicketStatus(
        uint256 tokenID,
        uint256 seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address routerAddress, address signer, address operatorAddress,
        address membershipAddress, address initialAdmin, address upgrader
    ) external initializer {
        if(routerAddress==address(0) || signer==address(0) || operatorAddress==address(0) ||
            membershipAddress==address(0) || initialAdmin==address(0) || upgrader==address(0)) revert InvalidConfig();
        __ERC721_init("DOUDO Fixed Probability", "DOUDO-FP");
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(initialAdmin);
        __LightweightGuards_init();
        router=IDoudoVRFRouter(routerAddress);
        authorizationSigner=signer;
        operator=operatorAddress;
        membershipV2=IFixedProbabilityMembershipUpgradeableV3(membershipAddress);
        _grantRole(OPERATOR_ROLE,operatorAddress);
        _grantRole(UPGRADER_ROLE,upgrader);
        nextSeriesId=1;nextOrderId=1;nextDrawId=1;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    function createSeries(SeriesConfig calldata config) external onlyRole(OPERATOR_ROLE) {
        uint256 seriesId = nextSeriesId++;
        bytes32 configHash=FixedProbabilityConfigValidation.validateAndHash(seriesId,config);
        if (config.gateMode == 2 || config.gateMode == 3) {
            bytes32 registered = eligibilityScopePolicy[config.eligibilityScope];
            if (
                registered != bytes32(0) &&
                (registered != config.eligibilityPolicyId ||
                    eligibilityScopeMaximum[config.eligibilityScope] != config.maxEligibleDraws)
            ) revert EligibilityScopeConflict();
            if (registered == bytes32(0)) {
                eligibilityScopePolicy[config.eligibilityScope] = config.eligibilityPolicyId;
                eligibilityScopeMaximum[config.eligibilityScope] = config.maxEligibleDraws;
                emit EligibilityScopeRegistered(
                    config.eligibilityScope,
                    config.eligibilityPolicyId,
                    config.maxEligibleDraws
                );
            }
        }
        Series storage series = _series[seriesId];
        series.config = config;
        series.configHash = configHash;
        series.status = SeriesStatus.DRAFT;
        emit SeriesCreated(seriesId, series.configHash, abi.encode(config));
        emit SeriesStatusChanged(seriesId, SeriesStatus.NONE, SeriesStatus.DRAFT);
    }

    function setSeriesStatus(
        uint256 seriesId,
        SeriesStatus nextStatus
    ) external onlyRole(OPERATOR_ROLE) {
        Series storage series = _series[seriesId];
        SeriesStatus previous = series.status;
        if (
            previous == SeriesStatus.NONE ||
            nextStatus == SeriesStatus.NONE ||
            previous == SeriesStatus.CLOSED ||
            previous == nextStatus
        ) revert InvalidSeriesStatus();
        series.status = nextStatus;
        emit SeriesStatusChanged(seriesId, previous, nextStatus);
    }

    function requestDraws(
        DrawAuthorization calldata authorization,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        if (msg.sender != authorization.buyer) revert OnlyBuyer();
        if (block.timestamp > authorization.deadline) revert AuthorizationExpired();
        if (authorizationUsed[authorization.authorizationId]) revert AuthorizationAlreadyUsed();
        Series storage series = _series[authorization.seriesId];
        if (series.status != SeriesStatus.ACTIVE) revert InvalidSeriesStatus();
        if (
            authorization.authorizationId == bytes32(0) ||
            authorization.configHash != series.configHash ||
            !SignatureChecker.isValidSignatureNow(
                authorizationSigner,
                authorizationDigest(authorization),
                signature
            )
        ) revert InvalidAuthorization();
        (
            uint256 grossPoints,
            uint256 rebatePoints,
            uint256 netPoints
        ) = quoteOrder(authorization.seriesId, authorization.quantity);
        if (
            grossPoints != authorization.grossPoints ||
            rebatePoints != authorization.rebatePoints ||
            netPoints != authorization.netPoints
        ) revert InvalidAuthorization();

        uint256 acceptedBefore = series.acceptedDraws;
        uint256 acceptedAfter = acceptedBefore + authorization.quantity;
        if (series.config.drawCap != 0 && acceptedAfter > series.config.drawCap) {
            revert DrawCapExceeded();
        }
        uint8 level = _checkEligibility(series.config, authorization, nextOrderId);
        if (
            authorization.freeOrderChallenge &&
            (series.config.freeOrderMode == 0 ||
                netPoints == 0 ||
                (series.config.freeOrderMode == 1 &&
                    acceptedAfter > series.config.freeOrderFirstDraws))
        ) revert FreeOrderNotEligible();

        authorizationUsed[authorization.authorizationId] = true;
        series.acceptedDraws = acceptedAfter;
        orderId = nextOrderId++;
        uint256 firstDrawId = nextDrawId;
        nextDrawId += authorization.quantity;
        Order storage order = _orders[orderId];
        FixedProbabilitySettlement.prepareOrder(order,authorization,orderId,firstDrawId,acceptedBefore,level,address(membershipV2));

        uint256 requestId = router.requestRandomWords(address(this), uint32(authorization.quantity));
        order.requestId = requestId;
        requestToOrder[requestId] = orderId;
        FixedProbabilitySettlement.emitRequested(order);
        for (uint16 i = 0; i < authorization.quantity; i++) {
            uint256 tokenId = firstDrawId + i;
            _draws[tokenId] = Draw({
                drawId: tokenId,
                orderId: orderId,
                drawIndex: i,
                roll: 0,
                prizeId: 0,
                tokenId: tokenId,
                recipient: msg.sender,
                exchanged: false
            });
            _safeMint(msg.sender, tokenId);
            emit NewTicketStatus(tokenId, authorization.seriesId, 0, false, false, msg.sender, 0);
        }
        FixedProbabilitySettlement.emitPurchase(order);
    }

    function fulfillRandomWordsFromRouter(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external override nonReentrant {
        if (msg.sender != address(router)) revert OnlyRouter(msg.sender);
        FixedProbabilitySettlement.fulfill(_orders,_series,_draws,requestToOrder,requestId,randomWords);
    }

    function settleOrder(uint256 orderId) external view {
        if (_orders[orderId].state != OrderState.SETTLED) revert InvalidOrderState();
    }

    function finalizeOrderAccounting(uint256 orderId) external nonReentrant {
        FixedProbabilitySettlement.finalizeAccounting(_orders,address(membershipV2),orderId);
    }

    function exchangePrize(uint256[] calldata tokenIDs) external whenNotPaused {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenId = tokenIDs[i];
            if (ownerOf(tokenId) != msg.sender) revert NotTheTokenOwner();
            Draw storage draw = _draws[tokenId];
            if (draw.prizeId == 0) revert TokenNotRevealed();
            if (draw.exchanged) revert TokenAlreadyExchanged();
            draw.exchanged = true;
            emit UpdateTicketStatus(
                tokenId,
                _orders[draw.orderId].seriesId,
                draw.prizeId,
                true,
                true
            );
        }
    }

    function quoteOrder(
        uint256 seriesId,
        uint16 quantity
    ) public view returns (uint256 grossPoints, uint256 rebatePoints, uint256 netPoints) {
        SeriesConfig storage config = _series[seriesId].config;
        if (quantity == 0 || quantity > config.maxBatchSize) revert InvalidQuantity();
        grossPoints = config.pricePoints * quantity;
        for (uint256 i = 0; i < config.discountQuantities.length; i++) {
            if (quantity >= config.discountQuantities[i]) {
                rebatePoints = config.discountPoints[i];
            }
        }
        netPoints = grossPoints - rebatePoints;
    }

    function previewPrize(
        uint256 seriesId,
        uint256 randomWord
    ) external view returns (uint256 roll, uint256 prizeId) {
        roll = randomWord % TOTAL_WEIGHT;
        prizeId = _prizeForRoll(_series[seriesId].config, roll);
    }

    function getSeries(uint256 seriesId) external view returns (Series memory) {
        if (_series[seriesId].status == SeriesStatus.NONE) revert UnknownSeries();
        return _series[seriesId];
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        if (_orders[orderId].orderId == 0) revert UnknownOrder();
        return _orders[orderId];
    }

    function getDraw(uint256 drawId) external view returns (Draw memory) {
        if (_draws[drawId].drawId == 0) revert UnknownDraw();
        return _draws[drawId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireMinted(tokenId);
        return _series[_orders[_draws[tokenId].orderId].seriesId].config.contentURI;
    }

    function setAuthorizationSigner(address signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidConfig();
        authorizationSigner = signer;
    }

    function setOperator(address nextOperator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (nextOperator == address(0)) revert InvalidConfig();
        _revokeRole(OPERATOR_ROLE, operator);
        operator = nextOperator;
        _grantRole(OPERATOR_ROLE, nextOperator);
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    function authorizationDigest(
        DrawAuthorization calldata authorization
    ) public view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                AUTHORIZATION_NAME_HASH,
                AUTHORIZATION_VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                AUTHORIZATION_TYPEHASH,
                authorization.authorizationId,
                authorization.buyer,
                authorization.seriesId,
                authorization.configHash,
                authorization.quantity,
                authorization.grossPoints,
                authorization.rebatePoints,
                authorization.netPoints,
                authorization.freeOrderChallenge,
                authorization.eligibilityKey,
                authorization.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /// @dev ERC-5267 compatible domain inspection used by backend readiness checks.
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name_,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        fields = hex"0f";
        name_ = "FixedProbabilityLottery";
        version = "3";
        chainId = block.chainid;
        verifyingContract = address(this);
        salt = bytes32(0);
        extensions = new uint256[](0);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Upgradeable) returns (bool) {
        return interfaceId == 0x7965db0b || super.supportsInterface(interfaceId);
    }

    function _checkEligibility(
        SeriesConfig storage config,
        DrawAuthorization calldata authorization,
        uint256 orderId
    ) internal returns (uint8 level) {
        level = membershipV2.effectiveLevelOf(authorization.buyer);
        if (
            (config.gateMode == 1 || config.gateMode == 3) &&
            level < config.minMemberLevel
        ) revert Ineligible();
        if (config.gateMode == 2 || config.gateMode == 3) {
            if (authorization.eligibilityKey == bytes32(0)) revert Ineligible();
            uint256 usedAfter =
                eligibleDrawsUsed[config.eligibilityScope][authorization.eligibilityKey] +
                authorization.quantity;
            if (usedAfter > config.maxEligibleDraws) revert Ineligible();
            eligibleDrawsUsed[config.eligibilityScope][authorization.eligibilityKey] = usedAfter;
            emit EligibilityConsumed(
                config.eligibilityScope,
                authorization.eligibilityKey,
                orderId,
                authorization.quantity,
                usedAfter
            );
        } else if (authorization.eligibilityKey != bytes32(0)) {
            revert Ineligible();
        }
    }

    function _prizeForRoll(
        SeriesConfig storage config,
        uint256 roll
    ) internal view returns (uint256) {
        uint256 cursor;
        for (uint256 i = 0; i < config.prizeIds.length; i++) {
            cursor += config.weights[i];
            if (roll < cursor) return config.prizeIds[i];
        }
        revert InvalidConfig();
    }

    function _contains(
        uint256[] storage values,
        uint256 needle
    ) internal view returns (bool) {
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] == needle) return true;
        }
        return false;
    }

    function buybackAuthorizationDigest(BuybackAuthorization calldata auth) public view returns (bytes32) {
        return FixedProbabilityBuybackValidation.digest(auth);
    }

    function buyback(
        BuybackAuthorization calldata auth, uint256[] calldata tokenIds,
        uint256[] calldata points, bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if(consumed[auth.batchId]) revert InvalidBuybackAuthorization();
        address authorizer=FixedProbabilityBuybackValidation.validate(auth,tokenIds,points,signature);
        if(!hasRole(BUYBACK_AUTHORIZER_ROLE,authorizer)) revert InvalidBuybackAuthorization();
        consumed[auth.batchId] = true;
        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            if (ownerOf(tokenId) != msg.sender) revert NotTheTokenOwner();
            if (_draws[tokenId].prizeId == 0) revert TokenNotRevealed();
            if (_draws[tokenId].exchanged) revert TokenAlreadyExchanged();
            _burn(tokenId);
        }
        emit PrizeBuybackBurned(auth.batchId, msg.sender, address(this), tokenIds, points, auth.totalPoints, auth.quoteHash);
    }
}
