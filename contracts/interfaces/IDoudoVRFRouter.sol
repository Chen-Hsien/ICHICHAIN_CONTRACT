// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoVRFRouter {
    function requestRandomWords(
        address callbackTarget,
        uint32 numWords
    ) external returns (uint256 requestId);
}
