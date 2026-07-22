// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFConsumerV2Plus {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

contract VRFCoordinatorV2PlusMock {
    uint256 public nextRequestId = 1;
    mapping(uint256 => address) public requester;

    event RandomWordsRequested(uint256 indexed requestId, address indexed requester);

    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata
    ) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requester[requestId] = msg.sender;
        emit RandomWordsRequested(requestId, msg.sender);
    }

    function fulfill(address consumer, uint256 requestId, uint256[] calldata randomWords) external {
        require(requester[requestId] == consumer, "unknown request");
        IVRFConsumerV2Plus(consumer).rawFulfillRandomWords(requestId, randomWords);
    }
}
