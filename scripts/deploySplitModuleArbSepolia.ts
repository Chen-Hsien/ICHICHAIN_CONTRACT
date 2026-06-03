import { ethers, upgrades } from "hardhat";

const DEFAULT_DOUDO_POINTS_ADDRESS = "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";
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

async function deployProxy(factoryName: string, args: unknown[], label: string) {
  const Factory = await ethers.getContractFactory(factoryName);
  const contract = await upgrades.deployProxy(Factory, args, {
    initializer: "initialize",
    kind: "uups",
  });
  await contract.waitForDeployment();
  const proxy = await contract.getAddress();
  const implementation = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log(`${label} proxy:`, proxy);
  console.log(`${label} implementation:`, implementation);
  return { contract, proxy, implementation };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();
  const isLocal = network.chainId === 31337n;

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Deployer / official ops wallet:", deployerAddress);

  let pointsAddress = process.env.DOUDO_POINTS_ADDRESS || DEFAULT_DOUDO_POINTS_ADDRESS;
  if ((process.env.DEPLOY_NEW_DOUDOCOIN || "false").toLowerCase() === "true" || (isLocal && !process.env.DOUDO_POINTS_ADDRESS)) {
    const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const points = await Points.deploy(deployerAddress, deployerAddress);
    await points.waitForDeployment();
    pointsAddress = await points.getAddress();
    console.log("DOUDOCOIN deployed:", pointsAddress);
  } else {
    console.log("DOUDOCOIN reused:", pointsAddress);
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
  const requestConfirmations = Number(process.env.VRF_REQUEST_CONFIRMATIONS || DEFAULT_REQUEST_CONFIRMATIONS);
  const callbackGasLimit = Number(process.env.VRF_CALLBACK_GAS_LIMIT || DEFAULT_CALLBACK_GAS_LIMIT);

  const Router = await ethers.getContractFactory("contracts/DoudoVRFRouter.sol:DoudoVRFRouter");
  const router = await Router.deploy(
    vrfCoordinator,
    subscriptionId,
    keyHash,
    requestConfirmations,
    callbackGasLimit
  );
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("DoudoVRFRouter:", routerAddress);

  const coreDeployment = await deployProxy(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    [pointsAddress, routerAddress],
    "DOUDOCHAINV2CoreUpgradeable"
  );
  const bundleDeployment = await deployProxy(
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable",
    [coreDeployment.proxy, pointsAddress],
    "DoudoBundleModuleUpgradeable"
  );
  const refundDeployment = await deployProxy(
    "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable",
    [coreDeployment.proxy, pointsAddress],
    "DoudoRefundModuleUpgradeable"
  );
  const redrawDeployment = await deployProxy(
    "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable",
    [coreDeployment.proxy, routerAddress],
    "DoudoRedrawModuleUpgradeable"
  );
  const rewardDeployment = await deployProxy(
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable",
    [coreDeployment.proxy, pointsAddress],
    "DoudoCollectionRewardModuleUpgradeable"
  );
  const bookDeployment = await deployProxy(
    "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable",
    [pointsAddress],
    "CollectionBookUpgradeable"
  );

  const points = await ethers.getContractAt("contracts/DDOUDOCOIN.sol:DOUDOCOIN", pointsAddress);
  const core = coreDeployment.contract;
  const bundle = bundleDeployment.contract;
  const redraw = redrawDeployment.contract;
  const reward = rewardDeployment.contract;
  const book = bookDeployment.contract;

  await grantIfNeeded(core, "MODULE_ROLE", bundleDeployment.proxy);
  await grantIfNeeded(core, "MODULE_ROLE", refundDeployment.proxy);
  await grantIfNeeded(core, "MODULE_ROLE", redrawDeployment.proxy);
  await grantIfNeeded(core, "MODULE_ROLE", rewardDeployment.proxy);
  await grantIfNeeded(core, "VRF_ROUTER_ROLE", routerAddress);
  await setRequesterIfNeeded(router, coreDeployment.proxy);
  await setRequesterIfNeeded(router, redrawDeployment.proxy);

  await grantIfNeeded(points, "BURNER_ROLE", coreDeployment.proxy);
  await grantIfNeeded(points, "BURNER_ROLE", bundleDeployment.proxy);
  await grantIfNeeded(points, "MINTER_ROLE", bundleDeployment.proxy);
  await grantIfNeeded(points, "MINTER_ROLE", refundDeployment.proxy);
  await grantIfNeeded(points, "MINTER_ROLE", rewardDeployment.proxy);
  await grantIfNeeded(points, "MINTER_ROLE", bookDeployment.proxy);

  let tx = await bundle.setRedrawModule(redrawDeployment.proxy);
  console.log("Bundle redraw module tx:", tx.hash);
  await tx.wait();
  tx = await redraw.setBundleModule(bundleDeployment.proxy);
  console.log("Redraw bundle module tx:", tx.hash);
  await tx.wait();
  tx = await reward.setCollectionBook(bookDeployment.proxy);
  console.log("Reward collection book tx:", tx.hash);
  await tx.wait();
  tx = await book.setDoudochainV2RewardTarget(rewardDeployment.proxy);
  console.log("CollectionBook reward target tx:", tx.hash);
  await tx.wait();

  await maybeAddVrfConsumer(vrfCoordinator, subscriptionId, routerAddress);

  const result = {
    network: network.chainId.toString(),
    officialOpsWallet: deployerAddress,
    doudoPoints: pointsAddress,
    doudoVRFRouter: routerAddress,
    doudochainV2CoreProxy: coreDeployment.proxy,
    doudochainV2CoreImplementation: coreDeployment.implementation,
    bundleModuleProxy: bundleDeployment.proxy,
    bundleModuleImplementation: bundleDeployment.implementation,
    refundModuleProxy: refundDeployment.proxy,
    refundModuleImplementation: refundDeployment.implementation,
    redrawModuleProxy: redrawDeployment.proxy,
    redrawModuleImplementation: redrawDeployment.implementation,
    collectionRewardModuleProxy: rewardDeployment.proxy,
    collectionRewardModuleImplementation: rewardDeployment.implementation,
    collectionBookProxy: bookDeployment.proxy,
    collectionBookImplementation: bookDeployment.implementation,
    abiPaths: {
      doudoPoints: "artifacts/contracts/DDOUDOCOIN.sol/DOUDOCOIN.json",
      doudoVRFRouter: "artifacts/contracts/DoudoVRFRouter.sol/DoudoVRFRouter.json",
      core: "artifacts/contracts/DOUDOCHAINV2CoreUpgradeable.sol/DOUDOCHAINV2CoreUpgradeable.json",
      bundleModule: "artifacts/contracts/modules/DoudoBundleModuleUpgradeable.sol/DoudoBundleModuleUpgradeable.json",
      refundModule: "artifacts/contracts/modules/DoudoRefundModuleUpgradeable.sol/DoudoRefundModuleUpgradeable.json",
      redrawModule: "artifacts/contracts/modules/DoudoRedrawModuleUpgradeable.sol/DoudoRedrawModuleUpgradeable.json",
      collectionRewardModule: "artifacts/contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol/DoudoCollectionRewardModuleUpgradeable.json",
      collectionBook: "artifacts/contracts/CollectionBookUpgradeable.sol/CollectionBookUpgradeable.json",
    },
  };

  console.log("SPLIT_MODULE_DEPLOYMENT_JSON_START");
  console.log(JSON.stringify(result, null, 2));
  console.log("SPLIT_MODULE_DEPLOYMENT_JSON_END");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
