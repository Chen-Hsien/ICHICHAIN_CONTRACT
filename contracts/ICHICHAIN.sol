// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "erc721a/contracts/ERC721A.sol";

contract ICHICHAIN is ERC721A, Ownable {
    struct Prize {
        string prizeName;
        uint256 prizeRemainingQuantity;
    }

    struct Series {
        Prize[] seriesPrizes;
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 remainingTicketNumbers;
        uint256 price;
        uint256 revealTime;
        string baseURI;
    }

    mapping(uint256 => Series) public ICHISeries;
    mapping(uint256 => uint256) private tokenSeriesMapping;

    string private _blindTokenURI =
        "https://gateway.pinata.cloud/ipfs/QmRx7xyp6o6Rc9XvQiMRjjJH8K9BAssxv8kvXEjqdaZi2z/";

    constructor() ERC721A("ICHICHAIN", "ICHI") {}

    uint256 private seriesCounter = 0; // 新增內部計數器

    function createSeries(
        string memory seriesName,
        uint256 totalTicketNumbers,
        uint256 price,
        uint256 revealTime,
        string memory baseURI,
        Prize[] memory prizes
    ) public onlyOwner {
        uint256 seriesID = seriesCounter++; // 自動生成seriesID
        Series storage series = ICHISeries[seriesID];
        series.seriesName = seriesName;
        series.totalTicketNumbers = totalTicketNumbers;
        series.remainingTicketNumbers = totalTicketNumbers;
        series.price = price;
        series.revealTime = revealTime;
        series.baseURI = baseURI;

        for (uint256 i = 0; i < prizes.length; i++) {
            series.seriesPrizes.push(prizes[i]);
        }
    }

    function getSeriesPrizes(uint256 seriesID)
        public
        view
        returns (Prize[] memory)
    {
        return ICHISeries[seriesID].seriesPrizes;
    }

    function getSeriesId(uint256 tokenId) public view returns (uint256) {
        require(_exists(tokenId), "Token does not exist");
        return tokenSeriesMapping[tokenId];
    }

    function mint(uint256 seriesID, uint256 quantity) public payable {
        Series storage series = ICHISeries[seriesID];

        // Check if the series exists
        require(series.seriesPrizes.length > 0, "Series does not exist");

        // The total price for minting the specified quantity
        uint256 totalPrice = series.price * quantity;

        // Check if the sent Ether matches the total price for requested quantity
        require(msg.value >= totalPrice, "Insufficient funds sent");

        // Check if there are enough remaining NFTs in the series
        require(
            quantity <= series.remainingTicketNumbers,
            "Not enough NFTs remaining in the series"
        );

        // Store the starting index for the new tokens
        uint256 newTokenIdStart = _nextTokenId();

        // Mint the specified quantity of NFTs to the sender's address in one call
        _safeMint(msg.sender, quantity);

        // Update the mapping for each newly minted token
        for (uint256 i = 0; i < quantity; i++) {
            tokenSeriesMapping[newTokenIdStart + i] = seriesID;
        }

        series.remainingTicketNumbers -= quantity;

        // Optionally, handle overpayment
        if (msg.value > totalPrice) {
            payable(msg.sender).transfer(msg.value - totalPrice);
        }
    }

    function AdminMint(
        address to,
        uint256 seriesID,
        uint256 quantity
    ) public onlyOwner {
        Series storage series = ICHISeries[seriesID];

        // Check if there are enough remaining NFTs in the series
        require(
            quantity <= series.remainingTicketNumbers,
            "Not enough NFTs remaining in the series"
        );

        _safeMint(to, quantity);

        series.remainingTicketNumbers -= quantity;
    }

    // function reveal(uint256 seriesID) public onlyOwner {
    //     require( nfts[seriesID].revealTime > block.timestamp, "NFT not in reveal time");
    //     nfts[seriesID].revealTime = block.timestamp;
    // }

    // function reveal

    // function exchangePrize
}
