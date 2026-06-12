// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./interfaces/IDoudoPoints.sol";
import "./interfaces/IDoudoVRFCallback.sol";
import "./interfaces/IDoudoVRFRouter.sol";
import "./security/LightweightGuardsUpgradeable.sol";

contract DOUDOCHAINV2CoreUpgradeable is
    Initializable,
    ERC721AUpgradeable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable,
    IDoudoVRFCallback
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant ADMINMINT_ROLE = keccak256("ADMINMINT_ROLE");
    bytes32 public constant MODULE_ROLE = keccak256("MODULE_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 private constant MAX_REVEAL_BATCH = 20;
    uint256 private constant MAX_MINT_AND_REVEAL = 10;
    uint256 private constant LAST_PRIZE_ID = 999;

    enum RequestKind {
        None,
        Reveal,
        LastPrize
    }

    struct SubPrize {
        uint256 subPrizeID;
        string prizeGroup;
        string subPrizeName;
        uint256 subPrizeRemainingQuantity;
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
    }

    struct TicketStatus {
        uint256 seriesID;
        uint256 tokenRevealedPrize;
        bool tokenExchange;
        bool tokenRevealed;
        uint16 luckyNumber;
    }

    struct TokenRange {
        uint256 start;
        uint256 end;
    }

    IDoudoPoints public doudoPoints;
    address public vrfRouter;
    uint256 public defaultLockDuration;

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
    error OnlyVrfRouter(address caller, address expectedRouter);
    error EmptySubPrizes();
    error SubprizeQuantityNotEqual();
    error InvalidSeriesInput();
    error GoodsNotArrived();
    error NotEnoughNFTsRemaining();
    error LuckyNumberTaken();
    error LuckyNumberOutOfRange();
    error WalletCapExceeded();
    error SeriesReserved();
    error SeriesIsRefund();
    error RevealBatchTooLarge();
    error NotTheTokenOwner();
    error TokenAlreadyRevealed();
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
    event AdminMinted(
        address indexed operator,
        address indexed to,
        uint256 indexed seriesID,
        uint256 quantity
    );
    event VrfRouterUpdated(address indexed vrfRouter, address indexed operator);
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
    event LastPrizeDraw(uint256 requestId, uint256 seriesID, uint256 quantity);
    event LastPrizeWinner(uint256 requestId, uint256[] randomWord);
    event UpdateSeriesLastPrizeOwner(uint256 indexed seriesID, address[] lastPrizeOwner);
    event SeriesUnlockedFor(uint256 indexed seriesID, address indexed user, uint256 expires);

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
        defaultLockDuration = 900;

        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
        _grantRole(ADMINMINT_ROLE, msg.sender);
    }

    function createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool markGoodsArrived
    ) external onlyRole(OPERATION_ROLE) returns (uint256 seriesID) {
        seriesID = _createSeriesWithSubPrizes(input, subPrizes, markGoodsArrived);
    }

    function setSeriesMetadata(
        uint256 seriesID,
        string calldata exchangeTokenURI,
        string calldata unrevealTokenURI,
        string calldata revealTokenURI,
        string calldata seriesMetaDataURI
    ) external onlyRole(OPERATION_ROLE) {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
        if (
            bytes(unrevealTokenURI).length == 0 ||
            bytes(revealTokenURI).length == 0 ||
            bytes(seriesMetaDataURI).length == 0
        ) {
            revert InvalidSeriesInput();
        }

        series.exchangeTokenURI = exchangeTokenURI;
        series.unrevealTokenURI = unrevealTokenURI;
        series.revealTokenURI = revealTokenURI;
        series.seriesMetaDataURI = seriesMetaDataURI;
        _emitSeriesInformation(seriesID);
    }

    function mint(uint256 seriesID, uint16[] calldata luckyNumbers) external nonReentrant whenNotPaused {
        _paidMint(seriesID, msg.sender, luckyNumbers, false);
    }

    function mintAndReveal(uint256 seriesID, uint16[] calldata luckyNumbers) external nonReentrant whenNotPaused {
        uint256 quantity = luckyNumbers.length;
        if (quantity > MAX_MINT_AND_REVEAL) revert RevealBatchTooLarge();
        uint256 firstTokenId = _nextTokenId();
        _paidMint(seriesID, msg.sender, luckyNumbers, true);
        uint256[] memory tokenIDs = new uint256[](quantity);
        unchecked {
            for (uint256 i; i < quantity; ++i) {
                tokenIDs[i] = firstTokenId + i;
            }
        }
        _requestRevealRandomWords(seriesID, tokenIDs);
    }

    function adminMint(
        address to,
        uint256 seriesID,
        uint16[] calldata luckyNumbers
    ) external onlyRole(ADMINMINT_ROLE) nonReentrant whenNotPaused {
        Series storage series = seriesData[seriesID];
        uint256 quantity = luckyNumbers.length;
        if (!series.isGoodsArrived) revert GoodsNotArrived();
        if (series.isRefund) revert SeriesIsRefund();
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        _mintTickets(seriesID, to, luckyNumbers, 0, false, false);
        emit AdminMinted(msg.sender, to, seriesID, quantity);
    }

    function setVrfRouter(address vrfRouter_) external onlyRole(OPERATION_ROLE) {
        if (vrfRouter_ == address(0)) revert InvalidConfig();
        vrfRouter = vrfRouter_;
        emit VrfRouterUpdated(vrfRouter_, msg.sender);
    }

    function reveal(uint256 seriesID, uint256[] calldata tokenIDs) external whenNotPaused {
        if (tokenIDs.length == 0) revert InvalidSeriesInput();
        if (tokenIDs.length > MAX_REVEAL_BATCH) revert RevealBatchTooLarge();
        if (!seriesData[seriesID].isGoodsArrived) revert GoodsNotArrived();
        _validateRevealTokens(seriesID, tokenIDs, msg.sender);
        _requestRevealRandomWords(seriesID, tokenIDs);
    }

    function fulfillRandomWordsFromRouter(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external override nonReentrant {
        if (msg.sender != vrfRouter) revert OnlyVrfRouter(msg.sender, vrfRouter);
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

    function chooseLastPrizeWinner(
        uint256 seriesID,
        uint32 quantity
    ) external nonReentrant whenNotPaused onlyRole(OPERATION_ROLE) {
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
            emit LastPrizeWinner(seriesID, sourceTokens);
            return;
        }

        _requestLastPrizeRandomWords(seriesID, quantity);
    }

    function moduleMintUnrevealed(
        address to,
        uint256 seriesID,
        uint256 quantity,
        uint256 pointsPerTicket,
        bool enforceWalletAndLock
    ) external onlyRole(MODULE_ROLE) nonReentrant whenNotPaused returns (uint256 firstTokenId) {
        Series storage series = seriesData[seriesID];
        if (series.isRefund) revert SeriesIsRefund();
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        if (enforceWalletAndLock) {
            if (!series.isGoodsArrived && !series.isPreOrder) revert GoodsNotArrived();
            _checkAndRefreshMintLock(seriesID, to);
            _checkWalletCap(seriesID, to, quantity);
        }
        uint16[] memory luckyNumbers = new uint16[](quantity);
        if (series.useLuckyNumber) {
            for (uint256 i = 0; i < quantity; i++) {
                luckyNumbers[i] = _assignNextLuckyNumber(seriesID);
            }
        }
        firstTokenId = _nextTokenId();
        _mintTickets(seriesID, to, luckyNumbers, pointsPerTicket, enforceWalletAndLock, true);
    }

    function moduleMintRevealed(
        address to,
        uint256 seriesID,
        uint256 prizeID,
        uint16 luckyNumber
    ) external onlyRole(MODULE_ROLE) nonReentrant whenNotPaused returns (uint256 tokenId) {
        tokenId = _mintRevealedNoInventory(seriesID, to, prizeID, luckyNumber);
    }

    function moduleBurnForRefund(
        uint256 tokenID,
        address owner
    )
        external
        onlyRole(MODULE_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 seriesID, uint256 prizeID, bool revealed)
    {
        if (ownerOf(tokenID) != owner) revert NotTheTokenOwner();
        TicketStatus storage status = ticketStatusDetail[tokenID];
        seriesID = status.seriesID;
        prizeID = status.tokenRevealedPrize;
        revealed = status.tokenRevealed;
        if (status.tokenExchange) revert TokenAlreadyExchanged();
        _burn(tokenID);
        emit UpdateTicketStatus(tokenID, seriesID, prizeID, status.tokenExchange, status.tokenRevealed);
    }

    function moduleBurnForRedraw(
        uint256 tokenID,
        address owner
    )
        external
        onlyRole(MODULE_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 seriesID, uint256 prizeID)
    {
        if (ownerOf(tokenID) != owner) revert NotTheTokenOwner();
        TicketStatus storage status = ticketStatusDetail[tokenID];
        if (!status.tokenRevealed || status.tokenExchange) revert NotEligibleForRedraw();
        seriesID = status.seriesID;
        prizeID = status.tokenRevealedPrize;
        _burn(tokenID);
        emit UpdateTicketStatus(tokenID, seriesID, prizeID, status.tokenExchange, status.tokenRevealed);
    }

    function moduleSetSeriesRefund(
        uint256 seriesID,
        bool isRefund
    ) external onlyRole(MODULE_ROLE) {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
        series.isRefund = isRefund;
        _emitSeriesInformation(seriesID);
    }

    function moduleUnlockSeriesFor(
        uint256 seriesID,
        address user,
        uint256 expires
    ) external onlyRole(MODULE_ROLE) {
        if (seriesData[seriesID].totalTicketNumbers == 0 || user == address(0)) revert InvalidSeriesInput();
        seriesUnlockUntil[seriesID][user] = expires;
        emit SeriesUnlockedFor(seriesID, user, expires);
    }

    function setDefaultLockDuration(uint256 duration) external onlyRole(OPERATION_ROLE) {
        defaultLockDuration = duration;
    }

    function setSeriesLockDuration(
        uint256 seriesID,
        uint256 duration
    ) external onlyRole(OPERATION_ROLE) {
        if (seriesData[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
        seriesLockDuration[seriesID] = duration;
    }

    function clearMintLock(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
        mintLockOwner[seriesID] = address(0);
        mintLockUntil[seriesID] = 0;
        emit MintLockUpdated(seriesID, address(0), 0);
    }

    function setSeriesMaxPerWallet(
        uint256 seriesID,
        uint256 cap
    ) external onlyRole(OPERATION_ROLE) {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
        series.maxPerWallet = cap;
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
        if (tokenIDs.length == 0) revert InvalidSeriesInput();
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenID = tokenIDs[i];
            if (ownerOf(tokenID) != msg.sender) revert NotTheTokenOwner();
            TicketStatus storage status = ticketStatusDetail[tokenID];
            if (!status.tokenRevealed) revert TokenNotRevealed();
            if (status.tokenExchange) revert TokenAlreadyExchanged();
            status.tokenExchange = true;
            emit UpdateTicketStatus(tokenID, status.seriesID, status.tokenRevealedPrize, true, true);
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        TicketStatus storage status = ticketStatusDetail[tokenId];
        Series storage series = seriesData[status.seriesID];
        if (status.tokenExchange) {
            return string(abi.encodePacked(series.exchangeTokenURI, _toString(status.tokenRevealedPrize)));
        }
        if (status.tokenRevealed) {
            return string(abi.encodePacked(series.revealTokenURI, _toString(status.tokenRevealedPrize)));
        }
        return series.unrevealTokenURI;
    }

    function pause() external onlyRole(OPERATION_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATION_ROLE) {
        _unpause();
    }

    function _createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool markGoodsArrived
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
        series.maxPerWallet = input.maxPerWallet;

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

        if (markGoodsArrived) {
            series.isGoodsArrived = true;
            series.estimateDeliverTime = block.timestamp;
            series.exchangeExpireTime = block.timestamp + 60 days;
        }

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
        _emitSeriesInformation(seriesID);
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

    function _paidMint(
        uint256 seriesID,
        address buyer,
        uint16[] calldata luckyNumbers,
        bool requireGoodsArrived
    ) internal {
        Series storage series = seriesData[seriesID];
        uint256 quantity = luckyNumbers.length;
        if (requireGoodsArrived) {
            if (!series.isGoodsArrived) revert GoodsNotArrived();
        } else if (!series.isGoodsArrived && !series.isPreOrder) {
            revert GoodsNotArrived();
        }
        if (series.isRefund) revert SeriesIsRefund();
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        _checkAndRefreshMintLock(seriesID, buyer);
        _checkWalletCap(seriesID, buyer, quantity);
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
                luckyNumber: luckyNumber
            });
            pointsPaid[tokenId] = paidPointsPerTicket;
            emit NewTicketStatus(tokenId, seriesID, 0, false, false, to, luckyNumber);
        }
        series.remainingTicketNumbers -= quantity;
        if (countWalletMint) {
            mintedPerWallet[seriesID][to] += quantity;
        }
        totalMintedInSeries[seriesID] += quantity;
        _recordSeriesRange(seriesID, startTokenId, quantity);
        emit UpdateSeriesRemainingTicketNumbers(seriesID, series.remainingTicketNumbers);
    }

    function _requestRevealRandomWords(
        uint256 seriesID,
        uint256[] memory tokenIDs
    ) internal returns (uint256 requestId) {
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
        emit LastPrizeDraw(requestId, seriesID, quantity);
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
            uint256 prizeId = _drawPrize(
                seriesID,
                uint256(keccak256(abi.encode(randomWord, tokenId, i)))
            );
            status.tokenRevealedPrize = prizeId;
            status.tokenRevealed = true;
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
        return luckyNumber;
    }

    function _assignNextLuckyNumber(uint256 seriesID) internal returns (uint16) {
        uint256 total = seriesData[seriesID].totalTicketNumbers;
        for (uint16 luckyNumber = 1; luckyNumber <= total; luckyNumber++) {
            if (!luckyNumberUsed[seriesID][luckyNumber]) {
                luckyNumberUsed[seriesID][luckyNumber] = true;
                return luckyNumber;
            }
        }
        revert LuckyNumberTaken();
    }

    function _checkWalletCap(uint256 seriesID, address user, uint256 quantity) internal view {
        uint256 cap = seriesData[seriesID].maxPerWallet;
        if (cap != 0 && mintedPerWallet[seriesID][user] + quantity > cap) revert WalletCapExceeded();
    }

    function _checkAndRefreshMintLock(uint256 seriesID, address user) internal {
        if (block.timestamp < mintLockUntil[seriesID] && mintLockOwner[seriesID] != user) {
            revert SeriesReserved();
        }
        uint256 duration = seriesLockDuration[seriesID];
        if (duration == 0) {
            duration = defaultLockDuration;
        }
        mintLockOwner[seriesID] = user;
        mintLockUntil[seriesID] = block.timestamp + duration;
        emit MintLockUpdated(seriesID, user, mintLockUntil[seriesID]);
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
        uint256[] calldata tokenIDs,
        address user
    ) internal view {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            if (ownerOf(tokenIDs[i]) != user) revert NotTheTokenOwner();
            TicketStatus storage status = ticketStatusDetail[tokenIDs[i]];
            if (status.seriesID != seriesID) revert InvalidSeriesInput();
            if (status.tokenRevealed) revert TokenAlreadyRevealed();
        }
    }

    function _mintRevealedNoInventory(
        uint256 seriesID,
        address to,
        uint256 subPrizeID,
        uint16 luckyNumber
    ) internal returns (uint256 tokenId) {
        Series storage series = seriesData[seriesID];
        if (!series.isGoodsArrived) revert GoodsNotArrived();
        // Reward / consolation mints have no ticket inventory and pass
        // luckyNumber == 0: they do NOT occupy a lucky number (mirroring
        // last-prize tokens), so they never collide with or exhaust the
        // [1, totalTicketNumbers] pool and remain claimable after sellout.
        // A non-zero luckyNumber is still validated and consumed when supplied.
        uint16 consumedLuckyNumber = luckyNumber == 0
            ? 0
            : _consumeLuckyNumber(seriesID, series.useLuckyNumber, luckyNumber);

        tokenId = _nextTokenId();
        _safeMint(to, 1);
        ticketStatusDetail[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: subPrizeID,
            tokenExchange: false,
            tokenRevealed: true,
            luckyNumber: consumedLuckyNumber
        });
        totalMintedInSeries[seriesID] += 1;
        _recordSeriesRange(seriesID, tokenId, 1);
        emit NewTicketStatus(tokenId, seriesID, subPrizeID, false, true, to, consumedLuckyNumber);
        emit UpdateTicketStatus(tokenId, seriesID, subPrizeID, false, true);
    }

    function _mintLastPrizeToken(uint256 seriesID, address to) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId();
        _safeMint(to, 1);
        ticketStatusDetail[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: LAST_PRIZE_ID,
            tokenExchange: false,
            tokenRevealed: true,
            luckyNumber: 0
        });
        emit NewTicketStatus(tokenId, seriesID, LAST_PRIZE_ID, false, true, to, 0);
        emit UpdateTicketStatus(tokenId, seriesID, LAST_PRIZE_ID, false, true);
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

    function _drawPrize(uint256 seriesID, uint256 randomWord) internal returns (uint256 subPrizeID) {
        SubPrize[] storage prizes = seriesSubPrizes[seriesID];
        uint256 totalRemaining;
        for (uint256 i = 0; i < prizes.length; i++) {
            totalRemaining += prizes[i].subPrizeRemainingQuantity;
        }
        if (totalRemaining == 0) revert NotEnoughNFTsRemaining();

        uint256 cursor;
        uint256 winningIndex = randomWord % totalRemaining;
        for (uint256 i = 0; i < prizes.length; i++) {
            cursor += prizes[i].subPrizeRemainingQuantity;
            if (winningIndex < cursor) {
                prizes[i].subPrizeRemainingQuantity -= 1;
                emit UpdatePrize(seriesID, prizes[i].subPrizeID, prizes[i].subPrizeRemainingQuantity);
                return prizes[i].subPrizeID;
            }
        }
        revert InvalidSeriesInput();
    }

    function _validateSeriesInput(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes
    ) internal pure {
        if (input.totalTicketNumbers == 0 || input.priceInPoints == 0) revert InvalidSeriesInput();
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

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721AUpgradeable) returns (bool) {
        return ERC721AUpgradeable.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    mapping(uint256 => uint256) public seriesLockDuration;

    uint256[39] private __gap;
}
