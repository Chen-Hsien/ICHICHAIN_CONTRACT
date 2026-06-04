// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoCore {
    function ownerOf(uint256 tokenId) external view returns (address);

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

    function moduleMintUnrevealed(
        address to,
        uint256 seriesID,
        uint256 quantity,
        uint256 pointsPerTicket,
        bool enforceWalletAndLock
    ) external returns (uint256 firstTokenId);

    function moduleMintRevealed(
        address to,
        uint256 seriesID,
        uint256 prizeID,
        uint16 luckyNumber
    ) external returns (uint256 tokenId);

    function moduleBurnForRefund(
        uint256 tokenID,
        address owner
    ) external returns (uint256 seriesID, uint256 prizeID, bool revealed);

    function moduleBurnForRedraw(
        uint256 tokenID,
        address owner
    ) external returns (uint256 seriesID, uint256 prizeID);

    function moduleSetSeriesRefund(uint256 seriesID, bool isRefund) external;
    function moduleUnlockSeriesFor(uint256 seriesID, address user, uint256 expires) external;
    function pointsPaid(uint256 tokenID) external view returns (uint256);
}
