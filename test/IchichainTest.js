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
        totalTicketNumbers,
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
  

        try {
        // Create a new series
        await ichichain.connect(addr1).createSeries(
            seriesName,
            totalTicketNumbers,
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
    // Add tests for minting
  });

  describe("Reveal Functionality", function () {
    // Add tests for reveal
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
