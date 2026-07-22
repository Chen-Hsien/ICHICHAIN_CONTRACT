// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoRedrawCredits {
    function creditConsolationDraws(uint256 seriesID, address user, uint256 amount) external;
}
