// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoVRFRouter {
    function pendingRequests() external view returns (uint256);

    function requestRandomWords(
        address callbackTarget,
        uint32 numWords
    ) external returns (uint256 requestId);
}
