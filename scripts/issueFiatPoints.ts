import { ethers } from "hardhat";

const DOUDO_POINTS_ADDRESS = process.env.DOUDO_POINTS_ADDRESS || "";
const WALLET = process.env.WALLET || "";
const AMOUNT = process.env.AMOUNT || "";

async function main() {
  if (!DOUDO_POINTS_ADDRESS) {
    throw new Error("Set DOUDO_POINTS_ADDRESS");
  }
  if (!WALLET || !ethers.isAddress(WALLET)) {
    throw new Error("Set WALLET to a valid recipient address");
  }
  if (!AMOUNT) {
    throw new Error("Set AMOUNT, for example AMOUNT=100.0");
  }

  const points = await ethers.getContractAt("contracts/DDOUDOCOIN.sol:DOUDOCOIN", DOUDO_POINTS_ADDRESS);
  const amountWei = ethers.parseEther(AMOUNT);
  const reason = ethers.id("PURCHASE");

  const tx = await points.mintWithReason(WALLET, amountWei, reason);
  console.log("issueFiatPoints tx:", tx.hash);
  await tx.wait();
  console.log("Issued PURCHASE points:", WALLET, amountWei.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
