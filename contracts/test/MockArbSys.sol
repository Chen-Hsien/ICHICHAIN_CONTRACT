// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockArbSys {
    uint256 private _arbBlockNumber;

    function setArbBlockNumber(uint256 newBlockNumber) external {
        _arbBlockNumber = newBlockNumber;
    }

    function arbBlockNumber() external view returns (uint256) {
        return _arbBlockNumber;
    }
}
