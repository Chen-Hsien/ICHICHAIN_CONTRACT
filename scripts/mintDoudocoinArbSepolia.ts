import { ethers } from "hardhat";

const DOUDOCOIN = "0x032A95BBc436dDE16E7aBcDF01e454fB34743Ea9";
const MINT_AMOUNT = "100000";

const DOUDOCOIN_ABI = [
  "function mint(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const wallet = await signer.getAddress();
  const token = await ethers.getContractAt(DOUDOCOIN_ABI, DOUDOCOIN);
  const decimals = await token.decimals();
  const amount = ethers.parseUnits(MINT_AMOUNT, decimals);
  const before = await token.balanceOf(wallet);

  console.log("Wallet:", wallet);
  console.log("Balance before:", ethers.formatUnits(before, decimals));

  const tx = await token.mint(wallet, amount);
  console.log("Mint tx:", tx.hash);
  await tx.wait();

  const after = await token.balanceOf(wallet);
  console.log("Balance after:", ethers.formatUnits(after, decimals));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
