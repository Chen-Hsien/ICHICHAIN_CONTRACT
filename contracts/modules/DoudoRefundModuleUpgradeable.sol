// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoCore.sol";
import "../interfaces/IDoudoPoints.sol";
import "../security/LightweightGuardsUpgradeable.sol";

contract DoudoRefundModuleUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 private constant REFUND_POINTS = keccak256("REFUND_POINTS");

    struct RefundConfig {
        bool isRefund;
        uint256 refundPointsPerTicket;
    }

    IDoudoCore public core;
    IDoudoPoints public doudoPoints;
    mapping(uint256 => RefundConfig) public refundConfigs;

    error InvalidConfig();
    error RefundInactive();
    error MixedSeries();

    event RefundSeries(uint256 indexed seriesID, bool isRefund, uint256 refundPointsPerTicket);
    event RefundClaimed(
        uint256 indexed seriesID,
        address indexed user,
        uint256[] tokenIDs,
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

    function setSeriesRefund(
        uint256 seriesID,
        bool isRefund,
        uint256 refundPointsPerTicket
    ) external onlyRole(OPERATION_ROLE) {
        refundConfigs[seriesID] = RefundConfig({
            isRefund: isRefund,
            refundPointsPerTicket: refundPointsPerTicket
        });
        core.moduleSetSeriesRefund(seriesID, isRefund);
        emit RefundSeries(seriesID, isRefund, refundPointsPerTicket);
    }

    function claimRefund(uint256[] calldata tokenIDs) external nonReentrant {
        if (tokenIDs.length == 0) revert InvalidConfig();

        uint256 expectedSeriesID;
        uint256 totalRefund;
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 paid = core.pointsPaid(tokenIDs[i]);
            uint256 seriesID = core.moduleBurnForRefund(tokenIDs[i], msg.sender);
            if (i == 0) {
                expectedSeriesID = seriesID;
                RefundConfig memory config = refundConfigs[seriesID];
                if (!config.isRefund) revert RefundInactive();
            } else {
                if (seriesID != expectedSeriesID) revert MixedSeries();
            }
            totalRefund += paid;
        }
        if (totalRefund == 0) revert RefundInactive();

        doudoPoints.mintWithReason(msg.sender, totalRefund, REFUND_POINTS);
        emit RefundClaimed(expectedSeriesID, msg.sender, tokenIDs, totalRefund);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[47] private __gap;
}
