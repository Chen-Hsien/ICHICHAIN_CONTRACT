import { ethers } from "hardhat";

const DOUDOCHAIN_ADDRESS = "0x3cC5c9Df4359ADC3F9f61bf972F3DD8369D14b91";
const PRICE_FEED_ADDRESS = "0x0000000000000000000000000000000000000000";
const CUSTOMIZED_RATE_TO_USDT_IN_WEI = "20000000000000000";
const DECIMALS = 30;

const DOUDOCHAIN_ABI = [
  "function addCurrencyToken(address currencyToken, address priceFeedAddress, uint256 customizedRateToUSDTinWei, uint8 decimals) external",
  "function currencyList(uint256 index) external view returns (address currencyToken, address priceFeedAddress, uint256 customizedRateToUSDTinWei, uint8 decimals)",
];

async function currencyListLength(doudochain: any) {
  for (let index = 0; index < 100; index++) {
    try {
      await doudochain.currencyList(index);
    } catch {
      return index;
    }
  }

  throw new Error("currencyList length is >= 100; increase scan limit.");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Deployer:", deployerAddress);
  console.log("Deployer ETH balance:", ethers.formatEther(balance));
  console.log("DOUDOCHAIN:", DOUDOCHAIN_ADDRESS);

  const doudocoinFactory = await ethers.getContractFactory(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN"
  );
  const doudocoin = await doudocoinFactory.deploy(
    deployerAddress,
    deployerAddress
  );
  const deployTx = doudocoin.deploymentTransaction();

  console.log("DOUDOCOIN deploy tx:", deployTx?.hash);
  await doudocoin.waitForDeployment();

  const doudocoinAddress = await doudocoin.getAddress();
  console.log("DOUDOCOIN deployed to:", doudocoinAddress);

  const doudochain = await ethers.getContractAt(
    DOUDOCHAIN_ABI,
    DOUDOCHAIN_ADDRESS
  );
  const beforeLength = await currencyListLength(doudochain);

  const addCurrencyTx = await doudochain.addCurrencyToken(
    doudocoinAddress,
    PRICE_FEED_ADDRESS,
    CUSTOMIZED_RATE_TO_USDT_IN_WEI,
    DECIMALS
  );

  console.log("addCurrencyToken tx:", addCurrencyTx.hash);
  await addCurrencyTx.wait();

  const addedIndex = beforeLength;
  const addedCurrency = await doudochain.currencyList(addedIndex);

  console.log("Added currency index:", addedIndex);
  console.log("currencyToken:", addedCurrency[0]);
  console.log("priceFeedAddress:", addedCurrency[1]);
  console.log("customizedRateToUSDTinWei:", addedCurrency[2].toString());
  console.log("decimals:", addedCurrency[3].toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
