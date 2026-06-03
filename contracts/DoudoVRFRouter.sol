// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import "./interfaces/IDoudoVRFCallback.sol";
import "./interfaces/IDoudoVRFRouter.sol";

contract DoudoVRFRouter is VRFConsumerBaseV2Plus, IDoudoVRFRouter {
    uint256 public subscriptionId;
    bytes32 public keyHash;
    uint16 public requestConfirmations;
    uint32 public callbackGasLimit;

    mapping(address => bool) public isRequester;
    mapping(uint256 => address) public requestCallbackTarget;
    mapping(uint256 => address) public requestSender;

    error InvalidConfig();
    error NotRequester(address caller);
    error UnknownRequest(uint256 requestId);

    event RequesterUpdated(address indexed requester, bool allowed);
    event VrfConfigUpdated(
        address indexed vrfCoordinator,
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        address indexed operator
    );
    event VrfRandomWordsRequested(
        uint256 indexed requestId,
        address indexed requester,
        address indexed callbackTarget,
        uint32 numWords
    );
    event VrfRandomWordsFulfilled(
        uint256 indexed requestId,
        address indexed callbackTarget
    );

    constructor(
        address vrfCoordinator,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        if (callbackGasLimit_ == 0) revert InvalidConfig();
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        requestConfirmations = requestConfirmations_;
        callbackGasLimit = callbackGasLimit_;
        emit VrfConfigUpdated(
            vrfCoordinator,
            subscriptionId_,
            keyHash_,
            callbackGasLimit_,
            requestConfirmations_,
            msg.sender
        );
    }

    function setRequester(address requester, bool allowed) external onlyOwner {
        if (requester == address(0)) revert InvalidConfig();
        isRequester[requester] = allowed;
        emit RequesterUpdated(requester, allowed);
    }

    function setVrfConfig(
        address vrfCoordinator,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint32 callbackGasLimit_,
        uint16 requestConfirmations_
    ) external onlyOwner {
        if (vrfCoordinator == address(0) || callbackGasLimit_ == 0) revert InvalidConfig();
        s_vrfCoordinator = IVRFCoordinatorV2Plus(vrfCoordinator);
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        callbackGasLimit = callbackGasLimit_;
        requestConfirmations = requestConfirmations_;
        emit CoordinatorSet(vrfCoordinator);
        emit VrfConfigUpdated(
            vrfCoordinator,
            subscriptionId_,
            keyHash_,
            callbackGasLimit_,
            requestConfirmations_,
            msg.sender
        );
    }

    function requestRandomWords(
        address callbackTarget,
        uint32 numWords
    ) external returns (uint256 requestId) {
        if (!isRequester[msg.sender]) revert NotRequester(msg.sender);
        if (callbackTarget == address(0) || numWords == 0) revert InvalidConfig();

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
        requestCallbackTarget[requestId] = callbackTarget;
        requestSender[requestId] = msg.sender;
        emit VrfRandomWordsRequested(requestId, msg.sender, callbackTarget, numWords);
    }

    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        address callbackTarget = requestCallbackTarget[requestId];
        if (callbackTarget == address(0)) revert UnknownRequest(requestId);
        delete requestCallbackTarget[requestId];
        IDoudoVRFCallback(callbackTarget).fulfillRandomWordsFromRouter(requestId, randomWords);
        emit VrfRandomWordsFulfilled(requestId, callbackTarget);
    }
}
