// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoCore.sol";
import "../interfaces/IDoudoPoints.sol";
import "../security/LightweightGuardsUpgradeable.sol";

contract DoudoBundleModuleUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 private constant BUNDLE_MINT = keccak256("BUNDLE_MINT");
    bytes32 private constant BUNDLE_REBATE = keccak256("BUNDLE_REBATE");
    bytes32 private constant FREE_ORDER_REFUND = keccak256("FREE_ORDER_REFUND");
    uint256 private constant MAX_BUNDLE_MINT_AND_REVEAL = 10;

    struct BundleConfig {
        uint256 ticketQuantity;
        uint256 priceInPoints;
        uint256 rebatePoints;
        uint256 consolationDrawCredits;
        bool active;
    }

    struct RebateTierInput {
        uint256 minimumTicketQuantity;
        uint256 rebatePoints;
    }

    struct RebateTier {
        uint256 minimumTicketQuantity;
        uint256 rebatePoints;
    }

    struct OpeningDiscountConfig {
        uint256 ticketLimit;
        uint256 priceInPoints;
        bool active;
    }

    struct TicketPurchaseQuote {
        uint256 basePriceInPoints;
        uint256 openingPriceInPoints;
        uint256 openingQuantity;
        uint256 regularQuantity;
        uint256 grossPriceInPoints;
        uint256 rebatePoints;
    }

    struct FreeOrderChallengeConfig {
        // Keep the original storage member name so upgrades preserve the
        // existing struct layout. Its value now represents the opening window.
        uint256 eligibleLastTicketCount;
        uint256 version;
        bool active;
    }

    struct FreeOrderChallengeRound {
        uint256 seriesID;
        address buyer;
        uint256 configVersion;
        uint256 firstTokenID;
        uint256 ticketQuantity;
        uint256 refundPoints;
        bool processed;
        bool won;
        bool claimed;
    }

    IDoudoCore public core;
    IDoudoPoints public doudoPoints;
    address public redrawModule;

    mapping(uint256 => mapping(uint256 => BundleConfig)) private seriesBundles;
    mapping(uint256 => RebateTier[]) public seriesRebateTiers;
    mapping(uint256 => OpeningDiscountConfig) public seriesOpeningDiscounts;
    mapping(uint256 => uint256) public openingDiscountUsed;

    error InvalidConfig();
    error RevealBatchTooLarge();
    error PriceLimitRequired();
    error PriceExceedsLimit(uint256 actualPriceInPoints, uint256 maxPriceInPoints);
    error InvalidFreeOrderChallenge();
    error FreeOrderChallengeNotEligible();
    error FreeOrderResultNotReady();
    error FreeOrderRefundAlreadyClaimed();

    event RedrawModuleUpdated(address indexed redrawModule);
    event TicketPurchaseMinted(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 priceInPoints,
        bool revealImmediately,
        uint256 firstTokenID
    );
    event BundleRebateTierConfigured(
        uint256 indexed seriesID,
        uint256 indexed tierIndex,
        uint256 minimumTicketQuantity,
        uint256 rebatePoints
    );
    event BundleRebateTiersCleared(uint256 indexed seriesID);
    event TicketPurchaseRebatePaid(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 rebatePoints
    );
    event OpeningDiscountConfigured(
        uint256 indexed seriesID,
        uint256 ticketLimit,
        uint256 priceInPoints
    );
    event OpeningDiscountCleared(uint256 indexed seriesID);
    event OpeningDiscountApplied(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 openingQuantity,
        uint256 regularQuantity,
        uint256 openingPriceInPoints,
        uint256 grossPriceInPoints,
        uint256 rebatePoints
    );
    event FreeOrderChallengePurchased(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 grossPriceInPoints,
        uint256 rebatePoints,
        uint256 refundablePoints,
        uint256 firstTokenID
    );
    event FreeOrderChallengeConfigured(
        uint256 indexed seriesID,
        uint256 indexed version,
        uint256 eligibleFirstTicketCount,
        uint256[] triggerPrizeIDs
    );
    event FreeOrderChallengeCleared(uint256 indexed seriesID, uint256 indexed version);
    event FreeOrderChallengeResult(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed buyer,
        bool won,
        uint256 refundPoints,
        uint256 winningTokenID,
        uint256 winningPrizeID
    );
    event FreeOrderChallengeRefunded(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 refundPoints
    );
    event FreeOrderChallengeRefundDeferred(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 refundPoints
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address coreAddress, address doudoPointsAddress) public initializer {
        if (coreAddress == address(0) || doudoPointsAddress == address(0)) revert InvalidConfig();
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(msg.sender);
        __LightweightGuards_init();

        core = IDoudoCore(coreAddress);
        doudoPoints = IDoudoPoints(doudoPointsAddress);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
    }

    function setRedrawModule(address redrawModule_) external onlyRole(OPERATION_ROLE) {
        redrawModule = redrawModule_;
        emit RedrawModuleUpdated(redrawModule_);
    }

    function setSeriesRebateTiers(
        uint256 seriesID,
        RebateTierInput[] calldata tiers
    ) external onlyRole(OPERATION_ROLE) {
        delete seriesRebateTiers[seriesID];
        emit BundleRebateTiersCleared(seriesID);

        uint256 previousMinimum;
        for (uint256 i = 0; i < tiers.length; i++) {
            uint256 minimumTicketQuantity = tiers[i].minimumTicketQuantity;
            if (
                minimumTicketQuantity == 0 ||
                minimumTicketQuantity <= previousMinimum
            ) revert InvalidConfig();
            seriesRebateTiers[seriesID].push(
                RebateTier({
                    minimumTicketQuantity: minimumTicketQuantity,
                    rebatePoints: tiers[i].rebatePoints
                })
            );
            previousMinimum = minimumTicketQuantity;
            emit BundleRebateTierConfigured(
                seriesID,
                i,
                minimumTicketQuantity,
                tiers[i].rebatePoints
            );
        }
    }

    function seriesRebateTierCount(uint256 seriesID) external view returns (uint256) {
        return seriesRebateTiers[seriesID].length;
    }

    function setSeriesFreeOrderChallenge(
        uint256 seriesID,
        uint256 eligibleFirstTicketCount,
        uint256[] calldata triggerPrizeIDs
    ) external onlyRole(OPERATION_ROLE) {
        (uint256 priceInPoints, , , uint256 totalTicketNumbers) = core
            .seriesMintConfig(seriesID);
        if (
            priceInPoints == 0 ||
            eligibleFirstTicketCount == 0 ||
            eligibleFirstTicketCount > totalTicketNumbers ||
            triggerPrizeIDs.length == 0
        ) {
            revert InvalidFreeOrderChallenge();
        }

        FreeOrderChallengeConfig storage config = _freeOrderChallengeConfigs[seriesID];
        uint256 version = config.version + 1;
        delete seriesFreeOrderTriggerPrizeIDs[seriesID];
        bool hasRemainingTriggerPrize;

        for (uint256 i = 0; i < triggerPrizeIDs.length; i++) {
            uint256 prizeID = triggerPrizeIDs[i];
            if (
                prizeID == 0 ||
                freeOrderTriggerPrizeByVersion[seriesID][version][prizeID]
            ) {
                revert InvalidFreeOrderChallenge();
            }
            uint256 remainingQuantity = core.seriesSubPrizeRemainingQuantity(
                seriesID,
                prizeID
            );
            if (remainingQuantity > 0) hasRemainingTriggerPrize = true;
            freeOrderTriggerPrizeByVersion[seriesID][version][prizeID] = true;
            seriesFreeOrderTriggerPrizeIDs[seriesID].push(prizeID);
        }
        if (!hasRemainingTriggerPrize) revert InvalidFreeOrderChallenge();

        _freeOrderChallengeConfigs[seriesID] = FreeOrderChallengeConfig({
            eligibleLastTicketCount: eligibleFirstTicketCount,
            version: version,
            active: true
        });
        emit FreeOrderChallengeConfigured(
            seriesID,
            version,
            eligibleFirstTicketCount,
            triggerPrizeIDs
        );
    }

    function clearSeriesFreeOrderChallenge(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
        (uint256 priceInPoints, , , ) = core.seriesMintConfig(seriesID);
        if (priceInPoints == 0) revert InvalidFreeOrderChallenge();

        FreeOrderChallengeConfig storage config = _freeOrderChallengeConfigs[seriesID];
        uint256 version = config.version + 1;
        delete seriesFreeOrderTriggerPrizeIDs[seriesID];
        _freeOrderChallengeConfigs[seriesID] = FreeOrderChallengeConfig({
            eligibleLastTicketCount: 0,
            version: version,
            active: false
        });
        emit FreeOrderChallengeCleared(seriesID, version);
    }

    function getSeriesFreeOrderTriggerPrizeIDs(
        uint256 seriesID
    ) external view returns (uint256[] memory) {
        return seriesFreeOrderTriggerPrizeIDs[seriesID];
    }

    function freeOrderChallengeConfigs(
        uint256 seriesID
    ) external view returns (
        uint256 eligibleFirstTicketCount,
        uint256 version,
        bool active
    ) {
        FreeOrderChallengeConfig storage config = _freeOrderChallengeConfigs[seriesID];
        return (
            config.eligibleLastTicketCount,
            config.version,
            config.active && _hasRemainingFreeOrderTriggerPrize(seriesID)
        );
    }

    function isSeriesFreeOrderTriggerPrize(
        uint256 seriesID,
        uint256 prizeID
    ) external view returns (bool) {
        FreeOrderChallengeConfig storage config = _freeOrderChallengeConfigs[seriesID];
        return
            config.active &&
            _hasRemainingFreeOrderTriggerPrize(seriesID) &&
            freeOrderTriggerPrizeByVersion[seriesID][config.version][prizeID];
    }

    function setSeriesOpeningDiscount(
        uint256 seriesID,
        uint256 ticketLimit,
        uint256 priceInPoints
    ) external onlyRole(OPERATION_ROLE) {
        (uint256 basePriceInPoints, , , ) = core.seriesMintConfig(seriesID);
        if (
            basePriceInPoints == 0 ||
            ticketLimit == 0 ||
            priceInPoints == 0 ||
            priceInPoints >= basePriceInPoints ||
            openingDiscountUsed[seriesID] != 0
        ) {
            revert InvalidConfig();
        }

        seriesOpeningDiscounts[seriesID] = OpeningDiscountConfig({
            ticketLimit: ticketLimit,
            priceInPoints: priceInPoints,
            active: true
        });
        emit OpeningDiscountConfigured(seriesID, ticketLimit, priceInPoints);
    }

    function clearSeriesOpeningDiscount(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
        OpeningDiscountConfig storage config = seriesOpeningDiscounts[seriesID];
        if (!config.active || openingDiscountUsed[seriesID] != 0) {
            revert InvalidConfig();
        }

        delete seriesOpeningDiscounts[seriesID];
        emit OpeningDiscountCleared(seriesID);
    }

    function quoteTicketPurchase(
        uint256 seriesID,
        uint256 ticketQuantity
    )
        external
        view
        returns (
            uint256 openingQuantity,
            uint256 regularQuantity,
            uint256 grossPriceInPoints,
            uint256 rebatePoints
        )
    {
        TicketPurchaseQuote memory quote = _quoteTicketPurchase(seriesID, ticketQuantity);
        return (
            quote.openingQuantity,
            quote.regularQuantity,
            quote.grossPriceInPoints,
            quote.rebatePoints
        );
    }

    function mintTickets(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately
    ) external nonReentrant returns (uint256 firstTokenID) {
        OpeningDiscountConfig storage config = seriesOpeningDiscounts[seriesID];
        if (config.active && openingDiscountUsed[seriesID] < config.ticketLimit) {
            revert PriceLimitRequired();
        }
        (firstTokenID, ) = _mintTickets(
            seriesID,
            luckyNumbers,
            revealImmediately,
            type(uint256).max,
            false
        );
    }

    function mintTicketsWithPriceLimit(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately,
        uint256 maxTotalPriceInPoints
    ) external nonReentrant returns (uint256 firstTokenID) {
        (firstTokenID, ) = _mintTickets(
            seriesID,
            luckyNumbers,
            revealImmediately,
            maxTotalPriceInPoints,
            false
        );
    }

    function mintFreeOrderChallenge(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        uint256 maxTotalPriceInPoints
    ) external nonReentrant returns (uint256 firstTokenID, uint256 requestId) {
        uint256 ticketQuantity = luckyNumbers.length;
        if (ticketQuantity == 0 || ticketQuantity > MAX_BUNDLE_MINT_AND_REVEAL) {
            revert InvalidFreeOrderChallenge();
        }
        FreeOrderChallengeConfig storage config = _freeOrderChallengeConfigs[seriesID];
        (
            ,
            ,
            uint256 remainingTicketNumbers,
            uint256 totalTicketNumbers
        ) = core.seriesMintConfig(seriesID);
        uint256 soldTicketNumbers = totalTicketNumbers - remainingTicketNumbers;
        if (
            !config.active ||
            !_hasRemainingFreeOrderTriggerPrize(seriesID) ||
            soldTicketNumbers + ticketQuantity > config.eligibleLastTicketCount
        ) {
            revert FreeOrderChallengeNotEligible();
        }
        TicketPurchaseQuote memory quote = _quoteTicketPurchase(seriesID, ticketQuantity);
        (firstTokenID, requestId) = _mintTickets(
            seriesID,
            luckyNumbers,
            true,
            maxTotalPriceInPoints,
            true
        );

        uint256 refundablePoints = quote.grossPriceInPoints > quote.rebatePoints
            ? quote.grossPriceInPoints - quote.rebatePoints
            : 0;
        freeOrderChallengeRounds[requestId] = FreeOrderChallengeRound({
            seriesID: seriesID,
            buyer: msg.sender,
            configVersion: config.version,
            firstTokenID: firstTokenID,
            ticketQuantity: ticketQuantity,
            refundPoints: refundablePoints,
            processed: false,
            won: false,
            claimed: false
        });
        emit FreeOrderChallengePurchased(
            requestId,
            seriesID,
            msg.sender,
            ticketQuantity,
            quote.grossPriceInPoints,
            quote.rebatePoints,
            refundablePoints,
            firstTokenID
        );
    }

    function _hasRemainingFreeOrderTriggerPrize(
        uint256 seriesID
    ) internal view returns (bool) {
        uint256[] storage triggerPrizeIDs = seriesFreeOrderTriggerPrizeIDs[seriesID];
        for (uint256 i = 0; i < triggerPrizeIDs.length; i++) {
            uint256 remainingQuantity = core.seriesSubPrizeRemainingQuantity(
                seriesID,
                triggerPrizeIDs[i]
            );
            if (remainingQuantity > 0) return true;
        }
        return false;
    }

    function _mintTickets(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately,
        uint256 maxTotalPriceInPoints,
        bool freeOrderChallenge
    ) internal returns (uint256 firstTokenID, uint256 challengeRequestId) {
        uint256 ticketQuantity = luckyNumbers.length;
        if (ticketQuantity == 0) revert InvalidConfig();
        if (revealImmediately && ticketQuantity > MAX_BUNDLE_MINT_AND_REVEAL) {
            revert RevealBatchTooLarge();
        }

        (, bool useLuckyNumber, , ) = core.seriesMintConfig(seriesID);
        for (uint256 i = 0; i < ticketQuantity; i++) {
            if (useLuckyNumber ? luckyNumbers[i] == 0 : luckyNumbers[i] != 0) {
                revert InvalidConfig();
            }
        }

        TicketPurchaseQuote memory quote = _quoteTicketPurchase(seriesID, ticketQuantity);
        if (quote.grossPriceInPoints > maxTotalPriceInPoints) {
            revert PriceExceedsLimit(quote.grossPriceInPoints, maxTotalPriceInPoints);
        }
        if (quote.openingQuantity != 0) {
            openingDiscountUsed[seriesID] += quote.openingQuantity;
        }

        doudoPoints.burnFromWithReason(msg.sender, quote.grossPriceInPoints, BUNDLE_MINT);
        firstTokenID = _mintPricedSegments(seriesID, luckyNumbers, quote);

        if (revealImmediately) {
            uint256[] memory tokenIDs = new uint256[](ticketQuantity);
            unchecked {
                for (uint256 i; i < ticketQuantity; ++i) {
                    tokenIDs[i] = firstTokenID + i;
                }
            }
            if (freeOrderChallenge) {
                challengeRequestId = core.reveal(seriesID, tokenIDs);
            } else {
                core.reveal(seriesID, tokenIDs);
            }
        }

        if (quote.rebatePoints != 0) {
            doudoPoints.mintWithReason(msg.sender, quote.rebatePoints, BUNDLE_REBATE);
            emit TicketPurchaseRebatePaid(
                seriesID,
                msg.sender,
                quote.regularQuantity,
                quote.rebatePoints
            );
        }

        if (quote.openingQuantity != 0) {
            emit OpeningDiscountApplied(
                seriesID,
                msg.sender,
                quote.openingQuantity,
                quote.regularQuantity,
                quote.openingPriceInPoints,
                quote.grossPriceInPoints,
                quote.rebatePoints
            );
        }

        emit TicketPurchaseMinted(
            seriesID,
            msg.sender,
            ticketQuantity,
            quote.grossPriceInPoints,
            revealImmediately,
            firstTokenID
        );
    }

    function settleFreeOrderChallenge(uint256 requestId) external nonReentrant {
        FreeOrderChallengeRound storage round = freeOrderChallengeRounds[requestId];
        if (round.buyer == address(0) || round.processed) revert InvalidFreeOrderChallenge();
        _processFreeOrderChallengeResult(requestId, round);
        if (round.won) _trySettleFreeOrderRefund(requestId, round);
    }

    function _processFreeOrderChallengeResult(
        uint256 requestId,
        FreeOrderChallengeRound storage round
    ) internal {
        bool won;
        uint256 winningTokenID;
        uint256 winningPrizeID;
        for (uint256 i = 0; i < round.ticketQuantity; i++) {
            uint256 tokenID = round.firstTokenID + i;
            (uint256 ticketSeriesID, uint256 prizeID, , bool revealed, ) = core
                .ticketStatusDetail(tokenID);
            if (ticketSeriesID != round.seriesID) revert InvalidFreeOrderChallenge();
            if (!revealed) revert FreeOrderResultNotReady();
            if (
                !won &&
                freeOrderTriggerPrizeByVersion[round.seriesID][round.configVersion][prizeID]
            ) {
                won = true;
                winningTokenID = tokenID;
                winningPrizeID = prizeID;
            }
        }

        round.processed = true;
        round.won = won;
        emit FreeOrderChallengeResult(
            requestId,
            round.seriesID,
            round.buyer,
            won,
            won ? round.refundPoints : 0,
            winningTokenID,
            winningPrizeID
        );
    }

    function claimFreeOrderChallengeRefund(uint256 requestId) external nonReentrant {
        FreeOrderChallengeRound storage round = freeOrderChallengeRounds[requestId];
        if (round.buyer != msg.sender) revert InvalidFreeOrderChallenge();
        if (!round.processed) {
            _processFreeOrderChallengeResult(requestId, round);
        }
        if (!round.won) return;
        if (round.claimed) revert FreeOrderRefundAlreadyClaimed();

        round.claimed = true;
        if (
            round.refundPoints != 0 &&
            !doudoPoints.mintWithReason(round.buyer, round.refundPoints, FREE_ORDER_REFUND)
        ) {
            revert InvalidFreeOrderChallenge();
        }
        emit FreeOrderChallengeRefunded(
            requestId,
            round.seriesID,
            round.buyer,
            round.refundPoints
        );
    }

    function _trySettleFreeOrderRefund(
        uint256 requestId,
        FreeOrderChallengeRound storage round
    ) internal {
        if (round.refundPoints == 0) {
            round.claimed = true;
            emit FreeOrderChallengeRefunded(requestId, round.seriesID, round.buyer, 0);
            return;
        }

        try
            doudoPoints.mintWithReason(round.buyer, round.refundPoints, FREE_ORDER_REFUND)
        returns (bool minted) {
            if (minted) {
                round.claimed = true;
                emit FreeOrderChallengeRefunded(
                    requestId,
                    round.seriesID,
                    round.buyer,
                    round.refundPoints
                );
                return;
            }
        } catch {}

        emit FreeOrderChallengeRefundDeferred(
            requestId,
            round.seriesID,
            round.buyer,
            round.refundPoints
        );
    }

    function _quoteTicketPurchase(
        uint256 seriesID,
        uint256 ticketQuantity
    ) internal view returns (TicketPurchaseQuote memory quote) {
        if (ticketQuantity == 0) revert InvalidConfig();
        (quote.basePriceInPoints, , , ) = core.seriesMintConfig(seriesID);
        if (quote.basePriceInPoints == 0) revert InvalidConfig();

        OpeningDiscountConfig storage config = seriesOpeningDiscounts[seriesID];
        quote.openingPriceInPoints = config.priceInPoints;
        uint256 used = openingDiscountUsed[seriesID];
        if (config.active && used < config.ticketLimit) {
            uint256 openingRemaining = config.ticketLimit - used;
            quote.openingQuantity = ticketQuantity < openingRemaining
                ? ticketQuantity
                : openingRemaining;
        }
        quote.regularQuantity = ticketQuantity - quote.openingQuantity;
        quote.rebatePoints = _rebateFor(seriesID, quote.regularQuantity);
        quote.grossPriceInPoints =
            quote.openingQuantity * config.priceInPoints +
            quote.regularQuantity * quote.basePriceInPoints;
    }

    function _mintPricedSegments(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        TicketPurchaseQuote memory quote
    ) internal returns (uint256 firstTokenID) {
        uint256 cursor;
        if (quote.openingQuantity != 0) {
            firstTokenID = core.moduleMintUnrevealed(
                msg.sender,
                seriesID,
                _sliceLuckyNumbers(luckyNumbers, 0, quote.openingQuantity),
                quote.openingPriceInPoints,
                true
            );
            cursor = quote.openingQuantity;
        }

        uint256 refundableRebate = quote.rebatePoints;
        uint256 regularGrossPrice = quote.regularQuantity * quote.basePriceInPoints;
        if (refundableRebate > regularGrossPrice) {
            refundableRebate = regularGrossPrice;
        }
        if (quote.regularQuantity != 0) {
            uint256 discountPerRegularTicket = refundableRebate / quote.regularQuantity;
            uint256 discountRemainder = refundableRebate % quote.regularQuantity;
            uint256 paidPerRegularTicket = quote.basePriceInPoints - discountPerRegularTicket;

            if (discountRemainder != 0) {
                uint256 tokenID = core.moduleMintUnrevealed(
                    msg.sender,
                    seriesID,
                    _sliceLuckyNumbers(luckyNumbers, cursor, discountRemainder),
                    paidPerRegularTicket - 1,
                    true
                );
                if (cursor == 0) firstTokenID = tokenID;
                cursor += discountRemainder;
            }

            uint256 regularRemainder = quote.regularQuantity - discountRemainder;
            if (regularRemainder != 0) {
                uint256 tokenID = core.moduleMintUnrevealed(
                    msg.sender,
                    seriesID,
                    _sliceLuckyNumbers(luckyNumbers, cursor, regularRemainder),
                    paidPerRegularTicket,
                    true
                );
                if (cursor == 0) firstTokenID = tokenID;
            }
        }
    }

    function _sliceLuckyNumbers(
        uint16[] calldata luckyNumbers,
        uint256 start,
        uint256 length
    ) internal pure returns (uint16[] memory sliced) {
        sliced = new uint16[](length);
        for (uint256 i = 0; i < length; i++) {
            sliced[i] = luckyNumbers[start + i];
        }
    }

    function _rebateFor(
        uint256 seriesID,
        uint256 ticketQuantity
    ) internal view returns (uint256) {
        RebateTier[] storage tiers = seriesRebateTiers[seriesID];
        uint256 length = tiers.length;

        uint256 rebate;
        for (uint256 i = 0; i < length; i++) {
            RebateTier storage tier = tiers[i];
            if (ticketQuantity < tier.minimumTicketQuantity) break;
            rebate = tier.rebatePoints;
        }
        return rebate;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    /// @custom:oz-renamed-from freeOrderChallengeConfigs
    mapping(uint256 => FreeOrderChallengeConfig) private _freeOrderChallengeConfigs;
    mapping(uint256 => mapping(uint256 => mapping(uint256 => bool))) private freeOrderTriggerPrizeByVersion;
    mapping(uint256 => uint256[]) private seriesFreeOrderTriggerPrizeIDs;
    mapping(uint256 => FreeOrderChallengeRound) public freeOrderChallengeRounds;

    uint256[38] private __gap;
}
