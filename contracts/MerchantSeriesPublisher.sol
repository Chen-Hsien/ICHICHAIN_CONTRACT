// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./interfaces/IDoudoSeriesPublishing.sol";
import "./interfaces/IMerchantSeriesRegistry.sol";

/// @notice Single atomic entry point for publishing a series and linking its
/// merchant in one transaction. Holds no core business state; replaceable by
/// upgrading the Publisher proxy.
contract MerchantSeriesPublisher is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable
{
    bytes32 public constant PUBLISHER_OPERATION_ROLE = keccak256("PUBLISHER_OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    IMerchantSeriesRegistry public registry;

    error ZeroAddress();

    event SeriesPublished(
        address indexed core,
        uint256 indexed seriesID,
        bytes32 indexed merchantRef,
        address operator
    );
    event SeriesSourceTagged(
        address indexed core,
        uint256 indexed seriesID,
        uint8 packingType,
        uint8 sourceType
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address registry_) public initializer {
        if (admin == address(0) || registry_ == address(0)) revert ZeroAddress();
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(admin);
        registry = IMerchantSeriesRegistry(registry_);
        _grantRole(PUBLISHER_OPERATION_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function publishSeriesWithMerchant(
        address core,
        IDoudoSeriesPublishing.SeriesInput calldata input,
        IDoudoSeriesPublishing.SubPrize[] calldata subPrizes,
        bool revealEnabled,
        bytes32 merchantRef
    ) external onlyRole(PUBLISHER_OPERATION_ROLE) returns (uint256 seriesID) {
        seriesID = IDoudoSeriesPublishing(core).createSeriesWithSubPrizes(
            input,
            subPrizes,
            revealEnabled
        );
        registry.linkSeries(core, seriesID, merchantRef);
        emit SeriesPublished(core, seriesID, merchantRef, msg.sender);
        emit SeriesSourceTagged(core, seriesID, input.packingType, input.sourceType);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[49] private __gap;
}
