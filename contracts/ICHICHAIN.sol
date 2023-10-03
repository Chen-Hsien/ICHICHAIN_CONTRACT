// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyNFT is ERC721, Ownable {
    struct NFT {
        uint256 totalQuantity;
        uint256 remainingQuantity;
        uint256[] prizeQuantity;
        string prizeName;
        uint256 price;
        uint256 id;
        uint256 revealTime;
    }

    mapping(uint256 => NFT) public nfts;

    constructor() ERC721("ICHICHAIN", "ICHI") {}

    function createNFT(
        uint256 tokenId,
        uint256 totalQuantity,
        uint256[] memory prizeQuantity,
        string memory prizeName,
        uint256  price,
        uint256 revealTime
    ) public onlyOwner {
        uint256 remainingQuantity = totalQuantity;
        NFT memory newNFT = NFT(totalQuantity,remainingQuantity, prizeQuantity, prizeName,price , tokenId, revealTime);
        nfts[tokenId] = newNFT;
    }

    function AdminMint(address to, uint256 tokenId) public onlyOwner {
        _safeMint(to, tokenId);
    }

     function mint (address to, uint256 tokenId) public payable{
        // require( nfts[tokenId].totalQuantity > 0, "NFT is not exist");
        require( nfts[tokenId].remainingQuantity > 0, "Series is sold out");
        require( msg.value > nfts[tokenId].price , "Not enough money");
        _safeMint(to, tokenId);
    }

    function reveal(uint256 tokenId) public onlyOwner {
        require( nfts[tokenId].revealTime > block.timestamp, "NFT not in reveal time");
        nfts[tokenId].revealTime = block.timestamp;
    }

    // function reveal
}