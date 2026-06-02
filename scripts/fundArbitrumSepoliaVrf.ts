import { ethers } from "hardhat";

const SUBSCRIPTION_ID =
  "106016056432422253373974444299096295296684744368940754254159766683809634643463";
const VRF_COORDINATOR = "0x5CE8D5A2BC84beb22a398CCA51996F7930313D61";
const LINK_TOKEN = "0xb1D4538B4571d411F07960EF2838Ce337FE1E80E";

const VRF_COORDINATOR_ABI = [
  "function getSubscription(uint256 subId) external view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
];

const LINK_TOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function transferAndCall(address to, uint256 value, bytes data) external returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const link = await ethers.getContractAt(LINK_TOKEN_ABI, LINK_TOKEN);
  const coordinator = await ethers.getContractAt(
    VRF_COORDINATOR_ABI,
    VRF_COORDINATOR
  );
  const fundAmount = process.env.ARB_VRF_LINK_FUND_AMOUNT || "1";
  const amount = ethers.parseUnits(fundAmount, 18);
  const linkBalance = await link.balanceOf(deployerAddress);
  const beforeSubscription = await coordinator.getSubscription(SUBSCRIPTION_ID);

  console.log("Deployer:", deployerAddress);
  console.log("Deployer LINK balance:", ethers.formatUnits(linkBalance, 18));
  console.log(
    "Subscription LINK balance before:",
    ethers.formatUnits(beforeSubscription[0], 18)
  );
  console.log("Subscription native balance:", ethers.formatEther(beforeSubscription[1]));
  console.log("Subscription owner:", beforeSubscription[3]);
  console.log("Subscription consumers:", beforeSubscription[4]);
  console.log("Funding LINK amount:", fundAmount);

  if (amount === 0n) {
    console.log("Funding skipped because ARB_VRF_LINK_FUND_AMOUNT is 0.");
    return;
  }

  if (linkBalance < amount) {
    throw new Error(
      `Not enough LINK. Need ${fundAmount}, have ${ethers.formatUnits(
        linkBalance,
        18
      )}.`
    );
  }

  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256"],
    [SUBSCRIPTION_ID]
  );
  const fundTx = await link.transferAndCall(VRF_COORDINATOR, amount, data);

  console.log("Fund subscription tx:", fundTx.hash);
  await fundTx.wait();

  const afterSubscription = await coordinator.getSubscription(SUBSCRIPTION_ID);
  console.log(
    "Subscription LINK balance after:",
    ethers.formatUnits(afterSubscription[0], 18)
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
