// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IDoudoVRFCallback.sol";

contract FixedProbabilityV3RouterMock {
    uint256 public nextRequestId = 1;
    mapping(uint256 => address) public callbacks;
    mapping(uint256 => uint32) public wordCounts;

    function pendingRequests() external view returns (uint256) {
        return nextRequestId - 1;
    }

    function requestRandomWords(
        address callbackTarget,
        uint32 numWords
    ) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        callbacks[requestId] = callbackTarget;
        wordCounts[requestId] = numWords;
    }

    function fulfill(uint256 requestId, uint256[] calldata words) external {
        require(callbacks[requestId] != address(0), "unknown request");
        require(words.length == wordCounts[requestId], "wrong word count");
        IDoudoVRFCallback(callbacks[requestId]).fulfillRandomWordsFromRouter(
            requestId,
            words
        );
    }
}

contract FixedProbabilityV3MembershipMock {
    uint8 public level = 5;
    uint256 public recordedPoints;
    uint256 public reversedPoints;
    bytes32 public lastConsumptionId;
    bytes32 public lastReversalId;

    function setLevel(uint8 nextLevel) external {
        level = nextLevel;
    }

    function effectiveLevelOf(address) external view returns (uint8) {
        return level;
    }

    function recordConsumption(
        address,
        uint256 pointsConsumed,
        bytes32 authorizationId
    ) external returns (uint256, uint8, uint8, uint64) {
        recordedPoints += pointsConsumed;
        lastConsumptionId = authorizationId;
        return (pointsConsumed / 100, level, level, uint64(block.timestamp + 365 days));
    }

    function reverseConsumption(
        address,
        uint256 pointsConsumed,
        bytes32 reversalId
    ) external returns (uint8, uint8, uint256, uint256) {
        reversedPoints += pointsConsumed;
        lastReversalId = reversalId;
        return (level, level, 0, recordedPoints - reversedPoints);
    }
}
