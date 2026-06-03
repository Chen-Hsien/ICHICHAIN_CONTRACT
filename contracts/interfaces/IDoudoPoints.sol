// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoPoints {
    function mint(address to, uint256 amount) external returns (bool);
    function mintWithReason(address to, uint256 amount, bytes32 reason) external returns (bool);
    function burnFrom(address account, uint256 amount) external;
    function burnFromWithReason(address account, uint256 amount, bytes32 reason) external;
}
