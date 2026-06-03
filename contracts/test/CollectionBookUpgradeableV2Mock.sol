// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../CollectionBookUpgradeable.sol";

contract CollectionBookUpgradeableV2Mock is CollectionBookUpgradeable {
    function version() external pure returns (string memory) {
        return "collection-book-v2-mock";
    }
}
