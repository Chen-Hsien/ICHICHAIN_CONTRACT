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

contract DoudoRedrawModuleUpgradeableV1Harness is
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
    error OnlyBundleModule(address caller);

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
    }

    function seedForUpgrade(address bundleModule_, address user) external onlyRole(OPERATION_ROLE) {
        bundleModule = bundleModule_;
        redrawConfigs[0] = RedrawConfig({mainBurnCount: 2, consolationBurnCount: 1});
        requestContexts[77] = RequestContext({seriesID: 0, user: user, consolation: true});
        consolationDrawBalances[0][user] = 3;
    }

    function creditConsolationDraws(
        uint256 seriesID,
        address user,
        uint256 amount
    ) external override {
        if (msg.sender != bundleModule) revert OnlyBundleModule(msg.sender);
        if (user == address(0) || amount == 0) revert InvalidConfig();
        consolationDrawBalances[seriesID][user] += amount;
    }

    function fulfillRandomWordsFromRouter(uint256, uint256[] calldata) external override {}

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[45] private __gap;
}
