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
        let vrfCoordinatorV2Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");

        hardhatVrfCoordinatorV2Mock = await vrfCoordinatorV2Mock.deploy(0, 0);
    
        await hardhatVrfCoordinatorV2Mock.createSubscription();
    
        await hardhatVrfCoordinatorV2Mock.fundSubscription(1, ethers.parseEther("10"));
    
        // Deploy the contract
        ichichain = await Ichichain.deploy(1, hardhatVrfCoordinatorV2Mock.target);
    });

    describe("Contract Deployment", function () {
        it("should deploy and initialize the contract", async function () {
            // Test deployment and initial state
            expect(await ichichain.owner()).to.equal(owner.address);
        });
    });

    describe("Series Creation", function () {
        // Add tests for series creation
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
