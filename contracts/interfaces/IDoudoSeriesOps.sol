// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoSeriesOps {
    function initializeSeries(uint256 seriesID, uint256 maxPerWallet, bool revealEnabled) external;

    function checkAndRefreshMintLock(uint256 seriesID, address user, uint256 quantity) external;

    function refreshMintLockFor(uint256 seriesID, address user, uint256 duration) external;

    function recordMint(uint256 seriesID, address user, uint256 quantity) external;

    function revealEnabled(uint256 seriesID) external view returns (bool);
}
