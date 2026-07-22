// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockPrizeSource is ERC721 {
    struct TicketStatus {
        uint256 seriesID;
        uint256 tokenRevealedPrize;
        bool tokenExchange;
        bool tokenRevealed;
        uint16 luckyNumber;
    }

    uint256 public nextTokenId;
    mapping(uint256 => TicketStatus) public ticketStatus;

    constructor() ERC721("MockPrizeSource", "MPS") {}

    function mintRevealed(
        address to,
        uint256 seriesID,
        uint256 prizeId,
        bool exchanged
    ) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        ticketStatus[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: prizeId,
            tokenExchange: exchanged,
            tokenRevealed: true,
            luckyNumber: 0
        });
    }

    function mintUnrevealed(address to, uint256 seriesID) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        ticketStatus[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: 0,
            tokenExchange: false,
            tokenRevealed: false,
            luckyNumber: 0
        });
    }

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
        )
    {
        TicketStatus memory status = ticketStatus[tokenId];
        return (
            status.seriesID,
            status.tokenRevealedPrize,
            status.tokenExchange,
            status.tokenRevealed,
            status.luckyNumber
        );
    }
}
