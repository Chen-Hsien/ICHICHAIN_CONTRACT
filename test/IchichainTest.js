const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper function to create a series
async function createTestSeries(ichichain, owner, seriesParams) {
  const {
    seriesName,
    priceInUSDTWei,
    revealTime,
    exchangeTokenURI,
    unrevealTokenURI,
    revealTokenURI,
    seriesMetaDataURI,
    prizes,
  } = seriesParams;
  await ichichain
    .connect(owner)
    .createSeries(
      seriesName,
      priceInUSDTWei,
      revealTime,
      exchangeTokenURI,
      unrevealTokenURI,
      revealTokenURI,
      seriesMetaDataURI,
      prizes
    );
}

describe("ICHICHAIN Contract", function () {
  let ichichain;
  let owner, addr1, addr2;
  let hardhatVrfCoordinatorV2Mock;

  // Deploy the contract before each test
  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    const Ichichain = await ethers.getContractFactory("ICHICHAIN");
    [owner, addr1, addr2] = await ethers.getSigners();
    let vrfCoordinatorV2Mock = await ethers.getContractFactory(
      "VRFCoordinatorV2Mock"
    );

    hardhatVrfCoordinatorV2Mock = await vrfCoordinatorV2Mock.deploy(0, 0);

    await hardhatVrfCoordinatorV2Mock.createSubscription();

    await hardhatVrfCoordinatorV2Mock.fundSubscription(
      1,
      ethers.parseEther("10")
    );

    // Deploy the contract
    ichichain = await Ichichain.deploy(1, hardhatVrfCoordinatorV2Mock.target);

    // Mock USDT and another currency for testing
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdt = await MockERC20.deploy("USDT", "USDT");

    const DECIMALS = "18";
    const INITIAL_PRICE = "200000000000000000000";

    const mockV3AggregatorFactory = await ethers.getContractFactory(
      "MockV3Aggregator"
    );
    const mockV3Aggregator = await mockV3AggregatorFactory.deploy(
      DECIMALS,
      INITIAL_PRICE
    );

    await ichichain.addCurrencyToken(usdt.target, mockV3Aggregator.target);
  });

  describe("Contract Deployment", function () {
    it("should deploy the contract successfully", async function () {
      // Check if the contract address is valid (not zero address)
      expect(ichichain.target).to.properAddress;
    });

    it("should set the correct owner", async function () {
      // Check if the owner of the contract is the one who deployed it
      expect(await ichichain.owner()).to.equal(owner.address);
    });
  });

  describe("Series Creation", function () {
    it("should allow the owner to create a new series", async function () {
      const seriesName = "New Series";
      const totalTicketNumbers = 10;
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];

      // Create a new series
      await ichichain.createSeries(
        seriesName,
        priceInUSDTWei,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        seriesMetaDataURI,
        prizes
      );

      // Fetch the created series data
      const createdSeries = await ichichain.ICHISeries(0);

      // Verify the series data
      expect(createdSeries.seriesName).to.equal(seriesName);
      expect(createdSeries.totalTicketNumbers).to.equal(totalTicketNumbers);
      expect(createdSeries.remainingTicketNumbers).to.equal(totalTicketNumbers);
      expect(createdSeries.priceInUSDTWei.toString()).to.equal(
        priceInUSDTWei.toString()
      );
      expect(createdSeries.revealTime).to.equal(revealTime);
      expect(createdSeries.exchangeTokenURI).to.equal(exchangeTokenURI);
      expect(createdSeries.unrevealTokenURI).to.equal(unrevealTokenURI);
      expect(createdSeries.revealTokenURI).to.equal(revealTokenURI);
    });

    it("should revert if a non-owner tries to create a series", async function () {
      const seriesName = "New Series";
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];

      try {
        // Create a new series
        await ichichain
          .connect(addr1)
          .createSeries(
            seriesName,
            priceInUSDTWei,
            revealTime,
            exchangeTokenURI,
            unrevealTokenURI,
            revealTokenURI,
            seriesMetaDataURI,
            prizes
          );
        // If this line is reached, the test should fail
        expect.fail("Ownable: caller is not the owner");
      } catch (error) {
        // Expect the transaction to revert
        expect(error.message).to.include("revert");
      }
    });
  });
// disable it until mock price feed is can use in test
  // describe("Minting Functionality", function () {
  //   const mintQuantity = 2; // Number of NFTs to mint
  //   const mintValue = ethers.parseEther("0.2"); // Value for minting (priceInUSDTWei * quantity)
  //   let seriesID;

  //   beforeEach(async function () {
  //     // Create a new series before each test
  //     const seriesName = "New Series";
  //     const priceInUSDTWei = ethers.parseEther("0.1");
  //     const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
  //     const exchangeTokenURI = "ipfs://exchangeTokenURI";
  //     const unrevealTokenURI = "ipfs://unrevealTokenURI";
  //     const revealTokenURI = "ipfs://revealTokenURI";
  //     const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
  //     const prizes = [
  //       ["A", "2"],
  //       ["B", "2"],
  //       ["C", "3"],
  //       ["D", "3"],
  //     ];
  //     await ichichain.createSeries(
  //       seriesName,
  //       priceInUSDTWei,
  //       revealTime,
  //       exchangeTokenURI,
  //       unrevealTokenURI,
  //       revealTokenURI,
  //       seriesMetaDataURI,
  //       prizes
  //     );
  //     seriesID = 0; // Assuming this is the first series created
  //   });

  //   // it("should mint NFTs correctly using MATIC with mocked price feed", async function () {
  //   //   // Assuming you have a function to setup a series or it's done in beforeEach
  //   //   const seriesID = 0; // or however you obtain the series ID
  //   //   const quantity = 1; // Quantity to mint
  //   //   const maticPriceInUSDT = "2000"; // Mock price
  //   //   const updatedSeries = await ichichain.ICHISeries(seriesID);

  //   //   const totalCostInMaticWei = (Number(updatedSeries.priceInUSDTWei) *
  //   //     quantity *
  //   //     1e18) / Number(maticPriceInUSDT) * 1e10;

  //   //   // Mint NFTs using MATIC
  //   //   await ichichain.mintByMatic(seriesID, quantity, {
  //   //     value: ethers.parseEther("0.1"),
  //   //   });
  //   //   // Check that remaining tickets are reduced
  //   //   expect(Number(updatedSeries.remainingTicketNumbers)).to.equal(
  //   //     Number(updatedSeries.totalTicketNumbers) - Number(mintQuantity)
  //   //   );
  //   //   // Additional assertions can be made here, such as checking the owner of the minted NFT, remaining ticket numbers, etc.
  //   // });

  //   it("should revert when minting with insufficient funds", async function () {
  //     try {
  //       await ichichain.mintByMatic(seriesID, mintQuantity, {
  //         value: ethers.parseEther("0.01"),
  //       });
  //       expect.fail("Insufficient MATIC sent");
  //     } catch (error) {
  //       expect(error.message).to.include("Insufficient MATIC sent");
  //     }
  //   });

  //   it("should revert when minting more than available tickets", async function () {
  //     const updatedSeries = await ichichain.ICHISeries(seriesID);
  //     try {
  //       await ichichain.mintByMatic(
  //         seriesID,
  //         Number(updatedSeries.totalTicketNumbers) + 1,
  //         {
  //           value: ethers.parseEther("1.1"),
  //         }
  //       );
  //       expect.fail(
  //         "Transaction should have reverted due to exceeding available tickets"
  //       );
  //     } catch (error) {
  //       expect(error.message).to.include(
  //         "Not enough NFTs remaining in the series"
  //       );
  //     }
  //   });

  //   it("should revert when minting from a non-existent series", async function () {
  //     try {
  //       await ichichain.mintByMatic(999, mintQuantity, { value: mintValue }); // Non-existent series ID
  //       expect.fail(
  //         "Transaction should have reverted due to non-existent series"
  //       );
  //     } catch (error) {
  //       expect(error.message).to.include("Series does not exist");
  //     }
  //   });
  // });

  describe("Admin mint Functionality", function () {
    beforeEach(async function () {
      // Create a new series before each test
      const seriesName = "New Series";
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        priceInUSDTWei,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        seriesMetaDataURI,
        prizes
      );
      seriesID = 0; // Assuming this is the first series created
    });

    describe("Admin Minting Functionality", function () {
      let owner, addr1, addr2;

      beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();
        // Assume a series is already created here as in previous tests
      });

      it("should allow owner to mint NFTs without payment", async function () {
        const seriesID = 0; // Assuming a series is already created
        const quantity = 2;

        // Ensure the quantity is valid
        if (isNaN(quantity)) {
          throw new Error("Quantity is NaN");
        }

        await ichichain
          .connect(owner)
          .AdminMint(addr1.address, seriesID, quantity);

        // Fetch totalSupply and ensure it's valid
        const totalSupply = await ichichain.totalSupply();
        if (isNaN(Number(totalSupply))) {
          throw new Error("Total supply calculation resulted in NaN");
        }

        // Verify the state updates
        const updatedSeries = await ichichain.ICHISeries(seriesID);
        expect(Number(updatedSeries.remainingTicketNumbers)).to.equal(
          Number(updatedSeries.totalTicketNumbers) - quantity
        );

        // Check if the tokens are correctly mapped to the series
        for (let i = 0; i < quantity; i++) {
          const ticketDetail = await ichichain.ticketStatusDetail(i);
          expect(ticketDetail.seriesID).to.equal(seriesID);
        }
      });

      it("should revert when non-owner tries to admin mint NFTs", async function () {
        const seriesID = 0;
        const quantity = 2;

        // Attempt to mint from a non-owner account and expect a revert
        await expect(
          ichichain.connect(addr1).AdminMint(addr1.address, seriesID, quantity)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      // Additional scenarios and edge cases can be tested similarly
    });
  });

  describe("Reveal Functionality", function () {
    beforeEach(async function () {
      // Create a new series before each test
      const seriesName = "New Series";
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        priceInUSDTWei,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        seriesMetaDataURI,
        prizes
      );
      seriesID = 0; // Assuming this is the first series created

      // Mint tokens to addr1
      await ichichain
        .connect(owner)
        .AdminMint( owner, 0, 5);
    });

    // it("should successfully reveal tokens", async function () {
    //     const tokenIDs = [0, 1, 2, 3, 4];
    //     // Increase time to surpass revealTime
    //     await ethers.provider.send("evm_increaseTime", [3600]); // Increase by 1 hour
    //     await ethers.provider.send("evm_mine");

    //     await expect(ichichain.connect(addr1).reveal(0, tokenIDs));

    //     await expect(ichichain.connect(owner).reveal(0, tokenIDs))
    //         .to.emit(ichichain, "RevealToken")
    //         .withArgs(ethers.BigNumber.from(0), tokenIDs.length);
    // });

    // it("Coordinator should successfully receive the request", async function () {
    //   // await expect(hardhatOurNFTContract.safeMint("Halley")).to.emit(
    //   //   hardhatVrfCoordinatorV2Mock,
    //   //   "RandomWordsRequested"
    //   // );
    //   const tokenIDs = [0, 1, 2, 3, 4];
    //   // Increase time to surpass revealTime
    //   await ethers.provider.send("evm_increaseTime", [3600]); // Increase by 1 hour
    //   await ethers.provider.send("evm_mine");

    //   await expect(ichichain.connect(owner).reveal(0, tokenIDs)).to.emit(
    //     hardhatVrfCoordinatorV2Mock,
    //     "RandomWordsRequested"
    //   );
    // });

    it("should revert if reveal is attempted before reveal time", async function () {
      const tokenIDs = [0, 1, 2, 3, 4];
      await expect(
        ichichain.connect(owner).reveal(0, tokenIDs)
      ).to.be.revertedWith("Not in reveal time");
    });

    it("should revert if a non-owner tries to reveal tokens", async function () {
      const tokenIDs = [0, 1, 2, 3, 4];
      await ethers.provider.send("evm_increaseTime", [3600]); // Increase by 1 hour
      await ethers.provider.send("evm_mine");

      // also owned 5 tokens
      await ichichain
        .connect(owner)
        .AdminMint( addr2, 0, 5);

      await expect(
        ichichain.connect(addr2).reveal(0, tokenIDs)
      ).to.be.revertedWith("Not the token owner");
    });

    // it("should revert if trying to reveal already revealed tokens", async function () {
    //   const tokenIDs = [0, 1, 2, 3, 4];
    //   // First, successfully reveal tokens
    //   await ethers.provider.send("evm_increaseTime", [3600]); // Increase by 1 hour
    //   await ethers.provider.send("evm_mine");
    //   await ichichain.connect(owner).reveal(0, tokenIDs);

    //   // Then, attempt to reveal the same tokens again
    //   await expect(
    //     ichichain.connect(owner).reveal(0, tokenIDs)
    //   ).to.be.revertedWith("Token already revealed");
    // });
  });

  describe("Last Prize Winner Selection", function () {
    beforeEach(async function () {
      // Create a new series before each test
      const seriesName = "New Series";
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        priceInUSDTWei,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        seriesMetaDataURI,
        prizes
      );
      seriesID = 0; // Assuming this is the first series created◊

      // Mint tokens to addr1
      await ichichain
        .connect(owner)
        .AdminMint( owner, 0, 5);
    });

    it("should revert if non-owner tries to select last prize winner", async function () {
      // Attempt to choose the last prize winner as a non-owner
      await expect(
        ichichain.connect(addr1).chooseLastPrizeWinner(seriesID)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if trying to select last prize winner before selling out", async function () {
      // Attempt to choose last prize winner before series is sold out
      await expect(
        ichichain.connect(owner).chooseLastPrizeWinner(seriesID)
      ).to.be.revertedWith("Not sold out yet");
    });
  });

  describe("Token URI Handling", function () {
    let seriesID;
    // ... (other variables as per your contract)

    beforeEach(async function () {
      // Mint tokens and setup for reveal
      const seriesName = "New Series";
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        priceInUSDTWei,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        seriesMetaDataURI,
        prizes
      );
      seriesID = 0; // Assuming this is the first series created

      // Mint tokens to addr1
      await ichichain
        .connect(owner)
        .AdminMint( owner, 0, 5);
    });

    // wait to test
    it("should return correct URI for an exchanged token", async function () {
      // Assuming token 0 has been exchanged
      //   await ichichain.connect(owner).exchangePrize([0]);
      //   const tokenURI = await ichichain.tokenURI(0);
      //   expect(tokenURI).to.equal(
      //     series.exchangeTokenURI +
      //       tokenStatusDetail[0].tokenRevealedPrize.toString()
      //   );
    });

    // wait to test
    it("should return correct URI for a revealed but not exchanged token", async function () {
      //   const tokenURI = await ichichain.tokenURI(1);
      //   expect(tokenURI).to.equal(series.revealTokenURI + tokenStatusDetail[1].tokenRevealedPrize.toString());
    });

    it("should return correct URI for an unrevealed token", async function () {
      const updatedSeries = await ichichain.ICHISeries(0);
      // Assuming token 2 has not been revealed
      const tokenURI = await ichichain.tokenURI(2);
      expect(tokenURI).to.equal(updatedSeries.unrevealTokenURI);
    });

    // Additional tests for error cases, like querying a non-existent token
    it("should revert for a non-existent token", async function () {
      const nonExistentTokenId = 999; // An ID that has not been minted
      await expect(ichichain.tokenURI(nonExistentTokenId)).to.be.revertedWith(
        "Token does not exist"
      );
    });
  });

  describe("Exchange Prize Functionality", function () {
    beforeEach(async function () {
      // Mint tokens and setup for reveal
      const seriesName = "New Series";
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        priceInUSDTWei,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        seriesMetaDataURI,
        prizes
      );
      seriesID = 0; // Assuming this is the first series created

      // Mint tokens to addr1
      await ichichain
        .connect(owner)
        .AdminMint( owner, 0, 5);
    });

    it("should revert if a non-owner tries to exchange a token", async function () {
      // Attempt to exchange the token from a different address
      await expect(
        ichichain.connect(addr1).exchangePrize([0])
      ).to.be.revertedWith("Not the token owner");
    });

    it("should revert if the token is not revealed", async function () {
      // Mint a new token to addr1 and attempt to exchange it without revealing
      await ichichain
        .connect(owner)
        .AdminMint( owner, 0, 5);
      const newTokenId = 5;
      await expect(
        ichichain.connect(owner).exchangePrize([newTokenId])
      ).to.be.revertedWith("Token not revealed");
    });
  });

  describe("Add Currency Token", function () {
    it("should add a new currency token", async function () {
      const DECIMALS = "18";
      const INITIAL_PRICE = "300000000000000000000";

      const mockV3AggregatorFactory = await ethers.getContractFactory(
        "MockV3Aggregator"
      );
      const mockV3Aggregator = await mockV3AggregatorFactory.deploy(
        DECIMALS,
        INITIAL_PRICE
      );
      // Mock USDT and another currency for testing
      const MockERC20 = await ethers.getContractFactory("MockERC20");

      const otherCurrency = await MockERC20.deploy("OTHER", "OTHER");

      await ichichain.addCurrencyToken(
        otherCurrency.target,
        mockV3Aggregator.target
      );

      const currencyToken = await ichichain.currencyList(1);
      expect(currencyToken.priceFeedAddress).to.equal(mockV3Aggregator.target);
    });

    it("should revert if a non-owner tries to add a new currency token", async function () {
      const DECIMALS = "18";
      const INITIAL_PRICE = "200000000000000000000";

      const mockV3AggregatorFactory = await ethers.getContractFactory(
        "MockV3Aggregator"
      );
      const mockV3Aggregator = await mockV3AggregatorFactory.deploy(
        DECIMALS,
        INITIAL_PRICE
      );
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const otherCurrency = await MockERC20.deploy("OTHER", "OTHER");

      await ichichain.addCurrencyToken(
        otherCurrency.target,
        mockV3Aggregator.target
      );

      await expect(
        ichichain
          .connect(addr1)
          .addCurrencyToken(otherCurrency.target, mockV3Aggregator.target)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Utility Functions", function () {
    beforeEach(async function () {
      // Mint tokens and setup for reveal
      const seriesName = "New Series";
      const priceInUSDTWei = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        priceInUSDTWei,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        seriesMetaDataURI,
        prizes
      );
      seriesID = 0; // Assuming this is the first series created
      // Mint tokens to addr1
      await ichichain
        .connect(owner)
        .AdminMint( owner, 0, 5);
    });

    describe("getPaginatedSeriesInfo", function () {
      it("should return correct series information for a given range", async function () {
        const seriesInfo = await ichichain.getPaginatedSeriesInfo(0, 0);
        expect(seriesInfo.length).to.equal(1);
        expect(seriesInfo[0].seriesName).to.equal("New Series");
        expect(Number(seriesInfo[0].totalTicketNumbers)).to.equal(10); // Sum of prizes
        expect(Number(seriesInfo[0].remainingTicketNumbers)).to.equal(10 - 5); // 5 minted
        // Add more assertions as needed
      });
      it("should return correct series information for a given range", async function () {
        // Mint tokens and setup for reveal
        const seriesName = "New Series 2";
        const priceInUSDTWei = ethers.parseEther("0.1");
        const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
        const exchangeTokenURI = "ipfs://exchangeTokenURI";
        const unrevealTokenURI = "ipfs://unrevealTokenURI";
        const revealTokenURI = "ipfs://revealTokenURI";
        const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
        const prizes = [
          ["A", "2"],
          ["B", "2"],
          ["C", "3"],
          ["D", "3"],
        ];
        await ichichain.createSeries(
          seriesName,
          priceInUSDTWei,
          revealTime,
          exchangeTokenURI,
          unrevealTokenURI,
          revealTokenURI,
          seriesMetaDataURI,
          prizes
        );
        await ichichain
          .connect(owner)
          .AdminMint( owner, 1, 5);
        const seriesInfo = await ichichain.getPaginatedSeriesInfo(0, 1);
        expect(seriesInfo.length).to.equal(2);
        expect(seriesInfo[1].seriesName).to.equal("New Series 2");
        expect(Number(seriesInfo[1].totalTicketNumbers)).to.equal(10); // Sum of prizes
        expect(Number(seriesInfo[1].remainingTicketNumbers)).to.equal(10 - 5); // 5 minted
        // Add more assertions as needed
      });
    });

    describe("getSeriesTokenOwnerList", function () {
      it("should return correct owners for tokens in a series", async function () {
        const tokenOwners = await ichichain.getSeriesTokenOwnerList(0);
        expect(tokenOwners.length).to.equal(5);
        for (const ownerAddress of tokenOwners) {
          expect(ownerAddress).to.equal(owner.address); // Assuming the owner minted all
        }
      });
    });

    describe("getSeriesTokenList", function () {
      it("should return detailed list of tokens with their status and owners", async function () {
        const tokenList = await ichichain.getSeriesTokenList(0);
        expect(tokenList.length).to.equal(5);
        for (const token of tokenList) {
          expect(token.tokenOwner).to.equal(owner.address);
          expect(token.ticketStatus.seriesID).to.equal(0);
          // Validate more fields as necessary
        }
      });
    });

    describe("getSeriesTotalLength", function () {
      it("should return the correct total number of series", async function () {
        const totalLength = await ichichain.getSeriesTotalLength();
        expect(totalLength).to.equal(1); // Assuming only one series was created
      });

      it("should update correctly after a new series is created", async function () {
        // Create another series (assuming createSeries function and necessary parameters are defined)
        const seriesName = "New Series";
        const priceInUSDTWei = ethers.parseEther("0.1");
        const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
        const exchangeTokenURI = "ipfs://exchangeTokenURI";
        const unrevealTokenURI = "ipfs://unrevealTokenURI";
        const revealTokenURI = "ipfs://revealTokenURI";
        const seriesMetaDataURI = "ipfs://seriesMetaDataURI";
        const prizes = [
          ["A", "2"],
          ["B", "2"],
          ["C", "3"],
          ["D", "3"],
        ];
        await ichichain.createSeries(
          seriesName,
          priceInUSDTWei,
          revealTime,
          exchangeTokenURI,
          unrevealTokenURI,
          revealTokenURI,
          seriesMetaDataURI,
          prizes
        );
        const updatedLength = await ichichain.getSeriesTotalLength();
        expect(updatedLength).to.equal(2);
      });
    });
  });
});
