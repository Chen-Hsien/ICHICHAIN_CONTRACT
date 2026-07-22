import { ethers } from "hardhat";

const DOUDO_POINTS_ADDRESS =
  process.env.DOUDO_POINTS_ADDRESS || "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";
const REASON = ethers.id("PURCHASE");

const recipients = [
  {
    wallet: "0x673c5C07DBF7CFF8004851faec26031f37F77864",
    amount: "100000",
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const deployerAddress = await deployer.getAddress();
  const points = await ethers.getContractAt(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN",
    DOUDO_POINTS_ADDRESS
  );
  const minterRole = await points.MINTER_ROLE();
  const hasMinterRole = await points.hasRole(minterRole, deployerAddress);
  const decimals = await points.decimals();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("DOUDOCOIN:", DOUDO_POINTS_ADDRESS);
  console.log("Deployer:", deployerAddress);
  console.log("Has MINTER_ROLE:", hasMinterRole);
  console.log("Decimals:", decimals.toString());
  console.log("Reason:", REASON);

  if (!hasMinterRole) {
    throw new Error(`Deployer ${deployerAddress} does not have MINTER_ROLE`);
  }

  for (const recipient of recipients) {
    if (!ethers.isAddress(recipient.wallet)) {
      throw new Error(`Invalid recipient: ${recipient.wallet}`);
    }

    const amountWei = ethers.parseUnits(recipient.amount, decimals);
    const before = await points.balanceOf(recipient.wallet);

    await points.mintWithReason.staticCall(recipient.wallet, amountWei, REASON);
    const estimatedGas = await points.mintWithReason.estimateGas(
      recipient.wallet,
      amountWei,
      REASON
    );

    console.log("Recipient:", recipient.wallet);
    console.log("Mint amount:", recipient.amount);
    console.log("Amount wei:", amountWei.toString());
    console.log("Balance before:", ethers.formatUnits(before, decimals));
    console.log("Estimated gas:", estimatedGas.toString());

    const tx = await points.mintWithReason(recipient.wallet, amountWei, REASON);
    console.log("Mint tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("Block:", receipt?.blockNumber);
    console.log("Gas used:", receipt?.gasUsed.toString());

    const after = await points.balanceOf(recipient.wallet);
    console.log("Balance after:", ethers.formatUnits(after, decimals));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
