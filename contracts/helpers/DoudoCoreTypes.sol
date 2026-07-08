// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

abstract contract DoudoCoreTypes {
    struct SubPrize {
        uint256 subPrizeID;
        string prizeGroup;
        string subPrizeName;
        uint256 subPrizeRemainingQuantity;
    }
}
