// SPDX-License-Identifier: GPL3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "erc721a/contracts/ERC721A.sol";

// ICHICHAIN contract implementing ERC721A for efficient batch minting,
// and integrating with Chainlink VRF for randomness in reveals.
contract ICHICHAIN is ERC721A, Ownable, VRFConsumerBaseV2 {
    // Chainlink VRF-related variables and constants
    VRFCoordinatorV2Interface COORDINATOR;
    uint64 s_subscriptionId;
    bytes32 immutable s_keyHash;
    address public immutable linkToken;
    uint32 callbackGasLimit = 2500000;
    uint16 requestConfirmations = 3;

    // enum to seperate reveal and lastprize
    enum Variable {
        reveal,
        lastPrize
    }

    mapping(uint256 => Variable) public requests;

    // Event emitted when a random number request is sent
    event RevealToken(uint256 requestId, uint32 numWords);
    // Event emitted when a last prize random number request is sent
    event LastPrizeDraw(uint256 requestId, uint32 numWords);
    // Event emitted when a random number request is fulfilled
    event RequestFulfilled(uint256 requestId, uint256[] randomWords);

    // Structure representing each NFT's ticket status
    struct TicketStatus {
        uint256 tokenRevealedPrize; //開獎結果 Ex 1~8代表 A~H賞
        bool tokenExchange; // 有沒有兌換過實體獎品
        bool tokenRevealed; // Whether the token has been revealed
    }

    // Structure representing each prize in a series
    struct Prize {
        string prizeName; // 獎項名稱 Ex 1~8代表 A~H賞
        uint256 prizeRemainingQuantity; // 該獎項預設有幾個 Ex A賞 2個, B賞4個 etc.
    }

    // Structure representing each NFT series
    struct Series {
        Prize[] seriesPrizes;
        string seriesName; // 此抽獎系列名稱
        uint256 totalTicketNumbers; // 總共提供幾抽
        uint256 remainingTicketNumbers; // 剩餘幾抽
        uint256 price; // 每抽多少錢
        uint256 revealTime; // 何時開放買家抽獎
        address lastPrizeOwner; // 最後一賞得主
        string exchangeTokenURI; // 兌換獎品修改metadata
        string unrevealTokenURI; // 抽獎前票券長相
        string revealTokenURI; // 抽獎後票券長相
    }

    // Mappings for series data and token status
    mapping(uint256 => Series) public ICHISeries;
    mapping(uint256 => uint256) private tokenSeriesMapping;
    mapping(uint256 => uint256[]) private seriesTokens;
    mapping(uint256 => TicketStatus) public ticketStatusDetail;
    mapping(uint256 => uint256[]) public requestToRevealToken;
    mapping(uint256 => uint256) public requestToLastPrizeToken;

    // Define seriesCounter variable
    uint256 private seriesCounter = 0;

    // Constructor for setting up the ICHICHAIN contract
    constructor(
        uint64 subscriptionId,
        address _linkToken
    )
        ERC721A("ICHICHAIN", "ICHI")
        VRFConsumerBaseV2(0x7a1BaC17Ccc5b313516C5E16fb24f7659aA5ebed)
    {
        COORDINATOR = VRFCoordinatorV2Interface(
            0x7a1BaC17Ccc5b313516C5E16fb24f7659aA5ebed
        );
        //arb sepolia COORDINATOR = VRFCoordinatorV2Interface(
        //     0x50d47e4142598E3411aA864e08a44284e471AC6f
        // );
        s_subscriptionId = subscriptionId;
        s_keyHash = 0x4b09e658ed251bcafeebbc69400383d49f344ace09b9576fe248bb02c003fe9f;
        //arb sepolia s_keyHash = 0x027f94ff1465b3525f9fc03e9ff7d6d2c0953482246dd6ae07570c45d6631414;
        linkToken = _linkToken;
    }

    // Function to create a new NFT series
    function createSeries(
        string memory seriesName,
        uint256 totalTicketNumbers,
        uint256 price,
        uint256 revealTime,
        string memory exchangeTokenURI,
        string memory unrevealTokenURI,
        string memory revealTokenURI,
        Prize[] memory prizes
    ) public onlyOwner {
        // Calculate the total of all prize quantities
        uint256 totalPrizeQuantity = 0;
        for (uint256 i = 0; i < prizes.length; i++) {
            totalPrizeQuantity += prizes[i].prizeRemainingQuantity;
        }

        // Check if total prize quantity matches total ticket numbers
        require(
            totalPrizeQuantity == totalTicketNumbers,
            "Total prize quantity does not match total tickets"
        );

        uint256 seriesID = seriesCounter++;
        Series storage series = ICHISeries[seriesID];
        series.seriesName = seriesName;
        series.totalTicketNumbers = totalTicketNumbers;
        series.remainingTicketNumbers = totalTicketNumbers;
        series.price = price;
        series.revealTime = revealTime;
        series.exchangeTokenURI = exchangeTokenURI;
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
        require(
            msg.value >= series.price * quantity,
            "Insufficient funds sent"
        );
        require(
            quantity <= series.remainingTicketNumbers,
            "Not enough NFTs remaining in the series"
        );
        _safeMint(msg.sender, quantity);
        for (uint256 i = 0; i < quantity; ++i) {
            uint256 tokenId = _nextTokenId() - quantity + i;
            tokenSeriesMapping[tokenId] = seriesID;
            seriesTokens[seriesID].push(tokenId); // Append the token ID to the series
        }
        series.remainingTicketNumbers -= quantity;
    }

    // Admin function to mint NFTs in a specified series without payment
    function AdminMint(
        address to,
        uint256 seriesID,
        uint256 quantity
    ) public onlyOwner {
        Series storage series = ICHISeries[seriesID];
        require(
            quantity <= series.remainingTicketNumbers,
            "Not enough NFTs remaining in the series"
        );

        _safeMint(to, quantity);

        // Correctly map the token IDs to the series
        for (uint256 i = 0; i < quantity; ++i) {
            uint256 tokenId = _nextTokenId() - quantity + i;
            tokenSeriesMapping[tokenId] = seriesID;
            seriesTokens[seriesID].push(tokenId); // Append the token ID to the series
        }

        series.remainingTicketNumbers -= quantity;
    }

    // Function to reveal specified NFTs in a series
    function reveal(uint256 seriesID, uint256[] memory tokenIDs) public {
        Series storage series = ICHISeries[seriesID];
        require(block.timestamp > series.revealTime, "Not in reveal time");
        require(
            tokenIDs.length <= balanceOf(msg.sender),
            "Not enough tokens to reveal"
        );

        // Request randomness for each token
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            require(ownerOf(tokenIDs[i]) == msg.sender, "Not the token owner");
            require(
                !ticketStatusDetail[tokenIDs[i]].tokenRevealed,
                "Token already revealed"
            );
        }
        uint256 requestId = COORDINATOR.requestRandomWords(
            s_keyHash,
            s_subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            uint32(tokenIDs.length)
        );
        requestToRevealToken[requestId] = tokenIDs;
        requests[requestId] = Variable.reveal;
        emit RevealToken(requestId, uint32(tokenIDs.length));
    }

    // Function to choose the winner of a series last prize with vrf
    function chooseLastPrizeWinner(uint256 seriesID) public onlyOwner {
        Series storage series = ICHISeries[seriesID];
        require(series.remainingTicketNumbers == 0, "Not sold out yet");
        require(series.lastPrizeOwner == address(0), "Already choose winner");

        // Request randomness for each token
        uint256 requestId = COORDINATOR.requestRandomWords(
            s_keyHash,
            s_subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            1
        );
        requestToLastPrizeToken[requestId] = seriesID;
        requests[requestId] = Variable.lastPrize;
        emit LastPrizeDraw(requestId, 1);
    }

    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {
        emit RequestFulfilled(requestId, randomWords);

        Variable variable = requests[requestId];
        if (variable == Variable.reveal) {
            fulfillRevealRandomWords(requestId, randomWords);
        } else if (variable == Variable.lastPrize) {
            fulfillLastPrizeRandomWords(requestId, randomWords);
        }
    }

    function fulfillRevealRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal {
        uint256[] memory tokenIDs = requestToRevealToken[requestId];
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenId = tokenIDs[i];
            Series storage series = ICHISeries[tokenSeriesMapping[tokenId]];

            // Start with the randomly selected prize index
            uint256 prizeIndex = randomWords[i] % series.seriesPrizes.length;

            // Iterate through the prizes to find an available one
            while (
                series.seriesPrizes[prizeIndex].prizeRemainingQuantity == 0
            ) {
                prizeIndex = (prizeIndex + 1) % series.seriesPrizes.length;
            }

            Prize storage prize = series.seriesPrizes[prizeIndex];
            prize.prizeRemainingQuantity -= 1;
            ticketStatusDetail[tokenId].tokenRevealedPrize = prizeIndex;
            ticketStatusDetail[tokenId].tokenRevealed = true;
        }

        delete requestToRevealToken[requestId];
    }

    function fulfillLastPrizeRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal {
        uint256 seriesID = requestToLastPrizeToken[requestId];
        Series storage series = ICHISeries[seriesID];

        uint256[] memory tokensInSeries = seriesTokens[seriesID];
        uint256 totalTokensInSeries = tokensInSeries.length;

        // Use the random number to select the winner
        uint256 randomIndex = randomWords[0] % totalTokensInSeries;
        address winnerAddress = ownerOf(tokensInSeries[randomIndex]);
        // Mint the last prize token to the winner address
        _safeMint(winnerAddress, 1);
        uint256 newTokenId = _nextTokenId() - 1;
        tokenSeriesMapping[newTokenId] = seriesID;
        ticketStatusDetail[newTokenId].tokenRevealedPrize = 999;
        ticketStatusDetail[newTokenId].tokenRevealed = true;

        series.lastPrizeOwner = winnerAddress;

        delete requestToLastPrizeToken[requestId];
    }

    // Override tokenURI to provide the correct metadata based on reveal status
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        uint256 seriesID = tokenSeriesMapping[tokenId];
        Series storage series = ICHISeries[seriesID];

        if (ticketStatusDetail[tokenId].tokenExchange) {
            return
                string(
                    abi.encodePacked(
                        series.exchangeTokenURI,
                        _toString(
                            ticketStatusDetail[tokenId].tokenRevealedPrize
                        )
                    )
                );
        } else if (ticketStatusDetail[tokenId].tokenRevealed) {
            return
                string(
                    abi.encodePacked(
                        series.revealTokenURI,
                        _toString(
                            ticketStatusDetail[tokenId].tokenRevealedPrize
                        )
                    )
                );
        } else {
            // If the token has not been revealed, return the unrevealTokenURI
            return series.unrevealTokenURI;
        }
    }

    function exchangePrize(uint256[] memory tokenIDs) public {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            require(ownerOf(tokenIDs[i]) == msg.sender, "Not the token owner");
            ticketStatusDetail[tokenIDs[i]].tokenExchange = true;
        }
        // Additional logic for handling the prize exchange
    }

    function getSeriesPrizes(
        uint256 seriesID
    ) public view returns (Prize[] memory) {
        require(seriesID < seriesCounter, "Series does not exist");
        return ICHISeries[seriesID].seriesPrizes;
    }

    function getUserTicketsInSeries(
        address user,
        uint256 seriesID
    ) public view returns (uint256) {
        require(seriesID < seriesCounter, "Series does not exist");
        uint256 ticketCount = 0;

        uint256 totalSupply = _totalMinted(); // total supply of all NFTs
        for (uint256 i = 0; i < totalSupply; i++) {
            if (tokenSeriesMapping[i] == seriesID && ownerOf(i) == user) {
                ticketCount++;
            }
        }
        return ticketCount;
    }
}
