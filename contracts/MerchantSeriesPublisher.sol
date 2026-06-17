// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IDoudoSeriesPublishing.sol";
import "./interfaces/IMerchantSeriesRegistry.sol";

/// @notice Single atomic entry point for publishing a series and linking its
/// merchant in one transaction. Holds no core business state; replaceable by
/// deploying a new Publisher and re-granting roles.
contract MerchantSeriesPublisher is AccessControl {
    bytes32 public constant PUBLISHER_OPERATION_ROLE = keccak256("PUBLISHER_OPERATION_ROLE");

    IMerchantSeriesRegistry public immutable registry;

    error ZeroAddress();

    event SeriesPublished(
        address indexed core,
        uint256 indexed seriesID,
        bytes32 indexed merchantRef,
        address operator
    );

    constructor(address admin, address registry_) {
        if (admin == address(0) || registry_ == address(0)) revert ZeroAddress();
        registry = IMerchantSeriesRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PUBLISHER_OPERATION_ROLE, admin);
    }

    function publishSeriesWithMerchant(
        address core,
        IDoudoSeriesPublishing.SeriesInput calldata input,
        IDoudoSeriesPublishing.SubPrize[] calldata subPrizes,
        bool markGoodsArrived,
        bytes32 merchantRef
    ) external onlyRole(PUBLISHER_OPERATION_ROLE) returns (uint256 seriesID) {
        seriesID = IDoudoSeriesPublishing(core).createSeriesWithSubPrizes(
            input,
            subPrizes,
            markGoodsArrived
        );
        registry.linkSeries(core, seriesID, merchantRef);
        emit SeriesPublished(core, seriesID, merchantRef, msg.sender);
    }
}
