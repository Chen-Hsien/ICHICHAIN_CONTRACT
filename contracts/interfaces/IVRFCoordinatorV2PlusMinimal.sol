// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFCoordinatorV2PlusMinimal {
    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata req
    ) external returns (uint256 requestId);
}
