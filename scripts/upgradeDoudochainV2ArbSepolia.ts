import { ethers, upgrades } from "hardhat";

const DEFAULTS = {
  points: "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E",
  oldRouter: "0x5A59D45437559C7CE0A012630a456321180C21e1",
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  bundle: "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
  refund: "0x8ee19238DAa466B7792BE33569c6E4f6993CCf20",
  redraw: "0xE75461828f41C890fbc811e7cABFe2143B3F4afE",
  reward: "0x680618a6933DD68fF84Ff9F64760120d27400B3C",
  book: "0x4284be399cA9591fBd98248969fCcb969E21B2C6",
  vrfCoordinator: "0x5CE8D5A2BC84beb22a398CCA51996F7930313D61",
  keyHash: "0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be",
  subscriptionId: "106016056432422253373974444299096295296684744368940754254159766683809634643463",
  requestConfirmations: 0,
  callbackGasLimit: 2_500_000,
};

const VRF_COORDINATOR_ABI = [
  "function addConsumer(uint256 subId, address consumer) external",
  "function getSubscription(uint256 subId) external view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
];

async function upgradeProxy(proxyAddress: string, factoryName: string, label: string): Promise<any> {
  const Factory = await ethers.getContractFactory(factoryName);
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory);
  await upgraded.waitForDeployment();
  const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`${label} proxy:`, proxyAddress);
  console.log(`${label} implementation:`, implementation);
  return upgraded;
}

async function grantIfNeeded(contract: any, roleName: string, account: string) {
  const role = await contract[roleName]();
  if (await contract.hasRole(role, account)) {
    console.log(`${roleName} already granted:`, account);
    return;
  }
  const tx = await contract.grantRole(role, account);
  console.log(`${roleName} grant tx:`, tx.hash);
  await tx.wait();
  console.log(`${roleName} granted:`, account);
}

async function setRequesterIfNeeded(router: any, requester: string) {
  if (await router.isRequester(requester)) {
    console.log("Router requester already allowed:", requester);
    return;
  }
  const tx = await router.setRequester(requester, true);
  console.log("Router requester tx:", tx.hash);
  await tx.wait();
  console.log("Router requester allowed:", requester);
}

async function setAddressIfNeeded(label: string, current: string, expected: string, setter: () => Promise<any>) {
  if (current.toLowerCase() === expected.toLowerCase()) {
    console.log(`${label} already set:`, expected);
    return;
  }
  const tx = await setter();
  console.log(`${label} set tx:`, tx.hash);
  await tx.wait();
  console.log(`${label} set:`, expected);
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

async function requireTrue(label: string, value: boolean) {
  if (!value) {
    throw new Error(`Post-upgrade assertion failed: ${label}`);
  }
  console.log("OK:", label);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const addresses = {
    points: process.env.DOUDO_POINTS_ADDRESS || DEFAULTS.points,
    oldRouter: process.env.DOUDO_VRF_ROUTER_ADDRESS || DEFAULTS.oldRouter,
    core: process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core,
    bundle: process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || DEFAULTS.bundle,
    refund: process.env.DOUDO_REFUND_MODULE_PROXY_ADDRESS || DEFAULTS.refund,
    redraw: process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || DEFAULTS.redraw,
    reward: process.env.DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS || DEFAULTS.reward,
    book: process.env.COLLECTION_BOOK_PROXY_ADDRESS || DEFAULTS.book,
  };
  const vrfCoordinator = process.env.VRF_COORDINATOR || DEFAULTS.vrfCoordinator;
  const subscriptionId = process.env.VRF_SUBSCRIPTION_ID || DEFAULTS.subscriptionId;
  const keyHash = process.env.VRF_KEY_HASH || DEFAULTS.keyHash;
  const requestConfirmations = Number(
    process.env.VRF_REQUEST_CONFIRMATIONS || DEFAULTS.requestConfirmations
  );
  const callbackGasLimit = Number(process.env.VRF_CALLBACK_GAS_LIMIT || DEFAULTS.callbackGasLimit);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Upgrader / official ops wallet:", await deployer.getAddress());
  console.log("Existing router:", addresses.oldRouter);

  const core = await upgradeProxy(
    addresses.core,
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    "DOUDOCHAINV2CoreUpgradeable"
  );
  const bundle = await upgradeProxy(
    addresses.bundle,
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable",
    "DoudoBundleModuleUpgradeable"
  );
  const refund = await upgradeProxy(
    addresses.refund,
    "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable",
    "DoudoRefundModuleUpgradeable"
  );
  const redraw = await upgradeProxy(
    addresses.redraw,
    "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable",
    "DoudoRedrawModuleUpgradeable"
  );

  const reward: any = await ethers.getContractAt(
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable",
    addresses.reward
  );
  const book: any = await ethers.getContractAt(
    "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable",
    addresses.book
  );
  const points: any = await ethers.getContractAt("contracts/DDOUDOCOIN.sol:DOUDOCOIN", addresses.points);

  const Router = await ethers.getContractFactory("contracts/DoudoVRFRouter.sol:DoudoVRFRouter");
  const router: any = await Router.deploy(
    vrfCoordinator,
    subscriptionId,
    keyHash,
    requestConfirmations,
    callbackGasLimit
  );
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("New DoudoVRFRouter:", routerAddress);

  await setAddressIfNeeded("Core VRF router", await core.vrfRouter(), routerAddress, () =>
    core.setVrfRouter(routerAddress)
  );
  await setRequesterIfNeeded(router, addresses.core);
  await setRequesterIfNeeded(router, addresses.redraw);

  await grantIfNeeded(core, "MODULE_ROLE", addresses.bundle);
  await grantIfNeeded(core, "MODULE_ROLE", addresses.refund);
  await grantIfNeeded(core, "MODULE_ROLE", addresses.redraw);
  await grantIfNeeded(core, "MODULE_ROLE", addresses.reward);

  await grantIfNeeded(points, "BURNER_ROLE", addresses.core);
  await grantIfNeeded(points, "BURNER_ROLE", addresses.bundle);
  await grantIfNeeded(points, "MINTER_ROLE", addresses.bundle);
  await grantIfNeeded(points, "MINTER_ROLE", addresses.refund);
  await grantIfNeeded(points, "MINTER_ROLE", addresses.reward);
  await grantIfNeeded(points, "MINTER_ROLE", addresses.book);

  await setAddressIfNeeded("Bundle redraw module", await bundle.redrawModule(), addresses.redraw, () =>
    bundle.setRedrawModule(addresses.redraw)
  );
  await setAddressIfNeeded("Redraw bundle module", await redraw.bundleModule(), addresses.bundle, () =>
    redraw.setBundleModule(addresses.bundle)
  );
  await setAddressIfNeeded("Reward collection book", await reward.collectionBook(), addresses.book, () =>
    reward.setCollectionBook(addresses.book)
  );
  await setAddressIfNeeded("Book reward target", await book.doudochainV2RewardTarget(), addresses.reward, () =>
    book.setDoudochainV2RewardTarget(addresses.reward)
  );

  await maybeAddVrfConsumer(vrfCoordinator, subscriptionId, routerAddress);

  await requireTrue("core router updated", (await core.vrfRouter()).toLowerCase() === routerAddress.toLowerCase());
  await requireTrue("router requester core", await router.isRequester(addresses.core));
  await requireTrue("router requester redraw", await router.isRequester(addresses.redraw));
  await requireTrue("core MODULE_ROLE bundle", await core.hasRole(await core.MODULE_ROLE(), addresses.bundle));
  await requireTrue("core MODULE_ROLE refund", await core.hasRole(await core.MODULE_ROLE(), addresses.refund));
  await requireTrue("core MODULE_ROLE redraw", await core.hasRole(await core.MODULE_ROLE(), addresses.redraw));
  await requireTrue("core MODULE_ROLE reward", await core.hasRole(await core.MODULE_ROLE(), addresses.reward));

  console.log("Upgrade complete.");
  console.log("Set DOUDO_VRF_ROUTER_ADDRESS to:", routerAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
