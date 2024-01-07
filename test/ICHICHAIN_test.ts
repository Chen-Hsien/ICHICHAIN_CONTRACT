import { expect } from "chai";
import { ethers } from "hardhat";
import { ethers as realEthers } from "ethers";
import { Contract, Signer } from "ethers";

describe("ICHICHAIN", function () {
  let ICHICHAIN: Contract;
  let ichiChain: Contract;
  let owner: Signer;
  let addr1: Signer;
  let addr2: Signer;
  let addrs: Signer[];

  beforeEach(async function () {
    // This is executed before each test
    // Deploying the smart contract
    const ICHICHAINFactory = await ethers.getContractFactory("ICHICHAIN");
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    ichiChain = await ICHICHAINFactory.deploy(/* Constructor arguments */);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await ichiChain.owner()).to.equal(await owner.getAddress());
    });

    // Add more tests here for each function
  });

  describe("createSeries", function () {
    it("Should create a new series correctly", async function () {
      await ichiChain.createSeries("Series 1", 100, ethers.parseEther("0.1"), /* other args */);
      const series = await ichiChain.ICHISeries(0);
      expect(series.seriesName).to.equal("Series 1");
      // Add more assertions as needed
    });
  
    // Test for failure scenarios, such as creating a series with invalid parameters
  });
  

  describe("mint", function () {
    it("Should mint tokens correctly", async function () {
      // Assuming a series is already created
      await ichiChain.createSeries(/* args */);
      await ichiChain.mint(0, 5, { value: ethers.parseEther("0.5") });
  
      expect(await ichiChain.balanceOf(await owner.getAddress())).to.equal(5);
      // Additional assertions
    });
  
    it("Should fail if not enough ETH is sent", async function () {
      await ichiChain.createSeries(/* args */);
      await expect(ichiChain.mint(0, 5, { value: ethers.parseEther("0.1") }))
        .to.be.revertedWith("Insufficient funds sent");
    });
  
    // Other scenarios: minting more than available, minting from a non-existent series, etc.
  });

  describe("AdminMint", function () {
    it("Should allow admin to mint tokens without payment", async function () {
      await ichiChain.createSeries(/* args */);
      await ichiChain.AdminMint(await addr1.getAddress(), 0, 5);
  
      expect(await ichiChain.balanceOf(await addr1.getAddress())).to.equal(5);
      // Additional assertions
    });
  
    // Test for failure scenarios, such as non-owner trying to mint, or minting more than available
  });

  describe("reveal", function () {
    it("Should reveal tokens correctly", async function () {
      // Setup: Create series, mint tokens, etc.
      // Call reveal function
      // Check if tokens are revealed correctly
    });
  
    // Test for failure scenarios, such as revealing before the reveal time, revealing non-existent tokens, etc.
  });

  describe("AdminMint", function () {
    it("Should allow admin to mint tokens without payment", async function () {
      await ichiChain.createSeries(/* args */);
      await ichiChain.AdminMint(await addr1.getAddress(), 0, 5);
  
      expect(await ichiChain.balanceOf(await addr1.getAddress())).to.equal(5);
      // Additional assertions
    });
  
    // Test for failure scenarios, such as non-owner trying to mint, or minting more than available
  });
  
  // Additional describe blocks for other functions like AdminMint, reveal, etc.
});
