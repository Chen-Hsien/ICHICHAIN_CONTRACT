import { ethers } from "hardhat";

const seriesData = [
  {
    seriesName: "test0",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://example.com/exchangeTokenURI",
    unrevealTokenURI: "https://example.com/unrevealTokenURI",
    revealTokenURI: "https://example.com/revealTokenURI",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmbxmdqyBudsZdt8ftVnyKivvwsFkf9xkgB2JHYm4tw346",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 3 },
      { name: "D", remainingQuantity: 3 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "test1",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://example.com/exchangeTokenURI1",
    unrevealTokenURI: "https://example.com/unrevealTokenURI1",
    revealTokenURI: "https://example.com/revealTokenURI1",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmdLx9BGRrDZeXPhTgoW4Fq78ZzfwrZPKwMa9rDvB9esfo",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 4 },
      { name: "D", remainingQuantity: 4 },
    ],
  },
  // Repeat for other series...
  {
    seriesName: "test2",
    price: ethers.parseEther("0"), // Example price in Ether
    revealTime: Math.floor(Date.now() / 1000), // Current time
    exchangeTokenURI: "https://example.com/exchangeTokenURI",
    unrevealTokenURI: "https://example.com/unrevealTokenURI",
    revealTokenURI: "https://example.com/revealTokenURI",
    seriesMetaDataURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmXETUQDRSPLGPgwtqcUGFdtCXCAmNnrFPsZ1ugjJi29ic",
    prizes: [
      // Assuming Prize is a struct with fields like name and remainingQuantity
      { name: "A", remainingQuantity: 2 },
      { name: "B", remainingQuantity: 2 },
      { name: "C", remainingQuantity: 5 },
      { name: "D", remainingQuantity: 5 },
    ],
  },
];

async function main() {
  // Deploy the contract
  const ICHICHAINFactory = await ethers.getContractFactory("ICHICHAIN");
  const ICHICHAINContract = await ICHICHAINFactory.deploy(
    process.env.LINK_SUBSCRIPTIONS || "",
    process.env.LINK_TOKEN || ""
  );
  await ICHICHAINContract.waitForDeployment();

  console.log("Contract deployed to:", ICHICHAINContract.target);

  // Create each series
  for (const series of seriesData) {
    // Convert Prize[] structure to match your contract's expectations
    const prizes = series.prizes.map(prize => {
      // Adapt this part based on your contract's Prize struct
      return {
        prizeName: prize.name,
        prizeRemainingQuantity: prize.remainingQuantity,
      };
    });

    await ICHICHAINContract.createSeries(
      series.seriesName,
      series.price,
      series.revealTime,
      series.exchangeTokenURI,
      series.unrevealTokenURI,
      series.revealTokenURI,
      series.seriesMetaDataURI,
      prizes
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
