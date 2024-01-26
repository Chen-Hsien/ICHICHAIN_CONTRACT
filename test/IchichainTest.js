const { expect } = require("chai");
const { ethers } = require("hardhat");

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
      const price = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];

      // Create a new series
      await ichichain.createSeries(
        seriesName,
        price,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        prizes
      );

      // Fetch the created series data
      const createdSeries = await ichichain.ICHISeries(0);

      // Verify the series data
      expect(createdSeries.seriesName).to.equal(seriesName);
      expect(createdSeries.totalTicketNumbers).to.equal(totalTicketNumbers);
      expect(createdSeries.remainingTicketNumbers).to.equal(totalTicketNumbers);
      expect(createdSeries.price.toString()).to.equal(price.toString());
      expect(createdSeries.revealTime).to.equal(revealTime);
      expect(createdSeries.exchangeTokenURI).to.equal(exchangeTokenURI);
      expect(createdSeries.unrevealTokenURI).to.equal(unrevealTokenURI);
      expect(createdSeries.revealTokenURI).to.equal(revealTokenURI);
    });

    it("should revert if a non-owner tries to create a series", async function () {
      const seriesName = "New Series";
      const price = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
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
            price,
            revealTime,
            exchangeTokenURI,
            unrevealTokenURI,
            revealTokenURI,
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

  describe("Minting Functionality", function () {
    const mintQuantity = 2; // Number of NFTs to mint
    const mintValue = ethers.parseEther("0.2"); // Value for minting (price * quantity)
    let seriesID;

    beforeEach(async function () {
      // Create a new series before each test
      const seriesName = "New Series";
      const price = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        price,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
        prizes
      );
      seriesID = 0; // Assuming this is the first series created
    });

    it("should mint NFTs correctly", async function () {
      // Mint NFTs
      await ichichain.mint(seriesID, mintQuantity, { value: mintValue });

      // Fetch updated series data
      const updatedSeries = await ichichain.ICHISeries(seriesID);

      // Check that remaining tickets are reduced
      expect(Number(updatedSeries.remainingTicketNumbers)).to.equal(
        Number(updatedSeries.totalTicketNumbers) - Number(mintQuantity)
      );

      // Additional checks can be added here, e.g., checking the owner of minted tokens
    });

    it("should revert when minting with insufficient funds", async function () {
      try {
        await ichichain.mint(seriesID, mintQuantity, {
          value: ethers.parseEther("0.01"),
        });
        expect.fail(
          "Transaction should have reverted due to insufficient funds"
        );
      } catch (error) {
        expect(error.message).to.include("Insufficient funds sent");
      }
    });

    it("should revert when minting more than available tickets", async function () {
      const updatedSeries = await ichichain.ICHISeries(seriesID);
      try {
        await ichichain.mint(
          seriesID,
          Number(updatedSeries.totalTicketNumbers) + 1,
          {
            value: ethers.parseEther("1.1"),
          }
        );
        expect.fail(
          "Transaction should have reverted due to exceeding available tickets"
        );
      } catch (error) {
        expect(error.message).to.include(
          "Not enough NFTs remaining in the series"
        );
      }
    });

    it("should revert when minting from a non-existent series", async function () {
      try {
        await ichichain.mint(999, mintQuantity, { value: mintValue }); // Non-existent series ID
        expect.fail(
          "Transaction should have reverted due to non-existent series"
        );
      } catch (error) {
        expect(error.message).to.include("Series does not exist");
      }
    });
  });

  describe("Admin mint Functionality", function () {
    beforeEach(async function () {
      // Create a new series before each test
      const seriesName = "New Series";
      const price = ethers.parseEther("0.1");
      const revealTime = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];
      await ichichain.createSeries(
        seriesName,
        price,
        revealTime,
        exchangeTokenURI,
        unrevealTokenURI,
        revealTokenURI,
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
        for (let i = 1; i <= quantity; i++) {
          const tokenId = Number(totalSupply) - i; // Assuming these are the last minted tokens
          expect(await ichichain.tokenSeriesMapping(tokenId)).to.equal(
            seriesID
          );
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
      // Mint tokens and setup for reveal
      const seriesName = "New Series";
      const price = ethers.parseEther("0.1");
      const revealTime =
        (await ethers.provider.getBlock("latest")).timestamp + 60 * 60; // 1 hour from now
      const exchangeTokenURI = "ipfs://exchangeTokenURI";
      const unrevealTokenURI = "ipfs://unrevealTokenURI";
      const revealTokenURI = "ipfs://revealTokenURI";
      const prizes = [
        ["A", "2"],
        ["B", "2"],
        ["C", "3"],
        ["D", "3"],
      ];

      await ichichain
        .connect(owner)
        .createSeries(
          seriesName,
          price,
          revealTime,
          exchangeTokenURI,
          unrevealTokenURI,
          revealTokenURI,
          prizes
        );

      // Mint tokens to addr1
      await ichichain
        .connect(owner)
        .mint(0, 5, { value: ethers.parseEther("0.5") });
    });

    // it("should successfully reveal tokens", async function () {
    //   const tokenIDs = [0, 1, 2, 3, 4];
    //   // Increase time to surpass revealTime
    //   await ethers.provider.send("evm_increaseTime", [3600]); // Increase by 1 hour
    //   await ethers.provider.send("evm_mine");

    //   await expect(ichichain.connect(addr1).reveal(0, tokenIDs))

    //   await expect(ichichain.connect(owner).reveal(0, tokenIDs))
    //     .to.emit(ichichain, "RevealToken")
    //     .withArgs(BigInt(1), tokenIDs.length);
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
        .connect(addr2)
        .mint(0, 5, { value: ethers.parseEther("0.5") });

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
    // Add tests for last prize winner selection
  });

  describe("Token URI Handling", function () {
    // Add tests for tokenURI function
  });

  describe("Exchange Prize Functionality", function () {
    // Add tests for exchanging prizes
  });

  describe("Utility Functions", function () {
    // Add tests for utility functions
  });

  // Add any additional describe blocks as needed
});
