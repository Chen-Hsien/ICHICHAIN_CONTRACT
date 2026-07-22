// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import "erc721a/contracts/ERC721A.sol";
import "./interfaces/IDoudoPoints.sol";
import "./helpers/SafeERC721AReceiver.sol";

contract DOUDOCHAINV2 is
    ERC721A,
    AccessControl,
    ReentrancyGuard,
    Pausable,
    VRFConsumerBaseV2Plus
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant ADMINMINT_ROLE = keccak256("ADMINMINT_ROLE");
    bytes32 public constant COLLECTION_BOOK_ROLE = keccak256("COLLECTION_BOOK_ROLE");
    uint256 private constant MAX_REVEAL_BATCH = 20;
    uint256 private constant LAST_PRIZE_ID = 999;
    uint256 private constant MAX_MINT_LOCK_DURATION = 600;

    IDoudoPoints public immutable doudoPoints;
    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;
    uint16 public requestConfirmations;
    uint32 public callbackGasLimit = 2_500_000;

    enum PackingType {
        Unknown,
        Assorted,
        OriginalCase
    }

    enum SourceType {
        Unknown,
        Japan,
        Distributor
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
        PackingType packingType;
        SourceType sourceType;
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
        PackingType packingType;
        SourceType sourceType;
    }

    struct TicketStatus {
        uint256 seriesID;
        uint256 tokenRevealedPrize;
        bool tokenExchange;
        bool tokenRevealed;
        uint16 luckyNumber;
    }

    struct Bundle {
        uint16 quantity;
        uint256 pricePoints;
        uint256 rebatePoints;
        uint16 consolationDraws;
    }

    struct TokenRange {
        uint256 start;
        uint256 end;
    }

    struct CollectionRewardConfig {
        uint256 seriesID;
        uint256 subPrizeID;
        bool revealed;
        bool active;
    }

    enum RequestKind {
        Reveal,
        LastPrize,
        RedrawMain,
        RedrawConsolation
    }

    mapping(uint256 => Series) private seriesData;
    mapping(uint256 => SubPrize[]) public seriesSubPrizes;
    mapping(uint256 => Bundle[]) public seriesBundles;
    mapping(uint256 => TicketStatus) public ticketStatusDetail;
    mapping(uint256 => mapping(uint16 => bool)) public luckyNumberUsed;
    mapping(uint256 => mapping(address => uint256)) public mintedPerWallet;
    mapping(uint256 => address) public mintLockOwner;
    mapping(uint256 => uint256) public mintLockUntil;
    mapping(uint256 => uint256) public pointsPaid;
    mapping(uint256 => TokenRange[]) public seriesRanges;
    mapping(uint256 => uint256) public totalMintedInSeries;
    mapping(address => uint256) public consolationDraws;
    mapping(uint256 => CollectionRewardConfig) public collectionRewardConfigs;
    mapping(uint256 => mapping(address => bool)) public seriesUnlockedFor;
    mapping(uint256 => uint16) public redrawMainBurnCount;
    mapping(uint256 => uint16) public redrawConsolationBurnCount;
    mapping(uint256 => RequestKind) public requestKind;
    mapping(uint256 => uint256[]) public requestToRevealToken;
    mapping(uint256 => uint256) public requestToRedrawSeries;
    mapping(uint256 => address) public requestToRedrawUser;
    mapping(uint256 => address[]) public lastPrizeOwners;
    mapping(uint256 => bool) public lastPrizeRequestPending;

    uint256 private seriesCounter;
    uint256 public defaultLockDuration = MAX_MINT_LOCK_DURATION;

    error EmptySubPrizes();
    error SubprizeQuantityNotEqual();
    error InvalidSeriesInput();
    error GoodsNotArrived();
    error NotEnoughNFTsRemaining();
    error LuckyNumberTaken();
    error LuckyNumberOutOfRange();
    error WalletCapExceeded();
    error SeriesReserved();
    error InvalidBundle();
    error SeriesIsRefund();
    error SeriesIsNotRefund();
    error NotTheTokenOwner();
    error TokenAlreadyRevealed();
    error TokenAlreadyExchanged();
    error RevealBatchTooLarge();
    error RedrawCountMismatch();
    error NotEligibleForRedraw();
    error CollectionRewardNotConfigured();
    error NoConsolationDraws();
    error NotSoldOutYet();
    error AlreadyChoseWinner();

    event NewSeries(uint256 indexed seriesID, string seriesName);
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
    event BundleMinted(
        address indexed user,
        uint256 indexed seriesID,
        uint256 indexed bundleIndex,
        uint16 quantity,
        uint256 pricePoints,
        uint256 rebatePoints,
        uint16 consolationDraws
    );
    event RefundSeries(uint256 indexed seriesID, bool isRefund);
    event RefundClaimed(address indexed user, uint256 indexed seriesID, uint256 amount, uint256 quantity);
    event RevealRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, uint256 quantity);
    event PrizeRevealed(uint256 indexed requestId, uint256 indexed seriesID, uint256 indexed tokenID, uint256 subPrizeID);
    event RedrawRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, bool consolation);
    event LastPrizeDraw(uint256 indexed requestId, uint256 indexed seriesID, uint32 quantity);
    event CollectionRewardConfigSet(
        uint256 indexed rewardData,
        uint256 indexed seriesID,
        uint256 subPrizeID,
        bool revealed,
        bool active
    );
    event CollectionRewardMinted(
        address indexed to,
        uint256 indexed rewardData,
        uint256 indexed seriesID,
        uint256 tokenID,
        uint256 subPrizeID,
        bool revealed
    );
    event SeriesUnlockedFor(address indexed user, uint256 indexed seriesID, address indexed operator);

    constructor(
        address doudoPointsAddress,
        address vrfCoordinator,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 minimumRequestConfirmations
    ) ERC721A("DOUDOCHAINV2", "DOUDOV2") VRFConsumerBaseV2Plus(vrfCoordinator) {
        if (doudoPointsAddress == address(0)) revert InvalidSeriesInput();
        doudoPoints = IDoudoPoints(doudoPointsAddress);
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        requestConfirmations = minimumRequestConfirmations;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
        _grantRole(ADMINMINT_ROLE, msg.sender);
        _grantRole(COLLECTION_BOOK_ROLE, msg.sender);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721A, AccessControl) returns (bool) {
        return ERC721A.supportsInterface(interfaceId) || AccessControl.supportsInterface(interfaceId);
    }

    function createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool markGoodsArrived
    ) external onlyRole(OPERATION_ROLE) returns (uint256 seriesID) {
        seriesID = _createSeriesWithSubPrizes(input, subPrizes, markGoodsArrived);
    }

    function batchCreateSeriesWithSubPrizes(
        SeriesInput[] calldata inputs,
        SubPrize[][] calldata subPrizesList,
        bool[] calldata markGoodsArrivedList
    ) external onlyRole(OPERATION_ROLE) returns (uint256[] memory seriesIDs) {
        if (inputs.length == 0 || inputs.length != subPrizesList.length || inputs.length != markGoodsArrivedList.length) {
            revert InvalidSeriesInput();
        }

        seriesIDs = new uint256[](inputs.length);
        for (uint256 i = 0; i < inputs.length; i++) {
            seriesIDs[i] = _createSeriesWithSubPrizes(inputs[i], subPrizesList[i], markGoodsArrivedList[i]);
        }
    }

    function doudoSeries(
        uint256 seriesID
    )
        external
        view
        returns (
            string memory seriesName,
            uint256 totalTicketNumbers,
            uint256 remainingTicketNumbers,
            uint256 priceInPoints,
            bool isGoodsArrived,
            uint256 estimateDeliverTime,
            uint256 exchangeExpireTime,
            uint256 priceInTWD,
            bool isRefund,
            bool isPreOrder,
            bool useLuckyNumber,
            uint256 maxPerWallet,
            PackingType packingType,
            SourceType sourceType
        )
    {
        Series storage series = seriesData[seriesID];
        return (
            series.seriesName,
            series.totalTicketNumbers,
            series.remainingTicketNumbers,
            series.priceInPoints,
            series.isGoodsArrived,
            series.estimateDeliverTime,
            series.exchangeExpireTime,
            series.priceInTWD,
            series.isRefund,
            series.isPreOrder,
            series.useLuckyNumber,
            series.maxPerWallet,
            series.packingType,
            series.sourceType
        );
    }

    function seriesURIs(
        uint256 seriesID
    )
        external
        view
        returns (
            string memory exchangeTokenURI,
            string memory unrevealTokenURI,
            string memory revealTokenURI,
            string memory seriesMetaDataURI
        )
    {
        Series storage series = seriesData[seriesID];
        return (
            series.exchangeTokenURI,
            series.unrevealTokenURI,
            series.revealTokenURI,
            series.seriesMetaDataURI
        );
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

    function pause() external onlyRole(OPERATION_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATION_ROLE) {
        _unpause();
    }

    function setSeriesRefund(uint256 seriesID, bool isRefund) external onlyRole(OPERATION_ROLE) {
        Series storage series = seriesData[seriesID];
        if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
        series.isRefund = isRefund;
        emit RefundSeries(seriesID, isRefund);
    }

    function mint(uint256 seriesID, uint16[] calldata luckyNumbers) external nonReentrant whenNotPaused {
        Series storage series = seriesData[seriesID];
        uint256 quantity = luckyNumbers.length;
        if (!series.isGoodsArrived) revert GoodsNotArrived();
        if (series.isRefund) revert SeriesIsRefund();
        if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        _checkAndRefreshMintLock(seriesID, msg.sender);
        _checkWalletCap(seriesID, msg.sender, quantity);
        doudoPoints.burnFromWithReason(msg.sender, quantity * series.priceInPoints, keccak256("LOTTERY_MINT"));
        _mintTickets(seriesID, msg.sender, luckyNumbers, series.priceInPoints);
    }

    function setSeriesBundles(
        uint256 seriesID,
        Bundle[] calldata bundles
    ) external onlyRole(OPERATION_ROLE) {
        if (seriesData[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
        delete seriesBundles[seriesID];
        for (uint256 i = 0; i < bundles.length; i++) {
            if (bundles[i].quantity == 0 || bundles[i].pricePoints == 0) revert InvalidBundle();
            seriesBundles[seriesID].push(bundles[i]);
        }
    }

    function mintBundle(
        uint256 seriesID,
        uint256 bundleIndex,
        uint16[] calldata luckyNumbers
    ) external nonReentrant whenNotPaused {
        if (bundleIndex >= seriesBundles[seriesID].length) revert InvalidBundle();
        Bundle memory bundle = seriesBundles[seriesID][bundleIndex];
        if (luckyNumbers.length != bundle.quantity) revert InvalidBundle();

        Series storage series = seriesData[seriesID];
        if (!series.isGoodsArrived) revert GoodsNotArrived();
        if (series.isRefund) revert SeriesIsRefund();
        if (bundle.quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
        _checkAndRefreshMintLock(seriesID, msg.sender);
        _checkWalletCap(seriesID, msg.sender, bundle.quantity);

        doudoPoints.burnFromWithReason(msg.sender, bundle.pricePoints, keccak256("LOTTERY_BUNDLE"));
        _mintTickets(seriesID, msg.sender, luckyNumbers, bundle.pricePoints / bundle.quantity);
        if (bundle.rebatePoints > 0) {
            doudoPoints.mintWithReason(msg.sender, bundle.rebatePoints, keccak256("BUNDLE_REBATE"));
        }
        consolationDraws[msg.sender] += bundle.consolationDraws;

        emit BundleMinted(
            msg.sender,
            seriesID,
            bundleIndex,
            bundle.quantity,
            bundle.pricePoints,
            bundle.rebatePoints,
            bundle.consolationDraws
        );
    }

    function claimRefund(uint256[] calldata tokenIDs) external nonReentrant {
        if (tokenIDs.length == 0) revert InvalidSeriesInput();
        uint256 seriesID = ticketStatusDetail[tokenIDs[0]].seriesID;
        Series storage series = seriesData[seriesID];
        if (!series.isRefund) revert SeriesIsNotRefund();

        uint256 refundAmount;
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenId = tokenIDs[i];
            if (ownerOf(tokenId) != msg.sender) revert NotTheTokenOwner();
            TicketStatus storage status = ticketStatusDetail[tokenId];
            if (status.seriesID != seriesID) revert InvalidSeriesInput();
            if (status.tokenRevealed) revert TokenAlreadyRevealed();
            if (status.tokenExchange) revert TokenAlreadyExchanged();

            refundAmount += pointsPaid[tokenId];
            status.tokenExchange = true;
            _burn(tokenId);
        }

        doudoPoints.mintWithReason(msg.sender, refundAmount, keccak256("REFUND"));
        emit RefundClaimed(msg.sender, seriesID, refundAmount, tokenIDs.length);
    }

    function reveal(uint256 seriesID, uint256[] calldata tokenIDs) external whenNotPaused {
        if (tokenIDs.length == 0) revert InvalidSeriesInput();
        if (tokenIDs.length > MAX_REVEAL_BATCH) revert RevealBatchTooLarge();
        _validateRevealTokens(seriesID, tokenIDs, msg.sender);
        _requestRevealRandomWords(seriesID, tokenIDs);
    }

    function setRedrawConfig(
        uint256 seriesID,
        uint16 mainBurnCount,
        uint16 consolationBurnCount
    ) external onlyRole(OPERATION_ROLE) {
        redrawMainBurnCount[seriesID] = mainBurnCount;
        redrawConsolationBurnCount[seriesID] = consolationBurnCount;
    }

    function redrawMain(
        uint256 seriesID,
        uint256[] calldata tokenIDs
    ) external nonReentrant whenNotPaused {
        if (tokenIDs.length != redrawMainBurnCount[seriesID]) revert RedrawCountMismatch();
        _burnRedrawInputs(seriesID, tokenIDs, msg.sender, true);
        _requestRedrawRandomWords(seriesID, false);
    }

    function redrawConsolation(
        uint256 seriesID,
        uint256[] calldata tokenIDs
    ) external nonReentrant whenNotPaused {
        if (tokenIDs.length != redrawConsolationBurnCount[seriesID]) revert RedrawCountMismatch();
        _burnRedrawInputs(seriesID, tokenIDs, msg.sender, false);
        _requestRedrawRandomWords(seriesID, true);
    }

    function drawConsolation(uint256 seriesID) external nonReentrant whenNotPaused {
        if (consolationDraws[msg.sender] == 0) revert NoConsolationDraws();
        if (seriesData[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
        consolationDraws[msg.sender] -= 1;
        _requestRedrawRandomWords(seriesID, true);
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
        _requestLastPrizeRandomWords(seriesID, quantity);
    }

    function setCollectionRewardConfig(
        uint256 rewardData,
        uint256 seriesID,
        uint256 subPrizeID,
        bool revealed
    ) external onlyRole(OPERATION_ROLE) {
        if (seriesData[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
        collectionRewardConfigs[rewardData] = CollectionRewardConfig({
            seriesID: seriesID,
            subPrizeID: subPrizeID,
            revealed: revealed,
            active: true
        });
        emit CollectionRewardConfigSet(rewardData, seriesID, subPrizeID, revealed, true);
    }

    function mintCollectionReward(
        address to,
        uint256 rewardData
    ) external onlyRole(COLLECTION_BOOK_ROLE) nonReentrant returns (uint256 tokenId) {
        CollectionRewardConfig memory config = collectionRewardConfigs[rewardData];
        if (!config.active) revert CollectionRewardNotConfigured();
        if (config.revealed && config.subPrizeID != 0) {
            _consumePrizeSlot(config.seriesID, config.subPrizeID);
        }
        tokenId = _mintOneTicketWithoutPoints(config.seriesID, to, config.subPrizeID, config.revealed);
        emit CollectionRewardMinted(to, rewardData, config.seriesID, tokenId, config.subPrizeID, config.revealed);
    }

    function unlockSeriesFor(address user, uint256 seriesID) external onlyRole(COLLECTION_BOOK_ROLE) {
        if (seriesData[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
        seriesUnlockedFor[seriesID][user] = true;
        emit SeriesUnlockedFor(user, seriesID, msg.sender);
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
        series.packingType = input.packingType;
        series.sourceType = input.sourceType;

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

        emit NewSeries(seriesID, input.seriesName);
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

    function _mintTickets(
        uint256 seriesID,
        address to,
        uint16[] calldata luckyNumbers,
        uint256 paidPointsPerTicket
    ) internal {
        Series storage series = seriesData[seriesID];
        uint256 quantity = luckyNumbers.length;
        uint256 startTokenId = _nextTokenId();
        _mint(to, quantity);
        for (uint256 i = 0; i < quantity; i++) {
            uint16 luckyNumber = _consumeLuckyNumber(seriesID, series.useLuckyNumber, luckyNumbers[i]);
            uint256 tokenId = startTokenId + i;
            ticketStatusDetail[tokenId].seriesID = seriesID;
            ticketStatusDetail[tokenId].luckyNumber = luckyNumber;
            pointsPaid[tokenId] = paidPointsPerTicket;
            emit NewTicketStatus(tokenId, seriesID, 0, false, false, to, luckyNumber);
        }
        series.remainingTicketNumbers -= quantity;
        mintedPerWallet[seriesID][to] += quantity;
        totalMintedInSeries[seriesID] += quantity;
        _recordSeriesRange(seriesID, startTokenId, quantity);
        SafeERC721AReceiver.notify(msg.sender, to, startTokenId, quantity);
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

    function _checkWalletCap(uint256 seriesID, address user, uint256 quantity) internal view {
        uint256 cap = seriesData[seriesID].maxPerWallet;
        if (cap != 0 && mintedPerWallet[seriesID][user] + quantity > cap) revert WalletCapExceeded();
    }

    function _checkAndRefreshMintLock(uint256 seriesID, address user) internal {
        if (block.timestamp < mintLockUntil[seriesID] && mintLockOwner[seriesID] != user) {
            revert SeriesReserved();
        }
        uint256 duration = defaultLockDuration;
        if (duration > MAX_MINT_LOCK_DURATION) {
            duration = MAX_MINT_LOCK_DURATION;
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

    function _mintOneTicketWithoutPoints(
        uint256 seriesID,
        address to,
        uint256 subPrizeID,
        bool revealed
    ) internal returns (uint256 tokenId) {
        Series storage series = seriesData[seriesID];
        if (!series.isGoodsArrived) revert GoodsNotArrived();
        if (series.remainingTicketNumbers == 0) revert NotEnoughNFTsRemaining();

        tokenId = _nextTokenId();
        _mint(to, 1);
        ticketStatusDetail[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: revealed ? subPrizeID : 0,
            tokenExchange: false,
            tokenRevealed: revealed,
            luckyNumber: 0
        });
        series.remainingTicketNumbers -= 1;
        mintedPerWallet[seriesID][to] += 1;
        totalMintedInSeries[seriesID] += 1;
        _recordSeriesRange(seriesID, tokenId, 1);
        emit NewTicketStatus(tokenId, seriesID, revealed ? subPrizeID : 0, false, revealed, to, 0);
        SafeERC721AReceiver.notify(msg.sender, to, tokenId, 1);
    }

    function _mintLastPrizeToken(uint256 seriesID, address to) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId();
        _mint(to, 1);
        ticketStatusDetail[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: LAST_PRIZE_ID,
            tokenExchange: false,
            tokenRevealed: true,
            luckyNumber: 0
        });
        emit NewTicketStatus(tokenId, seriesID, LAST_PRIZE_ID, false, true, to, 0);
        SafeERC721AReceiver.notify(msg.sender, to, tokenId, 1);
    }

    function _consumePrizeSlot(uint256 seriesID, uint256 subPrizeID) internal {
        SubPrize[] storage prizes = seriesSubPrizes[seriesID];
        for (uint256 i = 0; i < prizes.length; i++) {
            if (prizes[i].subPrizeID == subPrizeID) {
                if (prizes[i].subPrizeRemainingQuantity == 0) revert NotEnoughNFTsRemaining();
                prizes[i].subPrizeRemainingQuantity -= 1;
                return;
            }
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

    function _burnRedrawInputs(
        uint256 seriesID,
        uint256[] calldata tokenIDs,
        address user,
        bool returnMainPrizeSlots
    ) internal {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenId = tokenIDs[i];
            if (ownerOf(tokenId) != user) revert NotTheTokenOwner();
            TicketStatus storage status = ticketStatusDetail[tokenId];
            if (status.seriesID != seriesID || !status.tokenRevealed || status.tokenExchange) {
                revert NotEligibleForRedraw();
            }
            if (returnMainPrizeSlots) {
                _returnPrizeSlot(seriesID, status.tokenRevealedPrize);
            }
            _burn(tokenId);
        }
    }

    function _returnPrizeSlot(uint256 seriesID, uint256 subPrizeID) internal {
        SubPrize[] storage prizes = seriesSubPrizes[seriesID];
        for (uint256 i = 0; i < prizes.length; i++) {
            if (prizes[i].subPrizeID == subPrizeID) {
                prizes[i].subPrizeRemainingQuantity += 1;
                return;
            }
        }
        revert InvalidSeriesInput();
    }

    function _requestRevealRandomWords(
        uint256 seriesID,
        uint256[] calldata tokenIDs
    ) internal returns (uint256 requestId) {
        requestId = _requestRandomWords();
        requestKind[requestId] = RequestKind.Reveal;
        requestToRedrawSeries[requestId] = seriesID;
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            requestToRevealToken[requestId].push(tokenIDs[i]);
        }
        emit RevealRequested(requestId, seriesID, msg.sender, tokenIDs.length);
    }

    function _requestRedrawRandomWords(
        uint256 seriesID,
        bool consolation
    ) internal returns (uint256 requestId) {
        requestId = _requestRandomWords();
        requestKind[requestId] = consolation ? RequestKind.RedrawConsolation : RequestKind.RedrawMain;
        requestToRedrawSeries[requestId] = seriesID;
        requestToRedrawUser[requestId] = msg.sender;
        emit RedrawRequested(requestId, seriesID, msg.sender, consolation);
    }

    function _requestRandomWords() internal returns (uint256 requestId) {
        requestId = _requestRandomWords(1);
    }

    function _requestLastPrizeRandomWords(
        uint256 seriesID,
        uint32 quantity
    ) internal returns (uint256 requestId) {
        requestId = _requestRandomWords(quantity);
        requestKind[requestId] = RequestKind.LastPrize;
        requestToRedrawSeries[requestId] = seriesID;
        lastPrizeRequestPending[seriesID] = true;
        emit LastPrizeDraw(requestId, seriesID, quantity);
    }

    function _requestRandomWords(uint32 numWords) internal returns (uint256 requestId) {
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
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

    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal virtual override nonReentrant {
        if (requestKind[requestId] == RequestKind.Reveal) {
            _fulfillReveal(requestId, randomWords[0]);
        } else if (requestKind[requestId] == RequestKind.LastPrize) {
            _fulfillLastPrize(requestId, randomWords);
        } else if (requestKind[requestId] == RequestKind.RedrawMain) {
            _fulfillRedraw(requestId, randomWords[0], false);
        } else if (requestKind[requestId] == RequestKind.RedrawConsolation) {
            _fulfillRedraw(requestId, randomWords[0], true);
        }
    }

    function _fulfillReveal(uint256 requestId, uint256 randomWord) internal {
        uint256 seriesID = requestToRedrawSeries[requestId];
        uint256[] storage tokenIDs = requestToRevealToken[requestId];
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
            emit PrizeRevealed(requestId, seriesID, tokenId, prizeId);
        }

        delete requestToRevealToken[requestId];
        delete requestToRedrawSeries[requestId];
        delete requestKind[requestId];
    }

    function _fulfillRedraw(uint256 requestId, uint256 randomWord, bool) internal {
        uint256 seriesID = requestToRedrawSeries[requestId];
        address user = requestToRedrawUser[requestId];
        uint256 prizeId = _drawPrize(seriesID, randomWord);
        uint256 tokenId = _mintOneTicketWithoutPoints(seriesID, user, prizeId, true);
        emit PrizeRevealed(requestId, seriesID, tokenId, prizeId);

        delete requestToRedrawSeries[requestId];
        delete requestToRedrawUser[requestId];
        delete requestKind[requestId];
    }

    function _fulfillLastPrize(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal {
        uint256 seriesID = requestToRedrawSeries[requestId];

        for (uint256 i = 0; i < randomWords.length; i++) {
            uint256 sourceTokenId = _selectExistingTokenFromSeries(seriesID, randomWords[i]);
            address winner = ownerOf(sourceTokenId);
            _mintLastPrizeToken(seriesID, winner);
            lastPrizeOwners[seriesID].push(winner);
        }

        lastPrizeRequestPending[seriesID] = false;
        delete requestToRedrawSeries[requestId];
        delete requestKind[requestId];
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
                return prizes[i].subPrizeID;
            }
        }
        revert InvalidSeriesInput();
    }
}
