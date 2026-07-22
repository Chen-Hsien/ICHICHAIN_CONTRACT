// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "./DoudoCoreTypes.sol";

library DoudoPrizeDrawLib {
    error InvalidSeriesInput();
    error NotEnoughNFTsRemaining();

    event UpdatePrize(uint256 indexed seriesID, uint256 subPrizeID, uint256 subPrizeRemainingQuantity);

    function drawPrize(
        DoudoCoreTypes.SubPrize[] storage prizes,
        uint256 seriesID,
        uint256 randomWord
    ) external returns (uint256 subPrizeID) {
        uint256 totalRemaining;
        for (uint256 i = 0; i < prizes.length; i++) {
            totalRemaining += prizes[i].subPrizeRemainingQuantity;
        }
        if (totalRemaining == 0) revert NotEnoughNFTsRemaining();

        uint256 cursor;
        uint256 winningIndex = randomWord % totalRemaining;
        for (uint256 i = 0; i < prizes.length; i++) {
            cursor += prizes[i].subPrizeRemainingQuantity;
            if (winningIndex < cursor) {
                prizes[i].subPrizeRemainingQuantity -= 1;
                emit UpdatePrize(seriesID, prizes[i].subPrizeID, prizes[i].subPrizeRemainingQuantity);
                return prizes[i].subPrizeID;
            }
        }
        revert InvalidSeriesInput();
    }
}
