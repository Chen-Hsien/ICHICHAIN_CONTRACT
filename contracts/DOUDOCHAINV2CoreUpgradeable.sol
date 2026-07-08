// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./interfaces/IDoudoPoints.sol";
import "./interfaces/IDoudoSeriesOps.sol";
import "./interfaces/IDoudoVRFCallback.sol";
import "./interfaces/IDoudoVRFRouter.sol";
import "./helpers/DoudoCoreTypes.sol";
import "./helpers/DoudoPrizeDrawLib.sol";
import "./helpers/DoudoTokenURILib.sol";
import "./security/LightweightGuardsUpgradeable.sol";

contract DOUDOCHAINV2CoreUpgradeable is
    Initializable,
    ERC721AUpgradeable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable,
    DoudoCoreTypes,
    IDoudoVRFCallback
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant ADMINMINT_ROLE = keccak256("ADMINMINT_ROLE");
    bytes32 public constant MODULE_ROLE = keccak256("MODULE_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 private constant MAX_REVEAL_BATCH = 20;
    uint256 private constant LAST_PRIZE_ID = 999;
    uint32 private constant DEFAULT_LAST_PRIZE_QUANTITY = 1;

    enum RequestKind {
        None,
        Reveal,
        LastPrize
    }

    struct SeriesInput {
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 priceInPoints;
        uint256 priceInTWD;
        uint256 estimateDeliverTime;
        string exchangeTokenURI;
        string unrevealTokenURI;
        string revealTokenURI;
        string seriesMetaDataURI;
        bool isPreOrder;
        bool useLuckyNumber;
        uint256 maxPerWallet;
        uint8 packingType;
        uint8 sourceType;
    }

    struct Series {
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 remainingTicketNumbers;
        uint256 priceInPoints;
        bool isGoodsArrived;
        uint256 estimateDeliverTime;
        uint256 exchangeExpireTime;
        string exchangeTokenURI;
        string unrevealTokenURI;
        string revealTokenURI;
        string seriesMetaDataURI;
        uint256 priceInTWD;
        bool isRefund;
        bool isPreOrder;
        bool useLuckyNumber;
        uint256 maxPerWallet;
        uint8 seriesSourceTag;
        uint32 lastPrizeQuantity;
    }

    struct TicketStatus {
        uint256 seriesID;
        uint256 tokenRevealedPrize;
        bool tokenExchange;
        bool tokenRevealed;
        uint16 luckyNumber;
        uint64 tokenRevealTimestamp;
    }

    struct TokenRange {
        uint256 start;
        uint256 end;
    }

    IDoudoPoints public doudoPoints;
    address public vrfRouter;
    uint256 private defaultLockDuration;

    mapping(uint256 => Series) private seriesData;
    mapping(uint256 => SubPrize[]) private seriesSubPrizes;
    mapping(uint256 => TicketStatus) public ticketStatusDetail;
    mapping(uint256 => mapping(uint16 => bool)) private luckyNumberUsed;
    mapping(uint256 => mapping(address => uint256)) private mintedPerWallet;
    mapping(uint256 => address) private mintLockOwner;
    mapping(uint256 => uint256) private mintLockUntil;
    mapping(uint256 => uint256) public pointsPaid;
    mapping(uint256 => TokenRange[]) private seriesRanges;
    mapping(uint256 => uint256) private totalMintedInSeries;
    mapping(uint256 => RequestKind) private requestKind;
    mapping(uint256 => uint256[]) private requestToRevealToken;
    mapping(uint256 => uint256) private requestToSeries;
    mapping(uint256 => address[]) private lastPrizeOwners;
    mapping(uint256 => bool) private lastPrizeRequestPending;
    mapping(uint256 => mapping(address => uint256)) private seriesUnlockUntil;

    uint256 private seriesCounter;

    error InvalidConfig();
    error EmptySubPrizes();
    error SubprizeQuantityNotEqual();
    error InvalidSeriesInput();
    error GoodsNotArrived();
    error NotEnoughNFTsRemaining();
    error LuckyNumberTaken();
    error LuckyNumberOutOfRange();
    error SeriesIsRefund();
    error RevealBatchTooLarge();
    error NotTheTokenOwner();
    error TokenAlreadyRevealed();
    error TokenRevealPending();
    error TokenAlreadyExchanged();
    error TokenNotRevealed();
    error NotEligibleForRedraw();
    error NotSoldOutYet();
    error AlreadyChoseWinner();

    event NewSeries(
        uint256 indexed seriesID,
        string seriesName,
        uint256 totalTicketNumbers,
        uint256 remainingTicketNumbers,
        uint256 priceInUSDTWei,
        uint256 priceInTWD,
        bool isGoodsArrived,
        uint256 estimateDeliverTime,
        uint256 exchangeExpireTime,
        string exchangeTokenURI,
        string unrevealTokenURI,
        string revealTokenURI,
        string seriesMetaDataURI,
        address lastPrizeOwner,
        bool isRefund,
        bool isPreOrder
    );
    event NewSubPrize(
        uint256 indexed seriesID,
        uint256 subPrizeID,
        string prizeGroup,
        string subPrizeName,
        uint256 subPrizeRemainingQuantity
    );
    event UpdateSeriesInformation(
        uint256 indexed seriesID,
        bool isGoodsArrived,
        uint256 estimateDeliverTime,
        uint256 exchangeExpireTime,
        string exchangeTokenURI,
        string unrevealTokenURI,
        string revealTokenURI,
        string seriesMetaDataURI
    );
    event UpdateSeriesRemainingTicketNumbers(uint256 indexed seriesID, uint256 remainingTicketNumbers);
    event NewTicketStatus(
        uint256 indexed tokenID,
        uint256 indexed seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed,
        address tokenOwner,
        uint16 luckyNumber
    );
    event MintLockUpdated(uint256 indexed seriesID, address indexed owner, uint256 until);
    event RevealDrawSent(uint256 requestId, uint256[] tokenIDs);
    event RevealDrawFulfilled(uint256 requestId, uint256 seriesID, uint256[] randomWords);
    event UpdatePrize(uint256 indexed seriesID, uint256 subPrizeID, uint256 subPrizeRemainingQuantity);
    event UpdateTicketStatus(
        uint256 tokenID,
        uint256 seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed
    );
    event LastPrizeWinner(uint256 requestId, uint256[] randomWord);
    event UpdateSeriesLastPrizeOwner(uint256 indexed seriesID, address[] lastPrizeOwner);
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address doudoPointsAddress,
        address vrfRouter_
    ) public initializerERC721A initializer {
        if (doudoPointsAddress == address(0) || vrfRouter_ == address(0)) {
            revert InvalidConfig();
        }

        __ERC721A_init("DOUDOCHAINV2", "DOUDOV2");
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(msg.sender);
        __LightweightGuards_init();

        doudoPoints = IDoudoPoints(doudoPointsAddress);
        vrfRouter = vrfRouter_;

        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
        _grantRole(ADMINMINT_ROLE, msg.sender);
    }

    function createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool revealEnabled
    ) external onlyRole(OPERATION_ROLE) returns (uint256 seriesID) {
        seriesID = _createSeriesWithSubPrizes(input, subPrizes, revealEnabled);
    }

    function setSeriesMetadata(
        uint256 seriesID,
        string calldata exchangeTokenURI,
        string calldata unrevealTokenURI,
        string calldata revealTokenURI,
        string calldata seriesMetaDataURI
    ) external onlyRole(OPERATION_ROLE) {
        Series storage series = seriesData[seriesID];

        series.exchangeTokenURI = exchangeTokenURI;
        series.unrevealTokenURI = unrevealTokenURI;
        series.revealTokenURI = revealTokenURI;
        series.seriesMetaDataURI = seriesMetaDataURI;
        _emitSeriesInformation(seriesID);
    }

    function mint(uint256 seriesID, uint16[] calldata luckyNumbers) external nonReentrant whenNotPaused {
        _paidMint(seriesID, msg.sender, luckyNumbers);
    }

    function adminMint(
        address to,
        uint256 seriesID,
        uint16[] calldata luckyNumbers
    ) external onlyRole(ADMINMINT_ROLE) nonReentrant whenNotPaused {
        Series storage series = seriesData[seriesID];
        uint256 quantity = luckyNumbers.length;
        if (series.isRefund) revert SeriesIsRefund();
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        _mintTickets(seriesID, to, luckyNumbers, 0, false, false);
    }

    function setVrfRouter(address vrfRouter_) external onlyRole(OPERATION_ROLE) {
        if (vrfRouter_ == address(0)) revert InvalidConfig();
        vrfRouter = vrfRouter_;
    }

    function setSeriesOpsModule(address moduleAddress) external onlyRole(OPERATION_ROLE) {
        if (moduleAddress == address(0)) revert InvalidConfig();
        seriesOpsModule = IDoudoSeriesOps(moduleAddress);
    }

    function setSeriesLastPrizeQuantity(uint256 seriesID, uint32 quantity) external onlyRole(OPERATION_ROLE) {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0 || quantity == 0) revert InvalidSeriesInput();
        if (lastPrizeOwners[seriesID].length != 0) revert AlreadyChoseWinner();
        if (lastPrizeRequestPending[seriesID]) revert AlreadyChoseWinner();
        if (series.remainingTicketNumbers == 0) revert AlreadyChoseWinner();
        series.lastPrizeQuantity = quantity;
    }

    function reveal(uint256 seriesID, uint256[] calldata tokenIDs) external nonReentrant whenNotPaused {
        if (tokenIDs.length == 0) revert InvalidSeriesInput();
        if (tokenIDs.length > MAX_REVEAL_BATCH) revert RevealBatchTooLarge();
        if (!_seriesOps().revealEnabled(seriesID)) revert GoodsNotArrived();
        _validateRevealTokens(seriesID, tokenIDs);
        _requestRevealRandomWords(seriesID, tokenIDs);
    }

    function fulfillRandomWordsFromRouter(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external override nonReentrant {
        if (msg.sender != vrfRouter) revert InvalidConfig();
        if (randomWords.length == 0) revert InvalidConfig();

        RequestKind kind = requestKind[requestId];
        if (kind == RequestKind.Reveal) {
            _fulfillReveal(requestId, randomWords);
        } else if (kind == RequestKind.LastPrize) {
            _fulfillLastPrize(requestId, randomWords);
        } else {
            revert InvalidConfig();
        }
    }

    function _chooseLastPrizeWinner(uint256 seriesID, uint32 quantity) internal {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0 || quantity == 0) revert InvalidSeriesInput();
        if (series.remainingTicketNumbers != 0) revert NotSoldOutYet();
        if (series.isRefund) revert SeriesIsRefund();
        if (lastPrizeOwners[seriesID].length != 0) revert AlreadyChoseWinner();
        if (lastPrizeRequestPending[seriesID]) revert AlreadyChoseWinner();

        if (!series.isPreOrder) {
            uint256 lastTokenId = _tokenIdFromSeriesIndex(seriesID, totalMintedInSeries[seriesID] - 1);
            address winner = ownerOf(lastTokenId);
            uint256[] memory sourceTokens = new uint256[](quantity);
            for (uint256 i = 0; i < quantity; i++) {
                _mintLastPrizeToken(seriesID, winner);
                lastPrizeOwners[seriesID].push(winner);
                sourceTokens[i] = lastTokenId;
            }
            emit UpdateSeriesLastPrizeOwner(seriesID, lastPrizeOwners[seriesID]);
            emit LastPrizeWinner(0, sourceTokens);
            return;
        }

        _requestLastPrizeRandomWords(seriesID, quantity);
    }

    function moduleMintUnrevealed(
        address to,
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        uint256 pointsPerTicket,
        bool enforceWalletAndLock
    ) external onlyRole(MODULE_ROLE) nonReentrant whenNotPaused returns (uint256 firstTokenId) {
        Series storage series = seriesData[seriesID];
        if (series.isRefund) revert SeriesIsRefund();
        uint256 quantity = luckyNumbers.length;
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        if (enforceWalletAndLock) {
            _seriesOps().checkAndRefreshMintLock(seriesID, to, quantity);
        } else {
            _seriesOps().refreshMintLockFor(seriesID, to, 5 minutes);
        }
        bool autoAssignLuckyNumbers = !enforceWalletAndLock;
        uint16[] memory resolvedLuckyNumbers = luckyNumbers;
        for (uint256 i = 0; i < quantity; i++) {
            if (series.useLuckyNumber && autoAssignLuckyNumbers) {
                if (resolvedLuckyNumbers[i] != 0) revert InvalidConfig();
                resolvedLuckyNumbers[i] = _assignNextLuckyNumber(seriesID);
            } else if (!series.useLuckyNumber && resolvedLuckyNumbers[i] != 0) {
                revert InvalidConfig();
            }
        }
        firstTokenId = _nextTokenId();
        _mintTickets(
            seriesID,
            to,
            resolvedLuckyNumbers,
            pointsPerTicket,
            enforceWalletAndLock,
            autoAssignLuckyNumbers
        );
    }

    function moduleMintRevealed(
        address to,
        uint256 seriesID,
        uint256 prizeID
    ) external onlyRole(MODULE_ROLE) nonReentrant whenNotPaused returns (uint256 tokenId) {
        tokenId = _mintRevealedNoInventory(seriesID, to, prizeID, 0);
    }

    function moduleBurnForRefund(
        uint256 tokenID,
        address owner
    )
        external
        onlyRole(MODULE_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 seriesID)
    {
        if (ownerOf(tokenID) != owner) revert NotTheTokenOwner();
        TicketStatus storage status = ticketStatusDetail[tokenID];
        seriesID = status.seriesID;
        if (revealRequestPending[tokenID]) revert TokenRevealPending();
        if (status.tokenExchange) revert TokenAlreadyExchanged();
        _burn(tokenID);
        emit UpdateTicketStatus(tokenID, seriesID, status.tokenRevealedPrize, status.tokenExchange, status.tokenRevealed);
    }

    function moduleBurnForRedraw(
        uint256 tokenID,
        address owner
    )
        external
        onlyRole(MODULE_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 seriesID)
    {
        if (ownerOf(tokenID) != owner) revert NotTheTokenOwner();
        TicketStatus storage status = ticketStatusDetail[tokenID];
        if (!status.tokenRevealed || status.tokenExchange) revert NotEligibleForRedraw();
        seriesID = status.seriesID;
        _burn(tokenID);
        emit UpdateTicketStatus(tokenID, seriesID, status.tokenRevealedPrize, status.tokenExchange, status.tokenRevealed);
    }

    function moduleSetSeriesRefund(
        uint256 seriesID,
        bool isRefund
    ) external onlyRole(MODULE_ROLE) {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
        series.isRefund = isRefund;
    }

    function setGoodsArrived(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
        series.isGoodsArrived = true;
        series.estimateDeliverTime = block.timestamp;
        series.exchangeExpireTime = block.timestamp + 60 days;
        _emitSeriesInformation(seriesID);
    }

    function exchangePrize(uint256[] calldata tokenIDs) external whenNotPaused {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenID = tokenIDs[i];
            if (ownerOf(tokenID) != msg.sender) revert NotTheTokenOwner();
            TicketStatus storage status = ticketStatusDetail[tokenID];
            if (!status.tokenRevealed) revert TokenNotRevealed();
            if (status.tokenExchange) revert TokenAlreadyExchanged();
            _requireExchangeDeadlineOpen(status);
            status.tokenExchange = true;
            emit UpdateTicketStatus(tokenID, status.seriesID, status.tokenRevealedPrize, true, true);
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        TicketStatus storage status = ticketStatusDetail[tokenId];
        Series storage series = seriesData[status.seriesID];
        return DoudoTokenURILib.buildTokenURI(
            series.exchangeTokenURI,
            series.revealTokenURI,
            series.unrevealTokenURI,
            status.tokenRevealedPrize,
            status.tokenExchange,
            status.tokenRevealed
        );
    }

    function pause() external onlyRole(OPERATION_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATION_ROLE) {
        _unpause();
    }

    function seriesMintConfig(
        uint256 seriesID
    ) external view returns (uint256 priceInPoints, bool useLuckyNumber) {
        Series storage series = seriesData[seriesID];
        return (series.priceInPoints, series.useLuckyNumber);
    }

    function _createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool revealEnabled
    ) internal returns (uint256 seriesID) {
        _validateSeriesInput(input, subPrizes);
        seriesID = seriesCounter++;

        Series storage series = seriesData[seriesID];
        series.seriesName = input.seriesName;
        series.totalTicketNumbers = input.totalTicketNumbers;
        series.remainingTicketNumbers = input.totalTicketNumbers;
        series.priceInPoints = input.priceInPoints;
        series.priceInTWD = input.priceInTWD;
        series.estimateDeliverTime = input.estimateDeliverTime;
        series.exchangeExpireTime = input.estimateDeliverTime + 60 days;
        series.exchangeTokenURI = input.exchangeTokenURI;
        series.unrevealTokenURI = input.unrevealTokenURI;
        series.revealTokenURI = input.revealTokenURI;
        series.seriesMetaDataURI = input.seriesMetaDataURI;
        series.isPreOrder = input.isPreOrder;
        series.useLuckyNumber = input.useLuckyNumber;
        series.isGoodsArrived = input.estimateDeliverTime <= block.timestamp;

        _storeSubPrizes(seriesID, subPrizes);

        emit NewSeries(
            seriesID,
            series.seriesName,
            series.totalTicketNumbers,
            series.remainingTicketNumbers,
            series.priceInPoints,
            series.priceInTWD,
            series.isGoodsArrived,
            series.estimateDeliverTime,
            series.exchangeExpireTime,
            series.exchangeTokenURI,
            series.unrevealTokenURI,
            series.revealTokenURI,
            series.seriesMetaDataURI,
            address(0),
            series.isRefund,
            series.isPreOrder
        );
        _initializeSeriesOps(seriesID, input.maxPerWallet, revealEnabled);
    }

    function _emitSeriesInformation(uint256 seriesID) internal {
        Series storage series = seriesData[seriesID];
        emit UpdateSeriesInformation(
            seriesID,
            series.isGoodsArrived,
            series.estimateDeliverTime,
            series.exchangeExpireTime,
            series.exchangeTokenURI,
            series.unrevealTokenURI,
            series.revealTokenURI,
            series.seriesMetaDataURI
        );
    }

    function _storeSubPrizes(
        uint256 seriesID,
        SubPrize[] calldata subPrizes
    ) internal {
        for (uint256 i = 0; i < subPrizes.length; i++) {
            seriesSubPrizes[seriesID].push(subPrizes[i]);
            emit NewSubPrize(
                seriesID,
                subPrizes[i].subPrizeID,
                subPrizes[i].prizeGroup,
                subPrizes[i].subPrizeName,
                subPrizes[i].subPrizeRemainingQuantity
            );
        }
    }

    function _paidMint(
        uint256 seriesID,
        address buyer,
        uint16[] calldata luckyNumbers
    ) internal {
        Series storage series = seriesData[seriesID];
        uint256 quantity = luckyNumbers.length;
        if (series.isRefund) revert SeriesIsRefund();
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        _seriesOps().checkAndRefreshMintLock(seriesID, buyer, quantity);
        doudoPoints.burnFromWithReason(buyer, quantity * series.priceInPoints, keccak256("LOTTERY_MINT"));
        _mintTickets(seriesID, buyer, luckyNumbers, series.priceInPoints, true, false);
    }

    function _mintTickets(
        uint256 seriesID,
        address to,
        uint16[] memory luckyNumbers,
        uint256 paidPointsPerTicket,
        bool countWalletMint,
        bool luckyNumbersPreassigned
    ) internal {
        Series storage series = seriesData[seriesID];
        uint256 quantity = luckyNumbers.length;
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        uint256 startTokenId = _nextTokenId();
        _safeMint(to, quantity);
        for (uint256 i = 0; i < quantity; i++) {
            uint16 luckyNumber = luckyNumbersPreassigned
                ? luckyNumbers[i]
                : _consumeLuckyNumber(seriesID, series.useLuckyNumber, luckyNumbers[i]);
            uint256 tokenId = startTokenId + i;
            ticketStatusDetail[tokenId] = TicketStatus({
                seriesID: seriesID,
                tokenRevealedPrize: 0,
                tokenExchange: false,
                tokenRevealed: false,
                luckyNumber: luckyNumber,
                tokenRevealTimestamp: 0
            });
            pointsPaid[tokenId] = paidPointsPerTicket;
            emit NewTicketStatus(tokenId, seriesID, 0, false, false, to, luckyNumber);
        }
        series.remainingTicketNumbers -= quantity;
        totalMintedInSeries[seriesID] += quantity;
        _recordSeriesRange(seriesID, startTokenId, quantity);
        if (countWalletMint) {
            _seriesOps().recordMint(seriesID, to, quantity);
        }
        emit UpdateSeriesRemainingTicketNumbers(seriesID, series.remainingTicketNumbers);
        if (series.remainingTicketNumbers == 0) {
            uint32 lastPrizeQuantity = series.lastPrizeQuantity;
            if (lastPrizeQuantity == 0) {
                lastPrizeQuantity = DEFAULT_LAST_PRIZE_QUANTITY;
            }
            _chooseLastPrizeWinner(seriesID, lastPrizeQuantity);
        }
    }

    function _requestRevealRandomWords(
        uint256 seriesID,
        uint256[] memory tokenIDs
    ) internal returns (uint256 requestId) {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            revealRequestPending[tokenIDs[i]] = true;
        }
        requestId = _requestRandomWords(1);
        requestKind[requestId] = RequestKind.Reveal;
        requestToSeries[requestId] = seriesID;
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            requestToRevealToken[requestId].push(tokenIDs[i]);
        }
        emit RevealDrawSent(requestId, tokenIDs);
    }

    function _requestLastPrizeRandomWords(
        uint256 seriesID,
        uint32 quantity
    ) internal returns (uint256 requestId) {
        requestId = _requestRandomWords(quantity);
        requestKind[requestId] = RequestKind.LastPrize;
        requestToSeries[requestId] = seriesID;
        lastPrizeRequestPending[seriesID] = true;
    }

    function _requestRandomWords(uint32 numWords) internal returns (uint256 requestId) {
        requestId = IDoudoVRFRouter(vrfRouter).requestRandomWords(address(this), numWords);
    }

    function _fulfillReveal(uint256 requestId, uint256[] calldata randomWords) internal {
        uint256 seriesID = requestToSeries[requestId];
        uint256[] storage tokenIDs = requestToRevealToken[requestId];
        uint256 randomWord = randomWords[0];

        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenId = tokenIDs[i];
            TicketStatus storage status = ticketStatusDetail[tokenId];
            if (status.tokenRevealed) revert TokenAlreadyRevealed();
            uint256 prizeId = DoudoPrizeDrawLib.drawPrize(
                seriesSubPrizes[seriesID],
                seriesID,
                uint256(keccak256(abi.encode(randomWord, tokenId, i)))
            );
            status.tokenRevealedPrize = prizeId;
            status.tokenRevealed = true;
            status.tokenRevealTimestamp = uint64(block.timestamp);
            revealRequestPending[tokenId] = false;
            emit UpdateTicketStatus(tokenId, seriesID, prizeId, status.tokenExchange, true);
        }

        emit RevealDrawFulfilled(requestId, seriesID, randomWords);
        delete requestToRevealToken[requestId];
        _clearRequest(requestId);
    }

    function _fulfillLastPrize(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal {
        uint256 seriesID = requestToSeries[requestId];

        for (uint256 i = 0; i < randomWords.length; i++) {
            uint256 sourceTokenId = _selectExistingTokenFromSeries(seriesID, randomWords[i]);
            address winner = ownerOf(sourceTokenId);
            _mintLastPrizeToken(seriesID, winner);
            lastPrizeOwners[seriesID].push(winner);
        }

        lastPrizeRequestPending[seriesID] = false;
        emit LastPrizeWinner(requestId, randomWords);
        emit UpdateSeriesLastPrizeOwner(seriesID, lastPrizeOwners[seriesID]);
        _clearRequest(requestId);
    }

    function _clearRequest(uint256 requestId) internal {
        delete requestKind[requestId];
        delete requestToSeries[requestId];
    }

    function _consumeLuckyNumber(
        uint256 seriesID,
        bool useLuckyNumber,
        uint16 luckyNumber
    ) internal returns (uint16) {
        if (!useLuckyNumber) return 0;
        Series storage series = seriesData[seriesID];
        if (luckyNumber == 0 || luckyNumber > series.totalTicketNumbers) revert LuckyNumberOutOfRange();
        if (luckyNumberUsed[seriesID][luckyNumber]) revert LuckyNumberTaken();
        luckyNumberUsed[seriesID][luckyNumber] = true;
        _advanceLuckyNumberCursor(seriesID, luckyNumber, series.totalTicketNumbers);
        return luckyNumber;
    }

    function _assignNextLuckyNumber(uint256 seriesID) internal returns (uint16) {
        uint256 total = seriesData[seriesID].totalTicketNumbers;
        uint256 luckyNumber = seriesNextLuckyNumberCandidate[seriesID];
        if (luckyNumber == 0) {
            luckyNumber = 1;
        }
        for (; luckyNumber <= total; luckyNumber++) {
            uint16 assigned = uint16(luckyNumber);
            if (!luckyNumberUsed[seriesID][assigned]) {
                luckyNumberUsed[seriesID][assigned] = true;
                _advanceLuckyNumberCursor(seriesID, assigned, total);
                return assigned;
            }
        }
        revert LuckyNumberTaken();
    }

    function _advanceLuckyNumberCursor(
        uint256 seriesID,
        uint16 consumedLuckyNumber,
        uint256 total
    ) internal {
        uint256 candidate = seriesNextLuckyNumberCandidate[seriesID];
        if (candidate == 0) {
            candidate = 1;
        }
        if (candidate != consumedLuckyNumber) {
            return;
        }

        candidate += 1;
        while (candidate <= total && luckyNumberUsed[seriesID][uint16(candidate)]) {
            candidate += 1;
        }
        seriesNextLuckyNumberCandidate[seriesID] = candidate > total ? 0 : uint16(candidate);
    }

    function _recordSeriesRange(uint256 seriesID, uint256 start, uint256 quantity) internal {
        uint256 end = start + quantity - 1;
        uint256 length = seriesRanges[seriesID].length;
        if (length > 0 && seriesRanges[seriesID][length - 1].end + 1 == start) {
            seriesRanges[seriesID][length - 1].end = end;
        } else {
            seriesRanges[seriesID].push(TokenRange({start: start, end: end}));
        }
    }

    function _tokenIdFromSeriesIndex(
        uint256 seriesID,
        uint256 index
    ) internal view returns (uint256 tokenId) {
        TokenRange[] storage ranges = seriesRanges[seriesID];
        uint256 cursor;
        for (uint256 i = 0; i < ranges.length; i++) {
            uint256 size = ranges[i].end - ranges[i].start + 1;
            if (index < cursor + size) {
                return ranges[i].start + (index - cursor);
            }
            cursor += size;
        }
        revert InvalidSeriesInput();
    }

    function _validateRevealTokens(
        uint256 seriesID,
        uint256[] calldata tokenIDs
    ) internal view {
        address user = msg.sender;
        bool moduleCaller = hasRole(MODULE_ROLE, user);
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            if (!moduleCaller) {
                if (ownerOf(tokenIDs[i]) != user) revert NotTheTokenOwner();
            }
            TicketStatus storage status = ticketStatusDetail[tokenIDs[i]];
            if (status.seriesID != seriesID) revert InvalidSeriesInput();
            if (status.tokenRevealed) revert TokenAlreadyRevealed();
            if (revealRequestPending[tokenIDs[i]]) revert TokenRevealPending();
            for (uint256 j = 0; j < i; j++) {
                if (tokenIDs[j] == tokenIDs[i]) revert TokenRevealPending();
            }
        }
    }

    function _mintRevealedNoInventory(
        uint256 seriesID,
        address to,
        uint256 subPrizeID,
        uint16 luckyNumber
    ) internal returns (uint256 tokenId) {
        Series storage series = seriesData[seriesID];
        if (!_seriesOps().revealEnabled(seriesID)) revert GoodsNotArrived();
        // Reward / consolation mints have no ticket inventory and pass
        // luckyNumber == 0: they do NOT occupy a lucky number (mirroring
        // last-prize tokens), so they never collide with or exhaust the
        // [1, totalTicketNumbers] pool and remain claimable after sellout.
        // A non-zero luckyNumber is still validated and consumed when supplied.
        uint16 consumedLuckyNumber = luckyNumber == 0
            ? 0
            : _consumeLuckyNumber(seriesID, series.useLuckyNumber, luckyNumber);

        tokenId = _mintRevealedTicket(seriesID, to, subPrizeID, consumedLuckyNumber);
        totalMintedInSeries[seriesID] += 1;
        _recordSeriesRange(seriesID, tokenId, 1);
    }

    function _mintLastPrizeToken(uint256 seriesID, address to) internal returns (uint256 tokenId) {
        tokenId = _mintRevealedTicket(seriesID, to, LAST_PRIZE_ID, 0);
    }

    function _mintRevealedTicket(
        uint256 seriesID,
        address to,
        uint256 prizeID,
        uint16 luckyNumber
    ) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId();
        _safeMint(to, 1);
        ticketStatusDetail[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: prizeID,
            tokenExchange: false,
            tokenRevealed: true,
            luckyNumber: luckyNumber,
            tokenRevealTimestamp: uint64(block.timestamp)
        });
        emit NewTicketStatus(tokenId, seriesID, prizeID, false, true, to, luckyNumber);
        emit UpdateTicketStatus(tokenId, seriesID, prizeID, false, true);
    }

    function _requireExchangeDeadlineOpen(TicketStatus storage status) internal view {
        if (block.timestamp > uint256(status.tokenRevealTimestamp) + 60 days) revert();
    }

    function _selectExistingTokenFromSeries(
        uint256 seriesID,
        uint256 randomWord
    ) internal view returns (uint256 tokenId) {
        uint256 totalSeriesTokens = totalMintedInSeries[seriesID];
        if (totalSeriesTokens == 0) revert NotEnoughNFTsRemaining();

        tokenId = _tokenIdFromSeriesIndex(seriesID, randomWord % totalSeriesTokens);
        if (_exists(tokenId)) {
            return tokenId;
        }

        for (uint256 attempt = 1; attempt <= 20; attempt++) {
            tokenId = _tokenIdFromSeriesIndex(
                seriesID,
                uint256(keccak256(abi.encode(randomWord, attempt))) % totalSeriesTokens
            );
            if (_exists(tokenId)) {
                return tokenId;
            }
        }
        revert NotEnoughNFTsRemaining();
    }

    function _validateSeriesInput(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes
    ) internal pure {
        if (input.totalTicketNumbers == 0 || input.priceInPoints == 0) revert InvalidSeriesInput();
        if (input.useLuckyNumber && input.totalTicketNumbers > type(uint16).max) revert InvalidSeriesInput();
        if (
            bytes(input.seriesName).length == 0 ||
            bytes(input.unrevealTokenURI).length == 0 ||
            bytes(input.revealTokenURI).length == 0 ||
            bytes(input.seriesMetaDataURI).length == 0
        ) {
            revert InvalidSeriesInput();
        }
        if (subPrizes.length == 0) revert EmptySubPrizes();

        uint256 totalPrizeQuantity;
        for (uint256 i = 0; i < subPrizes.length; i++) {
            totalPrizeQuantity += subPrizes[i].subPrizeRemainingQuantity;
        }
        if (totalPrizeQuantity != input.totalTicketNumbers) revert SubprizeQuantityNotEqual();
    }

    function _seriesOps() internal view returns (IDoudoSeriesOps ops) {
        ops = seriesOpsModule;
        if (address(ops) == address(0)) revert InvalidConfig();
    }

    function _initializeSeriesOps(
        uint256 seriesID,
        uint256 maxPerWallet,
        bool revealEnabled
    ) internal {
        _seriesOps().initializeSeries(seriesID, maxPerWallet, revealEnabled);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    mapping(uint256 => uint256) private seriesLockDuration;
    mapping(uint256 => bool) private revealRequestPending;
    mapping(uint256 => uint16) private seriesNextLuckyNumberCandidate;
    mapping(uint256 => bool) private seriesRevealDisabled;
    IDoudoSeriesOps private seriesOpsModule;

    uint256[35] private __gap;
}
