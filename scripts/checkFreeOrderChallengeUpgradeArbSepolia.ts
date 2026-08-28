import { ethers, upgrades } from "hardhat";

const CHAIN_ID = 421614n;
const ADDRESSES = {
  core:
    process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS ||
    "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  bundle:
    process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS ||
    "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
  points:
    process.env.DOUDO_POINTS_ADDRESS ||
    "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E",
  coreRouter:
    process.env.DOUDO_VRF_ROUTER_ADDRESS ||
    "0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5",
  expectedCoreImplementation:
    process.env.EXPECTED_CORE_IMPLEMENTATION ||
    "0x0acE3812DBE9BF82908Dae87bA9973f2d2e11500",
  expectedBundleImplementation:
    process.env.EXPECTED_BUNDLE_IMPLEMENTATION ||
    "0x10a2c76fde2053A6234658eA29208b2bDf7C97B6",
};

const CORE_FQN =
  "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";
const BUNDLE_FQN =
  "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";

async function requireTrue(label: string, value: boolean) {
  if (!value) throw new Error(`Post-deploy check failed: ${label}`);
  console.log("OK:", label);
}

async function latestUpgradeTx(proxy: string, currentBlock: number) {
  const logs = await ethers.provider.getLogs({
    address: proxy,
    topics: [ethers.id("Upgraded(address)")],
    fromBlock: Math.max(0, currentBlock - 2_000),
    toBlock: currentBlock,
  });
  return logs.at(-1)?.transactionHash;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(
      `Expected Arbitrum Sepolia ${CHAIN_ID}, got ${network.chainId}`
    );
  }

  const currentBlock = await ethers.provider.getBlockNumber();
  const coreImplementation = await upgrades.erc1967.getImplementationAddress(
    ADDRESSES.core
  );
  const bundleImplementation = await upgrades.erc1967.getImplementationAddress(
    ADDRESSES.bundle
  );
  const core: any = await ethers.getContractAt(CORE_FQN, ADDRESSES.core);
  const bundle: any = await ethers.getContractAt(BUNDLE_FQN, ADDRESSES.bundle);
  const router: any = await ethers.getContractAt(
    "contracts/DoudoVRFRouter.sol:DoudoVRFRouter",
    ADDRESSES.coreRouter
  );
  const points: any = await ethers.getContractAt(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN",
    ADDRESSES.points
  );

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Block:", currentBlock);
  console.log("Core proxy:", ADDRESSES.core);
  console.log("Core implementation:", coreImplementation);
  console.log(
    "Core upgrade tx:",
    await latestUpgradeTx(ADDRESSES.core, currentBlock)
  );
  console.log("Bundle proxy:", ADDRESSES.bundle);
  console.log("Bundle implementation:", bundleImplementation);
  console.log(
    "Bundle upgrade tx:",
    await latestUpgradeTx(ADDRESSES.bundle, currentBlock)
  );

  await requireTrue(
    "Core implementation slot",
    coreImplementation.toLowerCase() ===
      ADDRESSES.expectedCoreImplementation.toLowerCase()
  );
  await requireTrue(
    "Bundle implementation slot",
    bundleImplementation.toLowerCase() ===
      ADDRESSES.expectedBundleImplementation.toLowerCase()
  );
  await requireTrue("Core is unpaused", !(await core.paused()));
  await requireTrue(
    "Core VRF has no pending request",
    (await router.pendingRequests()) === 0n
  );
  await requireTrue(
    "Bundle core wiring",
    (await bundle.core()).toLowerCase() === ADDRESSES.core.toLowerCase()
  );
  await requireTrue(
    "Bundle points wiring",
    (await bundle.doudoPoints()).toLowerCase() ===
      ADDRESSES.points.toLowerCase()
  );
  await requireTrue(
    "Bundle points MINTER_ROLE",
    await points.hasRole(await points.MINTER_ROLE(), ADDRESSES.bundle)
  );

  const seriesMintConfig = await core.seriesMintConfig(0);
  console.log("Core seriesMintConfig(0):", {
    priceInPoints: seriesMintConfig.priceInPoints.toString(),
    useLuckyNumber: seriesMintConfig.useLuckyNumber,
    remainingTicketNumbers: seriesMintConfig.remainingTicketNumbers.toString(),
    totalTicketNumbers: seriesMintConfig.totalTicketNumbers.toString(),
  });
  const challenge = await bundle.freeOrderChallengeConfigs(0);
  const triggerPrizeIDs = await bundle.getSeriesFreeOrderTriggerPrizeIDs(0);
  await requireTrue(
    "Free-order config getter",
    challenge.eligibleFirstTicketCount <= seriesMintConfig.totalTicketNumbers &&
      (challenge.active
        ? challenge.eligibleFirstTicketCount > 0n && triggerPrizeIDs.length > 0
        : triggerPrizeIDs.length === 0)
  );
  console.log("Free-order challenge Sepolia post-deploy checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
