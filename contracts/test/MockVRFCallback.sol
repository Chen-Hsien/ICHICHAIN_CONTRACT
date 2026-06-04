// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IDoudoVRFCallback.sol";

contract MockVRFCallback is IDoudoVRFCallback {
    uint256 public lastRequestId;
    uint256 public lastRandomWord;

    function fulfillRandomWordsFromRouter(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external override {
        lastRequestId = requestId;
        lastRandomWord = randomWords[0];
    }
}
