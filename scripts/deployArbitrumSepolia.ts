import { ethers } from "hardhat";

const SUBSCRIPTION_ID =
  "106016056432422253373974444299096295296684744368940754254159766683809634643463";
const VRF_COORDINATOR = "0x5CE8D5A2BC84beb22a398CCA51996F7930313D61";
const LINK_TOKEN = "0xb1D4538B4571d411F07960EF2838Ce337FE1E80E";
const KEY_HASH =
  "0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be";
const MINIMUM_CONFIRMATIONS = 0;

const VRF_COORDINATOR_ABI = [
  "function addConsumer(uint256 subId, address consumer) external",
  "function getSubscription(uint256 subId) external view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
];

const LINK_TOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function transferAndCall(address to, uint256 value, bytes data) external returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Deployer:", deployerAddress);
  console.log("Deployer ETH balance:", ethers.formatEther(balance));
  console.log("VRF subscription:", SUBSCRIPTION_ID);
  console.log("VRF coordinator:", VRF_COORDINATOR);
  console.log("VRF key hash:", KEY_HASH);
  console.log("Minimum confirmations:", MINIMUM_CONFIRMATIONS);

  const DOUDOCHAINFactory = await ethers.getContractFactory(
    "contracts/DOUDOCHAIN.sol:DOUDOCHAIN"
  );
  const doudochain = await DOUDOCHAINFactory.deploy(
    SUBSCRIPTION_ID,
    VRF_COORDINATOR,
    KEY_HASH,
    MINIMUM_CONFIRMATIONS
  );
  const deployTx = doudochain.deploymentTransaction();

  console.log("Deploy tx:", deployTx?.hash);
  console.log("Deploying DOUDOCHAIN contract...");
  await doudochain.waitForDeployment();

  const contractAddress = await doudochain.getAddress();
  console.log("Contract deployed to:", contractAddress);

  const coordinator = await ethers.getContractAt(
    VRF_COORDINATOR_ABI,
    VRF_COORDINATOR
  );

  try {
    const subscription = await coordinator.getSubscription(SUBSCRIPTION_ID);
    const consumers = subscription[4] as string[];
    const alreadyConsumer = consumers.some(
      (consumer) => consumer.toLowerCase() === contractAddress.toLowerCase()
    );

    console.log("Subscription owner:", subscription[3]);
    console.log("Subscription LINK balance:", ethers.formatUnits(subscription[0], 18));
    console.log("Subscription native balance:", ethers.formatEther(subscription[1]));
    console.log("Existing consumer count:", consumers.length);

    if (!alreadyConsumer) {
      const addConsumerTx = await coordinator.addConsumer(
        SUBSCRIPTION_ID,
        contractAddress
      );
      console.log("Add consumer tx:", addConsumerTx.hash);
      await addConsumerTx.wait();
      console.log("Consumer added:", contractAddress);
    } else {
      console.log("Consumer already added:", contractAddress);
    }
  } catch (error) {
    console.warn("Unable to add/check VRF consumer:", error);
  }

  const linkFundAmount = process.env.ARB_VRF_LINK_FUND_AMOUNT;
  if (linkFundAmount) {
    const link = await ethers.getContractAt(LINK_TOKEN_ABI, LINK_TOKEN);
    const amount = ethers.parseUnits(linkFundAmount, 18);
    const linkBalance = await link.balanceOf(deployerAddress);

    console.log("Deployer LINK balance:", ethers.formatUnits(linkBalance, 18));
    if (linkBalance < amount) {
      throw new Error(
        `Not enough LINK to fund subscription. Need ${linkFundAmount}, have ${ethers.formatUnits(
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
    console.log("Funded subscription LINK:", linkFundAmount);
  } else {
    console.log("Skipping LINK funding; set ARB_VRF_LINK_FUND_AMOUNT to fund.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
