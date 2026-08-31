// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoCore.sol";
import "../interfaces/IDoudoBundleRefundAccounting.sol";
import "../interfaces/IDoudoMembershipV2.sol";
import "../interfaces/IDoudoPoints.sol";
import "../security/LightweightGuardsUpgradeable.sol";

contract DoudoRefundModuleUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant POINTS_CONFIG_ROLE = keccak256("POINTS_CONFIG_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 private constant REFUND_POINTS = keccak256("REFUND_POINTS");

    struct RefundConfig {
        bool isRefund;
        uint256 refundPointsPerTicket;
    }

    IDoudoCore public core;
    IDoudoPoints public doudoPoints;
    mapping(uint256 => RefundConfig) public refundConfigs;
    bool public databasePointsModeEnabled;
    IDoudoBundleRefundAccounting public bundleRefundAccounting;
    IDoudoMembershipV2 public membershipV2;

    error InvalidConfig();
    error RefundInactive();
    error MixedSeries();
    error InvalidRefundAccounting();
    error RefundBuyerMismatch(
        uint256 tokenID,
        address originalBuyer,
        address refundingOwner
    );

    event RefundSeries(uint256 indexed seriesID, bool isRefund, uint256 refundPointsPerTicket);
    event RefundClaimed(
        uint256 indexed seriesID,
        address indexed user,
        uint256[] tokenIDs,
        uint256 refundPoints
    );
    event DatabasePointsRefundModeConfigured(bool enabled);
    event DatabasePointsRefundAccountingConfigured(
        address indexed bundle,
        address indexed membership,
        bool enabled
    );
    event DatabasePointsRefundClaimed(
        uint256 indexed seriesID,
        address indexed user,
        uint256[] tokenIDs,
        uint256 refundPoints
    );
    event DatabasePointsRefundSettlement(
        bytes32 indexed referenceId,
        uint256 indexed seriesID,
        address indexed refundRecipient,
        uint256 refundPoints,
        uint256 membershipRewardPointsReversed
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
        _grantRole(POINTS_CONFIG_ROLE, msg.sender);
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

    function setDatabasePointsMode(bool enabled) external onlyRole(POINTS_CONFIG_ROLE) {
        if (
            enabled &&
            (address(bundleRefundAccounting) == address(0) ||
                address(membershipV2) == address(0))
        ) revert InvalidConfig();
        databasePointsModeEnabled = enabled;
        emit DatabasePointsRefundModeConfigured(enabled);
    }

    function configureDatabasePointsRefundAccounting(
        address bundle,
        address membership,
        bool enabled
    ) external onlyRole(POINTS_CONFIG_ROLE) {
        if (bundle == address(0) || membership == address(0)) revert InvalidConfig();
        bundleRefundAccounting = IDoudoBundleRefundAccounting(bundle);
        membershipV2 = IDoudoMembershipV2(membership);
        databasePointsModeEnabled = enabled;
        emit DatabasePointsRefundAccountingConfigured(bundle, membership, enabled);
        emit DatabasePointsRefundModeConfigured(enabled);
    }

    function claimRefund(uint256[] calldata tokenIDs) external nonReentrant {
        if (tokenIDs.length == 0) revert InvalidConfig();

        uint256 expectedSeriesID;
        uint256 totalRefund;
        uint256 membershipSpendReversed;
        uint256 membershipRewardPointsReversed;
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 paid = core.pointsPaid(tokenIDs[i]);
            if (databasePointsModeEnabled) {
                (
                    bool membershipRecorded,
                    uint256 membershipRewardPoints,
                    address membershipWallet
                ) = bundleRefundAccounting.consumeTicketRefundAccounting(tokenIDs[i]);
                if (membershipRecorded) {
                    if (membershipWallet != msg.sender) {
                        revert RefundBuyerMismatch(
                            tokenIDs[i],
                            membershipWallet,
                            msg.sender
                        );
                    }
                    membershipSpendReversed += paid;
                    membershipRewardPointsReversed += membershipRewardPoints;
                }
            }
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

        if (databasePointsModeEnabled) {
            if (membershipRewardPointsReversed > totalRefund) {
                revert InvalidRefundAccounting();
            }
            bytes32 referenceId = keccak256(
                abi.encode("SERIES_REFUND", msg.sender, tokenIDs)
            );
            if (membershipSpendReversed != 0) {
                membershipV2.reverseConsumption(
                    msg.sender,
                    membershipSpendReversed,
                    referenceId
                );
            }
            emit DatabasePointsRefundClaimed(
                expectedSeriesID,
                msg.sender,
                tokenIDs,
                totalRefund
            );
            emit DatabasePointsRefundSettlement(
                referenceId,
                expectedSeriesID,
                msg.sender,
                totalRefund,
                membershipRewardPointsReversed
            );
        } else {
            doudoPoints.mintWithReason(msg.sender, totalRefund, REFUND_POINTS);
        }
        emit RefundClaimed(expectedSeriesID, msg.sender, tokenIDs, totalRefund);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[45] private __gap;
}
