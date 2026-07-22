import { ethers } from "hardhat";

const DOUDO_POINTS_ADDRESS =
  process.env.DOUDO_POINTS_ADDRESS || "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";

const wallets = [
  "0x672f359244dbDAF76AC3454D59B628758458E9fC",
  "0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2",
];

async function main() {
  const network = await ethers.provider.getNetwork();
  const points = await ethers.getContractAt(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN",
    DOUDO_POINTS_ADDRESS
  );
  const decimals = await points.decimals();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("DOUDOCOIN:", DOUDO_POINTS_ADDRESS);
  console.log("Decimals:", decimals.toString());

  for (const wallet of wallets) {
    const balance = await points.balanceOf(wallet);
    console.log("Balance:", wallet, ethers.formatUnits(balance, decimals));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
