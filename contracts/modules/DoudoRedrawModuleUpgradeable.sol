// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoCore.sol";
import "../interfaces/IDoudoVRFCallback.sol";
import "../interfaces/IDoudoVRFRouter.sol";
import "../interfaces/IDoudoRedrawCredits.sol";
import "../security/LightweightGuardsUpgradeable.sol";

contract DoudoRedrawModuleUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable,
    IDoudoVRFCallback,
    IDoudoRedrawCredits
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 private constant MAX_REVEAL_BATCH = 20;

    struct RedrawConfig {
        uint16 mainBurnCount;
        uint16 consolationBurnCount;
    }

    struct RequestContext {
        uint256 seriesID;
        address user;
        bool consolation;
    }

    struct SubPrize {
        uint256 subPrizeID;
        string prizeGroup;
        string subPrizeName;
        uint256 subPrizeRemainingQuantity;
    }

    IDoudoCore public core;
    IDoudoVRFRouter public router;
    address public bundleModule;

    mapping(uint256 => RedrawConfig) public redrawConfigs;
    mapping(uint256 => RequestContext) public requestContexts;
    mapping(uint256 => mapping(address => uint256)) public consolationDrawBalances;

    error InvalidConfig();
    error OnlyRouter(address caller);
    error OnlyBundleModule(address caller);
    error RedrawCountMismatch();
    error EmptyConsolationBalance();
    error MixedSeries();
    error RedrawDisabled();

    event RouterUpdated(address indexed router);
    event BundleModuleUpdated(address indexed bundleModule);
    event RedrawConfigUpdated(uint256 indexed seriesID, uint16 mainBurnCount, uint16 consolationBurnCount);
    event RedrawMainConfigUpdated(uint256 indexed seriesID, uint16 mainBurnCount, uint16 mainMintCount);
    event RedrawEnabledUpdated(uint256 indexed seriesID, bool enabled);
    event RedrawRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, bool consolation);
    event RedrawFulfilled(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed user,
        uint256 tokenID,
        bool consolation
    );
    event RedrawMinted(uint256 indexed seriesID, address indexed user, uint256 quantity, uint256 firstTokenID);
    event ConsolationDrawBalanceUpdated(uint256 indexed seriesID, address indexed user, uint256 balance);
    event NewConsolationPrize(
        uint256 indexed seriesID,
        uint256 subPrizeID,
        string prizeGroup,
        string subPrizeName,
        uint256 remainingQuantity
    );
    event UpdateConsolationPrize(uint256 indexed seriesID, uint256 subPrizeID, uint256 remainingQuantity);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address coreAddress, address routerAddress) public initializer {
        if (coreAddress == address(0) || routerAddress == address(0)) revert InvalidConfig();
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(msg.sender);
        __LightweightGuards_init();

        core = IDoudoCore(coreAddress);
        router = IDoudoVRFRouter(routerAddress);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
    }

    function setRouter(address routerAddress) external onlyRole(OPERATION_ROLE) {
        if (routerAddress == address(0)) revert InvalidConfig();
        if (routerAddress != address(router)) {
            if (router.pendingRequests() != 0) revert InvalidConfig();
            router = IDoudoVRFRouter(routerAddress);
        }
        emit RouterUpdated(routerAddress);
    }

    function setBundleModule(address bundleModule_) external onlyRole(OPERATION_ROLE) {
        bundleModule = bundleModule_;
        emit BundleModuleUpdated(bundleModule_);
    }

    function setRedrawConfig(
        uint256 seriesID,
        uint16 mainBurnCount,
        uint16 consolationBurnCount
    ) external onlyRole(OPERATION_ROLE) {
        _setRedrawConfig(seriesID, mainBurnCount, mainBurnCount, consolationBurnCount);
    }

    function setRedrawMainConfig(
        uint256 seriesID,
        uint16 mainBurnCount,
        uint16 mainMintCount
    ) external onlyRole(OPERATION_ROLE) {
        if (mainBurnCount == 0 || mainMintCount == 0) revert InvalidConfig();
        RedrawConfig memory config = redrawConfigs[seriesID];
        _setRedrawConfig(seriesID, mainBurnCount, mainMintCount, config.consolationBurnCount);
    }

    function setRedrawEnabled(uint256 seriesID, bool enabled) external onlyRole(OPERATION_ROLE) {
        redrawEnabled[seriesID] = enabled;
        emit RedrawEnabledUpdated(seriesID, enabled);
    }

    function setConsolationPrizes(
        uint256 seriesID,
        SubPrize[] calldata prizes
    ) external onlyRole(OPERATION_ROLE) {
        if (prizes.length == 0) revert InvalidConfig();
        delete consolationPrizes[seriesID];
        for (uint256 i = 0; i < prizes.length; i++) {
            if (prizes[i].subPrizeRemainingQuantity == 0) revert InvalidConfig();
            consolationPrizes[seriesID].push(prizes[i]);
            emit NewConsolationPrize(
                seriesID,
                prizes[i].subPrizeID,
                prizes[i].prizeGroup,
                prizes[i].subPrizeName,
                prizes[i].subPrizeRemainingQuantity
            );
        }
    }

    function getConsolationPrizes(uint256 seriesID) external view returns (SubPrize[] memory) {
        return consolationPrizes[seriesID];
    }

    function creditConsolationDraws(
        uint256 seriesID,
        address user,
        uint256 amount
    ) external override {
        if (msg.sender != bundleModule) revert OnlyBundleModule(msg.sender);
        if (user == address(0) || amount == 0) revert InvalidConfig();
        consolationDrawBalances[seriesID][user] += amount;
        emit ConsolationDrawBalanceUpdated(seriesID, user, consolationDrawBalances[seriesID][user]);
    }

    function redrawMain(uint256 seriesID, uint256[] calldata tokenIDs) external nonReentrant {
        RedrawConfig memory config = redrawConfigs[seriesID];
        uint16 mainMintCount = redrawMainMintCounts[seriesID];
        if (mainMintCount == 0) {
            mainMintCount = config.mainBurnCount;
        }
        uint256 burnQuantity = tokenIDs.length;
        if (burnQuantity == 0) revert InvalidConfig();
        if (!redrawEnabled[seriesID] || config.mainBurnCount == 0 || mainMintCount == 0) revert RedrawDisabled();
        if (burnQuantity != config.mainBurnCount) revert RedrawCountMismatch();
        for (uint256 i = 0; i < burnQuantity; i++) {
            uint256 burnedSeriesID = core.moduleBurnForRedraw(tokenIDs[i], msg.sender);
            if (burnedSeriesID != seriesID) revert MixedSeries();
        }
        uint16[] memory autoAssignedLuckyNumbers = new uint16[](mainMintCount);
        uint256 firstTokenID = core.moduleMintUnrevealed(
            msg.sender,
            seriesID,
            autoAssignedLuckyNumbers,
            0,
            false
        );
        _requestRevealForMintedTokens(seriesID, firstTokenID, mainMintCount);
        emit RedrawMinted(seriesID, msg.sender, mainMintCount, firstTokenID);
    }

    function drawConsolation(uint256 seriesID) external nonReentrant {
        uint256 balance = consolationDrawBalances[seriesID][msg.sender];
        if (balance == 0) revert EmptyConsolationBalance();
        consolationDrawBalances[seriesID][msg.sender] = balance - 1;
        emit ConsolationDrawBalanceUpdated(seriesID, msg.sender, balance - 1);
        _request(seriesID, msg.sender, true);
    }

    function fulfillRandomWordsFromRouter(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external override nonReentrant {
        if (msg.sender != address(router)) revert OnlyRouter(msg.sender);
        if (randomWords.length == 0) revert InvalidConfig();

        RequestContext memory context = requestContexts[requestId];
        if (context.user == address(0)) revert InvalidConfig();
        delete requestContexts[requestId];

        uint256 prizeID = _drawConsolationPrize(context.seriesID, randomWords[0]);
        uint256 tokenID = core.moduleMintRevealed(context.user, context.seriesID, prizeID);
        emit RedrawFulfilled(requestId, context.seriesID, context.user, tokenID, context.consolation);
    }

    function _request(uint256 seriesID, address user, bool consolation) internal returns (uint256 requestId) {
        requestId = router.requestRandomWords(address(this), 1);
        requestContexts[requestId] = RequestContext({
            seriesID: seriesID,
            user: user,
            consolation: consolation
        });
        emit RedrawRequested(requestId, seriesID, user, consolation);
    }

    function _requestRevealForMintedTokens(
        uint256 seriesID,
        uint256 firstTokenID,
        uint256 quantity
    ) internal {
        for (uint256 offset = 0; offset < quantity; offset += MAX_REVEAL_BATCH) {
            uint256 batchSize = quantity - offset;
            if (batchSize > MAX_REVEAL_BATCH) {
                batchSize = MAX_REVEAL_BATCH;
            }
            uint256[] memory tokenIDs = new uint256[](batchSize);
            for (uint256 i = 0; i < batchSize; i++) {
                tokenIDs[i] = firstTokenID + offset + i;
            }
            core.reveal(seriesID, tokenIDs);
        }
    }

    function _drawConsolationPrize(uint256 seriesID, uint256 randomWord) internal returns (uint256 subPrizeID) {
        SubPrize[] storage prizes = consolationPrizes[seriesID];
        uint256 totalRemaining;
        for (uint256 i = 0; i < prizes.length; i++) {
            totalRemaining += prizes[i].subPrizeRemainingQuantity;
        }
        if (totalRemaining == 0) revert InvalidConfig();

        uint256 cursor;
        uint256 winningIndex = randomWord % totalRemaining;
        for (uint256 i = 0; i < prizes.length; i++) {
            cursor += prizes[i].subPrizeRemainingQuantity;
            if (winningIndex < cursor) {
                prizes[i].subPrizeRemainingQuantity -= 1;
                emit UpdateConsolationPrize(seriesID, prizes[i].subPrizeID, prizes[i].subPrizeRemainingQuantity);
                return prizes[i].subPrizeID;
            }
        }
        revert InvalidConfig();
    }

    function _setRedrawConfig(
        uint256 seriesID,
        uint16 mainBurnCount,
        uint16 mainMintCount,
        uint16 consolationBurnCount
    ) internal {
        redrawConfigs[seriesID] = RedrawConfig({
            mainBurnCount: mainBurnCount,
            consolationBurnCount: consolationBurnCount
        });
        redrawMainMintCounts[seriesID] = mainMintCount;
        redrawEnabled[seriesID] = mainBurnCount != 0 && mainMintCount != 0;
        emit RedrawConfigUpdated(seriesID, mainBurnCount, consolationBurnCount);
        emit RedrawMainConfigUpdated(seriesID, mainBurnCount, mainMintCount);
        emit RedrawEnabledUpdated(seriesID, redrawEnabled[seriesID]);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    mapping(uint256 => bool) public redrawEnabled;
    mapping(uint256 => SubPrize[]) private consolationPrizes;
    mapping(uint256 => uint16) public redrawMainMintCounts;

    uint256[42] private __gap;
}
