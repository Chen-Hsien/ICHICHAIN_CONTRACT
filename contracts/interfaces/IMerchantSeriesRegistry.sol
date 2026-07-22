// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMerchantSeriesRegistry {
    function linkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 merchantRef
    ) external;

    function relinkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 newMerchantRef
    ) external;

    function merchantOf(
        address seriesContract,
        uint256 seriesID
    ) external view returns (bytes32);
}
