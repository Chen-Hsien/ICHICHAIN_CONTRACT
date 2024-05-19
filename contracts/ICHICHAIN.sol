// SPDX-License-Identifier: GPL3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    // Event emitted when a new series is created
    event NewSeries(
        uint256 indexed seriesID,
        string seriesName,
        uint256 totalTicketNumbers,
        uint256 remainingTicketNumbers,
        uint256 priceInUSDTWei,
        uint256 priceInTWD,
        bool isGoodsArrived,
        uint256 estimateDeliverTime,
        uint256 exchangeExpireTime,
        string exchangeTokenURI,
        string unrevealTokenURI,
        string revealTokenURI,
        string seriesMetaDataURI,
        address lastPrizeOwner
    );
    // Event emitted when a new series is updated
    event UpdateSeriesInformation(
        uint256 indexed seriesID,
        bool isGoodsArrived, // 是否獎品已送達開放Reveal
        uint256 estimateDeliverTime,
        string exchangeTokenURI,
        string unrevealTokenURI,
        string revealTokenURI,
        string seriesMetaDataURI
    );
    // Event emitted when a series lastPrizeOwner is updated
    event UpdateSeriesLastPrizeOwner(
        uint256 indexed seriesID,
        address lastPrizeOwner
    );

    //Event emitted when a series remainingTicketNumbers is updated
    event UpdateSeriesRemainingTicketNumbers(
        uint256 indexed seriesID,
        uint256 remainingTicketNumbers
    );

    // Event emitted when a new NFT Prize is created
    event NewSubPrize(
        uint256 indexed seriesID,
        uint256 subPrizeID,
        string prizeGroup,
        string subPrizeName,
        uint256 subPrizeRemainingQuantity
    );
    // Event emitted when a new NFT Prize is updated
    event UpdatePrize(
        uint256 indexed seriesID,
        uint256 subPrizeID,
        uint256 subPrizeRemainingQuantity
    );
    // Event emitted when a new NFT is minted by MATIC
    event TokenMintByMatic(
        address to,
        uint256 quantity,
        uint256 seriesID,
        uint256 totalCostInMaticWei
    );
    // Event emitted when a new NFT is minted by currency
    event TokenMintByCurrency(
        address to,
        uint256 quantity,
        uint256 seriesID,
        address currencyToken,
        uint256 totalCostInWei
    );
    // Event emitted when a new NFT is minted by admin
    event TokenMintByAdmin(address to, uint256 seriesID, uint256 quantity);
    // Event emitted when a random number request is sent
    event RevealToken(uint256 requestId, uint256 seriesID, uint256[] tokenIDs);
    // Event emitted when a ticket status is created
    event NewTicketStatus(
        uint256 tokenID,
        uint256 seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed,
        address tokenOwner
    );
    // Event emitted when a ticket status is updated
    event UpdateTicketStatus(
        uint256 tokenID,
        uint256 seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed
    );
    // Event emitted when a last prize random number request is sent
    event LastPrizeDraw(uint256 requestId, uint256 seriesID);
    // Event emitted when a random number request is fulfilled
    event RequestFulfilled(uint256 requestId, uint256[] randomWords);
    // Event emitted when a prize is exchanged
    event RequestExchangePrize(uint256[] tokenIDs);
    // Event emitted when new currency token is added
    event AddCurrencyToken(address currencyToken, address priceFeedAddress);

    // Structure representing each NFT's ticket status
    struct TicketStatus {
        uint256 seriesID; // NFT所屬的抽獎系列
        uint256 tokenRevealedPrize; //開獎結果 Ex 1~8代表 A~H賞
        bool tokenExchange; // 有沒有兌換過實體獎品
        bool tokenRevealed; // Whether the token has been revealed
    }

    // structure representing each NFT's ticket status and tokenID
    struct TicketStatusWithTokenIDOwnerAddress {
        uint256 tokenID;
        address tokenOwner;
        TicketStatus ticketStatus;
    }

    // Structure representing each subprize in a series
    struct subPrize {
        uint256 subPrizeID; // 獎項ID 例子 '1~20'
        string prizeGroup; // 獎項群組 A, B, C, D, E, F, G, H
        string subPrizeName; // 獎項名稱，如 A1
        uint256 subPrizeRemainingQuantity; // 該獎項預設有幾個 Ex A賞 2個, B賞4個 etc.
    }

    // Structure representing each NFT series
    struct Series {
        subPrize[] subPrizes;
        string seriesName; // 此抽獎系列名稱
        uint256 totalTicketNumbers; // 總共提供幾抽
        uint256 remainingTicketNumbers; // 剩餘幾抽
        uint256 priceInUSDTWei; // 每抽多少錢
        bool isGoodsArrived; // 是否獎品已送達開放Reveal
        uint256 estimateDeliverTime; // 預估到貨時間
        uint256 exchangeExpireTime; // 取貨最後時間
        address lastPrizeOwner; // 最後一賞得主
        string exchangeTokenURI; // 兌換獎品修改metadata
        string unrevealTokenURI; // 抽獎前票券長相
        string revealTokenURI; // 抽獎後票券長相
        string seriesMetaDataURI; // Link to off chain infromation like image source
        uint256 priceInTWD; // 每抽多少台幣
    }

    // Mappings for series data and token status
    mapping(uint256 => Series) public ICHISeries;
    mapping(uint256 => uint256[]) public seriesTokens;
    mapping(uint256 => TicketStatus) public ticketStatusDetail;
    mapping(uint256 => uint256[]) public requestToRevealToken;
    mapping(uint256 => uint256) public requestToLastPrizeToken;

    // Define seriesCounter variable
    uint256 private seriesCounter = 0;

    // Erc20 token to let user to choose which currency to pay, include contract address, and price feed address
    struct Currency {
        address currencyToken;
        address priceFeedAddress;
    }

    Currency[] public currencyList;

    // mumbai price feed matic/usdt 0xd0D5e3DB44DE05E9F294BB0a3bEEaF030DE24Ada

    // Constructor for setting up the ICHICHAIN contract
    constructor(
        uint64 subscriptionId,
        address _linkToken
    )
        ERC721A("ICHICHAIN", "ICHI")
        VRFConsumerBaseV2(0x6A2AAd07396B36Fe02a22b33cf443582f682c82f)
    {
        // COORDINATOR = VRFCoordinatorV2Interface(
        //     0x7a1BaC17Ccc5b313516C5E16fb24f7659aA5ebed
        // );
        //arb sepolia
        COORDINATOR = VRFCoordinatorV2Interface(
            0x6A2AAd07396B36Fe02a22b33cf443582f682c82f
        );
        //plg COORDINATOR = VRFCoordinatorV2Interface(
        //     0x7a1BaC17Ccc5b313516C5E16fb24f7659aA5ebed
        // );
        //arb sepolia COORDINATOR = VRFCoordinatorV2Interface(
        //     0x50d47e4142598E3411aA864e08a44284e471AC6f
        // );
        s_subscriptionId = subscriptionId;
        s_keyHash = 0xd4bb89654db74673a187bd804519e65e3f71a52bc55f11da7601a13dcf505314;
        //plg s_keyHash = 0x4b09e658ed251bcafeebbc69400383d49f344ace09b9576fe248bb02c003fe9f;
        //arb sepolia s_keyHash = 0x027f94ff1465b3525f9fc03e9ff7d6d2c0953482246dd6ae07570c45d6631414;
        linkToken = _linkToken;
    }

    // Function to create a new NFT series
    function createSeries(
        string memory seriesName,
        uint256 priceInUSDTWei,
        uint256 priceInTWD,
        uint256 estimateDeliverTime,
        string memory exchangeTokenURI,
        string memory unrevealTokenURI,
        string memory revealTokenURI,
        string memory seriesMetaDataURI,
        subPrize[] memory subPrizes
    ) public onlyOwner {
        // Calculate the total of all prize quantities
        uint256 totalPrizeQuantity = 0;
        for (uint256 i = 0; i < subPrizes.length; i++) {
            totalPrizeQuantity += subPrizes[i].subPrizeRemainingQuantity;
        }
        uint256 seriesID = seriesCounter++;
        Series storage series = ICHISeries[seriesID];
        series.seriesName = seriesName;
        series.totalTicketNumbers = totalPrizeQuantity;
        series.remainingTicketNumbers = totalPrizeQuantity;
        series.priceInUSDTWei = priceInUSDTWei;
        series.priceInTWD = priceInTWD;
        series.isGoodsArrived = false;
        series.estimateDeliverTime = estimateDeliverTime;
        series.exchangeExpireTime = estimateDeliverTime + 86400 * 60;
        series.exchangeTokenURI = exchangeTokenURI;
        series.unrevealTokenURI = unrevealTokenURI;
        series.revealTokenURI = revealTokenURI;
        series.seriesMetaDataURI = seriesMetaDataURI;
        for (uint256 i = 0; i < subPrizes.length; i++) {
            series.subPrizes.push(subPrizes[i]);
            emit NewSubPrize(
                seriesID,
                1 + i,
                subPrizes[i].prizeGroup,
                subPrizes[i].subPrizeName,
                subPrizes[i].subPrizeRemainingQuantity
            );
        }

        // Emit event for the new series
        emitNewSeriesEvent(
            seriesID,
            seriesName,
            totalPrizeQuantity,
            priceInUSDTWei,
            priceInTWD,
            estimateDeliverTime,
            exchangeTokenURI,
            unrevealTokenURI,
            revealTokenURI,
            seriesMetaDataURI
        );
    }

    function emitNewSeriesEvent(
        uint256 seriesID,
        string memory seriesName,
        uint256 totalTicketNumbers,
        uint256 priceInUSDTWei,
        uint256 priceInTWD,
        uint256 estimateDeliverTime,
        string memory exchangeTokenURI,
        string memory unrevealTokenURI,
        string memory revealTokenURI,
        string memory seriesMetaDataURI
    ) internal {
        emit NewSeries(
            seriesID,
            seriesName,
            totalTicketNumbers,
            totalTicketNumbers,
            priceInUSDTWei,
            priceInTWD,
            false,
            estimateDeliverTime,
            estimateDeliverTime + 86400 * 60,
            exchangeTokenURI,
            unrevealTokenURI,
            revealTokenURI,
            seriesMetaDataURI,
            address(0)
        );
    }

    // Function to mint NFTs in a specified series
    function mintByMatic(uint256 seriesID, uint256 quantity) public payable {
        Series storage series = ICHISeries[seriesID];
        //TODO: change to real matic/usdt contract address
        int256 maticPriceInUSDT = getChainlinkDataFeedLatestAnswer(
            0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526
        ); // Get latest MATIC/USDT rate
        uint256 maticPerUSDTInWei = uint256(maticPriceInUSDT) * 1e10; // Convert price to wei (assuming 8 decimals from Chainlink)
        uint256 totalCostInMaticWei = (series.priceInUSDTWei *
            quantity *
            1e18) / maticPerUSDTInWei;

        require(msg.value >= totalCostInMaticWei, "Insufficient MATIC sent");

        require(
            quantity <= series.remainingTicketNumbers,
            "Not enough NFTs remaining in the series"
        );
        _safeMint(msg.sender, quantity);
        for (uint256 i = 0; i < quantity; ++i) {
            uint256 tokenId = _nextTokenId() - quantity + i;
            ticketStatusDetail[tokenId].seriesID = seriesID;
            seriesTokens[seriesID].push(tokenId); // Append the token ID to the series
            // Emit event for the new ticket status
            emit NewTicketStatus(
                tokenId,
                seriesID,
                0,
                false,
                false,
                msg.sender
            );
        }
        series.remainingTicketNumbers -= quantity;

        // emit event to update series remaining ticket numbers
        emit UpdateSeriesRemainingTicketNumbers(
            seriesID,
            series.remainingTicketNumbers
        );
        // event to log the minting
        emit TokenMintByMatic(
            msg.sender,
            quantity,
            seriesID,
            totalCostInMaticWei
        );
    }

    // Function to mint NFTs with a currency token list to let user to choose ex usdc, eth  etc.. and pass chainlink price feed address to get price
    // use currencyList struct to let user to choose which currency to pay
    // combine mintByUSDT into it and remove mintByUSDT

    function mintByCurrency(
        uint256 seriesID,
        uint256 quantity,
        uint256 CurrencyIndex // index of currencyList
    ) public {
        Series storage series = ICHISeries[seriesID];
        address currencyToken = currencyList[CurrencyIndex].currencyToken;
        address priceFeedAddress = currencyList[CurrencyIndex].priceFeedAddress;
        int256 priceInUSDT;
        uint256 toeknPerUSDTInWei;
        uint256 totalCostInWei;
        // if currencyToken is usdt skip get price,
        // TODO:// change to real usdt contract address
        if (currencyToken == 0x69a68F1a7C3A502cf9A290519b2088B1848BF259) {
            totalCostInWei = series.priceInUSDTWei * quantity;
        } else {
            priceInUSDT = getChainlinkDataFeedLatestAnswer(priceFeedAddress); // Get latest currency/USDT rate
            // the calculate logic like mint function
            toeknPerUSDTInWei = uint256(priceInUSDT) * 1e10; // Convert price to wei (assuming 8 decimals from Chainlink)
            totalCostInWei =
                (series.priceInUSDTWei * quantity * 1e18) /
                toeknPerUSDTInWei;
        }

        require(
            IERC20(currencyToken).allowance(msg.sender, address(this)) >=
                totalCostInWei,
            "Insufficient currency allowance"
        );
        require(
            IERC20(currencyToken).balanceOf(msg.sender) >= totalCostInWei,
            "Insufficient currency balance"
        );
        IERC20(currencyToken).transferFrom(
            msg.sender,
            address(this),
            totalCostInWei
        );

        require(
            quantity <= series.remainingTicketNumbers,
            "Not enough NFTs remaining in the series"
        );
        _safeMint(msg.sender, quantity);
        for (uint256 i = 0; i < quantity; ++i) {
            uint256 tokenId = _nextTokenId() - quantity + i;
            ticketStatusDetail[tokenId].seriesID = seriesID;
            seriesTokens[seriesID].push(tokenId); // Append the token ID to the series
            // Emit event for the new ticket status
            emit NewTicketStatus(
                tokenId,
                seriesID,
                0,
                false,
                false,
                msg.sender
            );
        }
        series.remainingTicketNumbers -= quantity;

        // emit event to update series remaining ticket numbers
        emit UpdateSeriesRemainingTicketNumbers(
            seriesID,
            series.remainingTicketNumbers
        );
        // event to log the minting by currency
        emit TokenMintByCurrency(
            msg.sender,
            quantity,
            seriesID,
            currencyToken,
            totalCostInWei
        );
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
            ticketStatusDetail[tokenId].seriesID = seriesID;
            seriesTokens[seriesID].push(tokenId); // Append the token ID to the series
            // Emit event for the new ticket status
            emit NewTicketStatus(
                tokenId,
                seriesID,
                0,
                false,
                false,
                to
            );
        }

        series.remainingTicketNumbers -= quantity;
        // emit event to update series remaining ticket numbers
        emit UpdateSeriesRemainingTicketNumbers(
            seriesID,
            series.remainingTicketNumbers
        );
        emit TokenMintByAdmin(to, seriesID, quantity);
    }

    // Function to reveal specified NFTs in a series
    function reveal(uint256 seriesID, uint256[] memory tokenIDs) public {
        Series storage series = ICHISeries[seriesID];
        require(series.isGoodsArrived, "Not yet arrived");
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
        emit RevealToken(requestId, seriesID, tokenIDs);
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
        emit LastPrizeDraw(requestId, seriesID);
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
        Series storage calculateSeries = ICHISeries[
            ticketStatusDetail[tokenIDs[0]].seriesID
        ];
        // iterate through the series to calculate the unreveal prize quantity
        uint256 totalReaminingPrizeQuantity = 0;
        for (uint256 i = 0; i < calculateSeries.subPrizes.length; i++) {
            totalReaminingPrizeQuantity += calculateSeries
                .subPrizes[i]
                .subPrizeRemainingQuantity;
        }

        // calculate the remaing prize quantity in each prize)
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            uint256 tokenId = tokenIDs[i];
            Series storage series = ICHISeries[
                ticketStatusDetail[tokenId].seriesID
            ];
            uint256 selectedPrizeIndex = randomWords[i] %
                totalReaminingPrizeQuantity; // Selecting from available prizes
            // Use the selectedPrizeIndex to find the index is in which range of prize
            for (uint256 j = 0; j < series.subPrizes.length; j++) {
                if (
                    selectedPrizeIndex <
                    series.subPrizes[j].subPrizeRemainingQuantity
                ) {
                    selectedPrizeIndex = j;
                    break;
                }
                selectedPrizeIndex -= series
                    .subPrizes[j]
                    .subPrizeRemainingQuantity;
            }

            // Award the prize
            subPrize storage selectedSubPrize = series.subPrizes[
                selectedPrizeIndex
            ];
            totalReaminingPrizeQuantity -= 1;
            selectedSubPrize.subPrizeRemainingQuantity -= 1;
            ticketStatusDetail[tokenId].tokenRevealedPrize = selectedSubPrize.subPrizeID;
            ticketStatusDetail[tokenId].tokenRevealed = true;
            // Emit event for the updated prize remaining quantity
            emit UpdatePrize(
                ticketStatusDetail[tokenId].seriesID,
                selectedSubPrize.subPrizeID,
                selectedSubPrize.subPrizeRemainingQuantity
            );
            // Emit event for the updated ticket status
            emit UpdateTicketStatus(
                tokenId,
                ticketStatusDetail[tokenId].seriesID,
                selectedSubPrize.subPrizeID,
                false,
                true
            );
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
        ticketStatusDetail[newTokenId].seriesID = seriesID;
        ticketStatusDetail[newTokenId].tokenRevealedPrize = 999;
        ticketStatusDetail[newTokenId].tokenRevealed = true;

        series.lastPrizeOwner = winnerAddress;
        // Emit event for the updated series information
        emit UpdateSeriesLastPrizeOwner(seriesID, winnerAddress);
        // Emit event for the new ticket status
        emit NewTicketStatus(
            newTokenId,
            seriesID,
            999,
            false,
            true,
            winnerAddress
        );
        delete requestToLastPrizeToken[requestId];
    }

    // Override tokenURI to provide the correct metadata based on reveal status
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        uint256 seriesID = ticketStatusDetail[tokenId].seriesID;
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

    function goodsArrived(uint256 seriesID) public onlyOwner {
        Series storage series = ICHISeries[seriesID];
        require(!series.isGoodsArrived, "Already arrived");
        series.isGoodsArrived = true;
        emit UpdateSeriesInformation(
            seriesID,
            true,
            series.estimateDeliverTime,
            series.exchangeTokenURI,
            series.unrevealTokenURI,
            series.revealTokenURI,
            series.seriesMetaDataURI
        );
    }

    function exchangePrize(uint256[] memory tokenIDs) public {
        for (uint256 i = 0; i < tokenIDs.length; i++) {
            require(ownerOf(tokenIDs[i]) == msg.sender, "Not the token owner");
            require(
                ticketStatusDetail[tokenIDs[i]].tokenRevealed,
                "Token not revealed"
            );
            require(
                ticketStatusDetail[tokenIDs[i]].tokenExchange == false,
                "Token already exchanged"
            );
            ticketStatusDetail[tokenIDs[i]].tokenExchange = true;
            emit UpdateTicketStatus(
                tokenIDs[i],
                ticketStatusDetail[tokenIDs[i]].seriesID,
                ticketStatusDetail[tokenIDs[i]].tokenRevealedPrize,
                true,
                true
            );
        }
        emit RequestExchangePrize(tokenIDs);
        // Emit event for the updated ticket status
    }

    function withdraw() external onlyOwner {
        (bool success, ) = payable(msg.sender).call{
            value: address(this).balance
        }("");
        require(success, "Transfer failed.");
    }

    function addCurrencyToken(
        address currencyToken,
        address priceFeedAddress
    ) external onlyOwner {
        currencyList.push(Currency(currencyToken, priceFeedAddress));
        emit AddCurrencyToken(currencyToken, priceFeedAddress);
    }

    // withdraw currency token
    function withdrawCurrencyToken(
        address currencyToken,
        uint256 amount
    ) external onlyOwner {
        IERC20(currencyToken).transfer(msg.sender, amount);
    }

    // Function to get the latest price of MATIC/USDT from Chainlink and pass the price feed address to get price
    function getChainlinkDataFeedLatestAnswer(
        address priceFeedAddresss
    ) public view returns (int256) {
        AggregatorV3Interface priceFeed = AggregatorV3Interface(
            priceFeedAddresss
        );
        // prettier-ignore
        (
            /* uint80 roundID */,
            int answer,
            /*uint startedAt*/,
            /*uint timeStamp*/,
            /*uint80 answeredInRound*/
        ) = priceFeed.latestRoundData();
        return answer;
    }

    function getSeriesTokenOwnerList(
        uint256 seriesID
    ) public view returns (address[] memory) {
        require(seriesID < seriesCounter, "Series does not exist");
        uint256[] memory tokensInSeries = seriesTokens[seriesID];
        address[] memory tokenOwners = new address[](tokensInSeries.length);
        for (uint256 i = 0; i < tokensInSeries.length; i++) {
            tokenOwners[i] = ownerOf(tokensInSeries[i]);
        }
        return tokenOwners;
    }

    // return ticketStatusDetail and tokenID into return array
    function getSeriesTokenList(
        uint256 seriesID
    ) public view returns (TicketStatusWithTokenIDOwnerAddress[] memory) {
        require(seriesID < seriesCounter, "Series does not exist");
        uint256[] memory tokensInSeries = seriesTokens[seriesID];
        TicketStatusWithTokenIDOwnerAddress[]
            memory tokenPrizes = new TicketStatusWithTokenIDOwnerAddress[](
                tokensInSeries.length
            );

        // add ticketStatusDetail,tokenID,owner into return array
        for (uint256 i = 0; i < tokensInSeries.length; i++) {
            uint256 tokenId = tokensInSeries[i];
            tokenPrizes[i] = TicketStatusWithTokenIDOwnerAddress({
                tokenID: tokenId,
                tokenOwner: ownerOf(tokensInSeries[i]),
                ticketStatus: ticketStatusDetail[tokenId]
            });
        }
        return tokenPrizes;
    }

    function getSeriesTotalLength() public view returns (uint256) {
        return seriesCounter;
    }
}
