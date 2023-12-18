// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "erc721a/contracts/ERC721A.sol";

// ICHICHAIN contract implementing ERC721A for efficient batch minting,
// and integrating with Chainlink VRF for randomness in reveals.
contract ICHICHAIN is ERC721A, Ownable, VRFConsumerBaseV2 {
    // Chainlink VRF-related variables and constants
    VRFCoordinatorV2Interface COORDINATOR;
    uint64 s_subscriptionId;
    bytes32 immutable keyHash;
    address public immutable linkToken;
    uint32 callbackGasLimit = 150000;
    uint16 requestConfirmations = 3;
    uint32 numWords = 1;
    
    // Structure to hold the request status for random number generation
    struct RequestStatus {
        bool fulfilled; // Indicates if the request has been successfully fulfilled
        bool exists; // Indicates if a requestId exists
        uint256[] randomWords; // Random numbers returned by VRF
    }

    // Mapping to keep track of request statuses
    mapping(uint256 => RequestStatus) public s_requests; 

    // Event emitted when a random number request is sent
    event RequestSent(uint256 requestId, uint32 numWords);
    // Event emitted when a random number request is fulfilled
    event RequestFulfilled(uint256 requestId, uint256[] randomWords);

    // Structure representing each NFT's ticket status
    struct TicketStatus {
        bool tokenRevealed;
        bool tokenExchange;
    }

    // Structure representing each prize in a series
    struct Prize {
        string prizeName;
        uint256 prizeRemainingQuantity;
    }

    // Structure representing each NFT series
    struct Series {
        Prize[] seriesPrizes;
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 remainingTicketNumbers;
        uint256 price;
        uint256 revealTime;
        string unrevealTokenURI;
        string revealTokenURI;
    }

    // Mappings for series data and token status
    mapping(uint256 => Series) public ICHISeries;
    mapping(uint256 => uint256) private tokenSeriesMapping;
    mapping(uint256 => TicketStatus) public ticketStatusDetail;

    // Constructor for setting up the ICHICHAIN contract
    constructor(uint64 subscriptionId, address _linkToken)
        ERC721A("ICHICHAIN", "ICHI")
        VRFConsumerBaseV2(0x6D80646bEAdd07cE68cab36c27c626790bBcf17f)
    {
        COORDINATOR = VRFCoordinatorV2Interface(0x6D80646bEAdd07cE68cab36c27c626790bBcf17f);
        s_subscriptionId = subscriptionId;
        keyHash = 0x83d1b6e3388bed3d76426974512bb0d270e9542a765cd667242ea26c0cc0b730;
        linkToken = _linkToken;
    }

    // Function to handle the VRF response
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        // Logic to handle random words
    }

    // Function to create a new NFT series
    function createSeries(
        string memory seriesName,
        uint256 totalTicketNumbers,
        uint256 price,
        uint256 revealTime,
        string memory unrevealTokenURI,
        string memory revealTokenURI,
        Prize[] memory prizes
    ) public onlyOwner {
        uint256 seriesID = seriesCounter++;
        Series storage series = ICHISeries[seriesID];
        series.seriesName = seriesName;
        series.totalTicketNumbers = totalTicketNumbers;
        series.remainingTicketNumbers = totalTicketNumbers;
        series.price = price;
        series.revealTime = revealTime;
        series.unrevealTokenURI = unrevealTokenURI;
        series.revealTokenURI = revealTokenURI;
        for (uint256 i = 0; i < prizes.length; i++) {
            series.seriesPrizes.push(prizes[i]);
        }
    }

    // Function to mint NFTs in a specified series
    function mint(uint256 seriesID, uint256 quantity) public payable {
        Series storage series = ICHISeries[seriesID];
        require(series.seriesPrizes.length > 0, "Series does not exist");
        require(msg.value >= series.price * quantity, "Insufficient funds sent");
        require(quantity <= series.remainingTicketNumbers, "Not enough NFTs remaining in the series");
        _safeMint(msg.sender, quantity);
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _nextTokenId() - quantity + i;
            tokenSeriesMapping[tokenId] = seriesID;
        }
        series.remainingTicketNumbers -= quantity;
        // Optionally, handle overpayment
        if (msg.value > series.price * quantity) {
            payable(msg.sender).transfer(msg.value - series.price * quantity);
        }
    }

    // Admin function to mint NFTs in a specified series
    function AdminMint(address to, uint256 seriesID, uint256 quantity) public onlyOwner {
        Series storage series = ICHISeries[seriesID];
        require(quantity <= series.remainingTicketNumbers, "Not enough NFTs remaining in the series");
        _safeMint(to, quantity);
        series.remainingTicketNumbers -= quantity;
    }

    // Function to reveal specified NFTs in a series
    function reveal(uint256 seriesID, uint256[] memory revealTokenID ) public {
        Series storage series = ICHISeries[seriesID];
        require(block.timestamp > series.revealTime, "Not in reveal time");
        require(revealTokenID.length <= balanceOf(msg.sender), "Not enough token to reveal");
        series.remainingTicketNumbers -= revealTokenID.length;
        for (uint256 i = 0; i < revealTokenID.length; i++) {
            require(ownerOf(revealTokenID[i]) == msg.sender, "Not the token owner");
            ticketStatusDetail[revealTokenID[i]].tokenRevealed = true;
        }
    }

    // Override tokenURI to provide the correct metadata based on reveal status
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        uint256 seriesID = tokenSeriesMapping[tokenId];
        Series storage series = ICHISeries[seriesID];
        if (ticketStatusDetail[tokenId].tokenRevealed) {
            return series.revealTokenURI;
        } else {
            return series.unrevealTokenURI;
        }
    }

    // Additional functions like exchangePrize, setters, getters, etc.

    // Define seriesCounter variable
    uint256 private seriesCounter = 0;
}
