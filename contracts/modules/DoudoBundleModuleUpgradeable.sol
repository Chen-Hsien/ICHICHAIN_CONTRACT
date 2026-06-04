// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoCore.sol";
import "../interfaces/IDoudoPoints.sol";
import "../interfaces/IDoudoRedrawCredits.sol";
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

    struct BundleInput {
        uint256 bundleID;
        uint256 ticketQuantity;
        uint256 priceInPoints;
        uint256 rebatePoints;
        uint256 consolationDrawCredits;
        bool active;
    }

    struct BundleConfig {
        uint256 ticketQuantity;
        uint256 priceInPoints;
        uint256 rebatePoints;
        uint256 consolationDrawCredits;
        bool active;
    }

    IDoudoCore public core;
    IDoudoPoints public doudoPoints;
    address public redrawModule;

    mapping(uint256 => mapping(uint256 => BundleConfig)) public seriesBundles;

    error InvalidConfig();
    error InactiveBundle();

    event RedrawModuleUpdated(address indexed redrawModule);
    event BundleConfigured(
        uint256 indexed seriesID,
        uint256 indexed bundleID,
        uint256 ticketQuantity,
        uint256 priceInPoints,
        uint256 rebatePoints,
        uint256 consolationDrawCredits,
        bool active
    );
    event BundleMinted(
        uint256 indexed seriesID,
        uint256 indexed bundleID,
        address indexed buyer,
        uint256 quantity,
        uint256 firstTokenID
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

    function setSeriesBundles(
        uint256 seriesID,
        BundleInput[] calldata bundles
    ) external onlyRole(OPERATION_ROLE) {
        if (bundles.length == 0) revert InvalidConfig();
        for (uint256 i = 0; i < bundles.length; i++) {
            if (bundles[i].bundleID == 0 || bundles[i].ticketQuantity == 0) revert InvalidConfig();
            seriesBundles[seriesID][bundles[i].bundleID] = BundleConfig({
                ticketQuantity: bundles[i].ticketQuantity,
                priceInPoints: bundles[i].priceInPoints,
                rebatePoints: bundles[i].rebatePoints,
                consolationDrawCredits: bundles[i].consolationDrawCredits,
                active: bundles[i].active
            });
            emit BundleConfigured(
                seriesID,
                bundles[i].bundleID,
                bundles[i].ticketQuantity,
                bundles[i].priceInPoints,
                bundles[i].rebatePoints,
                bundles[i].consolationDrawCredits,
                bundles[i].active
            );
        }
    }

    function mintBundle(
        uint256 seriesID,
        uint256 bundleID,
        uint256 quantity
    ) external nonReentrant returns (uint256 firstTokenID) {
        BundleConfig memory config = seriesBundles[seriesID][bundleID];
        if (!config.active || quantity == 0) revert InactiveBundle();

        uint256 ticketQuantity = config.ticketQuantity * quantity;
        uint256 totalPrice = config.priceInPoints * quantity;
        if (totalPrice != 0) {
            doudoPoints.burnFromWithReason(msg.sender, totalPrice, BUNDLE_MINT);
        }

        uint256 pointsPerTicket = config.ticketQuantity == 0 ? 0 : config.priceInPoints / config.ticketQuantity;
        firstTokenID = core.moduleMintUnrevealed(msg.sender, seriesID, ticketQuantity, pointsPerTicket, true);

        uint256 rebate = config.rebatePoints * quantity;
        if (rebate != 0) {
            doudoPoints.mintWithReason(msg.sender, rebate, BUNDLE_REBATE);
        }

        uint256 credits = config.consolationDrawCredits * quantity;
        if (credits != 0 && redrawModule != address(0)) {
            IDoudoRedrawCredits(redrawModule).creditConsolationDraws(seriesID, msg.sender, credits);
        }

        emit BundleMinted(seriesID, bundleID, msg.sender, quantity, firstTokenID);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[45] private __gap;
}
