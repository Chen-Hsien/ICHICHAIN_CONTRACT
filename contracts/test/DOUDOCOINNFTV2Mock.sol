// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../DOUDOCOINNFT.sol";

contract DOUDOCOINNFTV2Mock is DOUDOCOINNFT {
    function version() external pure returns (string memory) {
        return "doudocoin-nft-v2-mock";
    }
}
