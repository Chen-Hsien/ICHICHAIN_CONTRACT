import { ethers, upgrades } from "hardhat";

const DEFAULT_VRF_COORDINATOR = "0x5CE8D5A2BC84beb22a398CCA51996F7930313D61";
const DEFAULT_KEY_HASH =
  "0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be";
const DEFAULT_SUBSCRIPTION_ID =
  "106016056432422253373974444299096295296684744368940754254159766683809634643463";
const DEFAULT_REQUEST_CONFIRMATIONS = 0;
const DEFAULT_CALLBACK_GAS_LIMIT = 2_500_000;

const VRF_COORDINATOR_ABI = [
  "function addConsumer(uint256 subId, address consumer) external",
  "function getSubscription(uint256 subId) external view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
];

async function grantIfPossible(contract: any, roleName: string, account: string) {
  try {
    const role = await contract[roleName]();
    if (await contract.hasRole(role, account)) {
      console.log(`${roleName} already granted to:`, account);
      return;
    }
    const tx = await contract.grantRole(role, account);
    console.log(`${roleName} grant tx:`, tx.hash);
    await tx.wait();
    console.log(`${roleName} granted to:`, account);
  } catch (error) {
    console.warn(`Unable to grant ${roleName} to ${account}:`, error);
  }
}

async function maybeAddVrfConsumer(vrfCoordinator: string, subscriptionId: string, consumer: string) {
  if ((await ethers.provider.getNetwork()).chainId === 31337n) {
    console.log("Skipping VRF addConsumer on local Hardhat network.");
    return;
  }

  try {
    const coordinator = await ethers.getContractAt(VRF_COORDINATOR_ABI, vrfCoordinator);
    const subscription = await coordinator.getSubscription(subscriptionId);
    const consumers = subscription[4] as string[];
    const alreadyConsumer = consumers.some(
      (existing) => existing.toLowerCase() === consumer.toLowerCase()
    );

    console.log("VRF subscription owner:", subscription[3]);
    console.log("VRF LINK balance:", ethers.formatUnits(subscription[0], 18));
    console.log("VRF native balance:", ethers.formatEther(subscription[1]));

    if (alreadyConsumer) {
      console.log("VRF consumer already added:", consumer);
      return;
    }

    const tx = await coordinator.addConsumer(subscriptionId, consumer);
    console.log("VRF addConsumer tx:", tx.hash);
    await tx.wait();
    console.log("VRF consumer added:", consumer);
  } catch (error) {
    console.warn("Unable to add/check VRF consumer:", error);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();
  const isLocal = network.chainId === 31337n;

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Deployer / official ops wallet:", deployerAddress);

  let pointsAddress = process.env.DOUDO_POINTS_ADDRESS || "";
  if (!pointsAddress && isLocal) {
    const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const points = await Points.deploy(deployerAddress, deployerAddress);
    await points.waitForDeployment();
    pointsAddress = await points.getAddress();
    console.log("Local DOUDOCOIN deployed:", pointsAddress);
  }
  if (!pointsAddress) {
    throw new Error("Set DOUDO_POINTS_ADDRESS");
  }

  let vrfCoordinator = process.env.VRF_COORDINATOR || DEFAULT_VRF_COORDINATOR;
  if (isLocal) {
    const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
    const vrf = await Vrf.deploy();
    await vrf.waitForDeployment();
    vrfCoordinator = await vrf.getAddress();
    console.log("Local VRF coordinator mock deployed:", vrfCoordinator);
  }

  const subscriptionId = process.env.VRF_SUBSCRIPTION_ID || DEFAULT_SUBSCRIPTION_ID;
  const keyHash = process.env.VRF_KEY_HASH || DEFAULT_KEY_HASH;
  const requestConfirmations = Number(
    process.env.VRF_REQUEST_CONFIRMATIONS || DEFAULT_REQUEST_CONFIRMATIONS
  );
  const callbackGasLimit = Number(process.env.VRF_CALLBACK_GAS_LIMIT || DEFAULT_CALLBACK_GAS_LIMIT);

  const Core = await ethers.getContractFactory(
    "contracts/DOUDOCHAINV2Upgradeable.sol:DOUDOCHAINV2Upgradeable"
  );
  const core = await upgrades.deployProxy(
    Core,
    [pointsAddress, vrfCoordinator, subscriptionId, keyHash, requestConfirmations],
    { initializer: "initialize", kind: "uups" }
  );
  await core.waitForDeployment();

  const coreProxy = await core.getAddress();
  const coreImplementation = await upgrades.erc1967.getImplementationAddress(coreProxy);
  console.log("DOUDOCHAINV2Upgradeable proxy:", coreProxy);
  console.log("DOUDOCHAINV2Upgradeable implementation:", coreImplementation);

  if (callbackGasLimit !== DEFAULT_CALLBACK_GAS_LIMIT) {
    const tx = await core.setVrfConfig(
      vrfCoordinator,
      subscriptionId,
      keyHash,
      callbackGasLimit,
      requestConfirmations
    );
    console.log("VRF callback gas limit update tx:", tx.hash);
    await tx.wait();
  }

  await maybeAddVrfConsumer(vrfCoordinator, subscriptionId, coreProxy);

  const points = await ethers.getContractAt("contracts/DDOUDOCOIN.sol:DOUDOCOIN", pointsAddress);
  await grantIfPossible(points, "BURNER_ROLE", coreProxy);

  if ((process.env.DEPLOY_COLLECTION_BOOK || "true").toLowerCase() !== "false") {
    const Book = await ethers.getContractFactory(
      "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable"
    );
    const book = await upgrades.deployProxy(
      Book,
      [pointsAddress],
      { initializer: "initialize", kind: "uups" }
    );
    await book.waitForDeployment();

    const bookProxy = await book.getAddress();
    const bookImplementation = await upgrades.erc1967.getImplementationAddress(bookProxy);
    console.log("CollectionBookUpgradeable proxy:", bookProxy);
    console.log("CollectionBookUpgradeable implementation:", bookImplementation);

    const setTargetTx = await book.setDoudochainV2RewardTarget(coreProxy);
    console.log("CollectionBook reward target tx:", setTargetTx.hash);
    await setTargetTx.wait();

    await grantIfPossible(core, "COLLECTION_BOOK_ROLE", bookProxy);
    await grantIfPossible(points, "MINTER_ROLE", bookProxy);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
