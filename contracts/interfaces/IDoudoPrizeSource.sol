// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoPrizeSource {
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function ticketStatusDetail(
        uint256 tokenId
    )
        external
        view
        returns (
            uint256 seriesID,
            uint256 tokenRevealedPrize,
            bool tokenExchange,
            bool tokenRevealed,
            uint16 luckyNumber
        );
}
