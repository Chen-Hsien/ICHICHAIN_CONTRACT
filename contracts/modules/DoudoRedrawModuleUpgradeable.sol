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

    struct RedrawConfig {
        uint16 mainBurnCount;
        uint16 consolationBurnCount;
    }

    struct RequestContext {
        uint256 seriesID;
        address user;
        bool consolation;
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

    event BundleModuleUpdated(address indexed bundleModule);
    event RedrawConfigUpdated(uint256 indexed seriesID, uint16 mainBurnCount, uint16 consolationBurnCount);
    event RedrawRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, bool consolation);
    event RedrawFulfilled(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed user,
        uint256 tokenID,
        bool consolation
    );
    event ConsolationDrawBalanceUpdated(uint256 indexed seriesID, address indexed user, uint256 balance);

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

    function setBundleModule(address bundleModule_) external onlyRole(OPERATION_ROLE) {
        bundleModule = bundleModule_;
        emit BundleModuleUpdated(bundleModule_);
    }

    function setRedrawConfig(
        uint256 seriesID,
        uint16 mainBurnCount,
        uint16 consolationBurnCount
    ) external onlyRole(OPERATION_ROLE) {
        redrawConfigs[seriesID] = RedrawConfig({
            mainBurnCount: mainBurnCount,
            consolationBurnCount: consolationBurnCount
        });
        emit RedrawConfigUpdated(seriesID, mainBurnCount, consolationBurnCount);
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
        if (tokenIDs.length != redrawConfigs[seriesID].mainBurnCount) revert RedrawCountMismatch();
        _burnInputs(seriesID, tokenIDs, true);
        _request(seriesID, msg.sender, false);
    }

    function redrawConsolation(uint256 seriesID, uint256[] calldata tokenIDs) external nonReentrant {
        if (tokenIDs.length != redrawConfigs[seriesID].consolationBurnCount) revert RedrawCountMismatch();
        _burnInputs(seriesID, tokenIDs, false);
        _request(seriesID, msg.sender, true);
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
    ) external override {
        if (msg.sender != address(router)) revert OnlyRouter(msg.sender);
        if (randomWords.length == 0) revert InvalidConfig();

        RequestContext memory context = requestContexts[requestId];
        if (context.user == address(0)) revert InvalidConfig();
        delete requestContexts[requestId];

        uint256 prizeID = core.moduleDrawPrize(context.seriesID, randomWords[0]);
        uint256 tokenID = core.moduleMintRevealed(context.user, context.seriesID, prizeID, 0);
        emit RedrawFulfilled(requestId, context.seriesID, context.user, tokenID, context.consolation);
    }

    function _burnInputs(
        uint256 seriesID,
        uint256[] calldata tokenIDs,
        bool returnMainPrize
    ) internal {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            (uint256 burnedSeriesID,) = core.moduleBurnForRedraw(tokenIDs[i], msg.sender, returnMainPrize);
            if (burnedSeriesID != seriesID) revert MixedSeries();
        }
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

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[45] private __gap;
}
