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
        uint16[] calldata luckyNumbers,
        uint256 pointsPerTicket,
        bool enforceWalletAndLock
    ) external returns (uint256 firstTokenId);

    function seriesMintConfig(
        uint256 seriesID
    ) external view returns (uint256 priceInPoints, bool useLuckyNumber);

    function moduleMintRevealed(
        address to,
        uint256 seriesID,
        uint256 prizeID
    ) external returns (uint256 tokenId);

    function reveal(uint256 seriesID, uint256[] calldata tokenIDs) external;

    function moduleBurnForRefund(
        uint256 tokenID,
        address owner
    ) external returns (uint256 seriesID);

    function moduleBurnForRedraw(
        uint256 tokenID,
        address owner
    ) external returns (uint256 seriesID);

    function moduleSetSeriesRefund(uint256 seriesID, bool isRefund) external;
    function pointsPaid(uint256 tokenID) external view returns (uint256);
}
