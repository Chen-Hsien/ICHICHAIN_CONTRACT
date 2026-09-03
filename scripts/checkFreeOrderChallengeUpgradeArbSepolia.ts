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
  expectedCoreImplementation: process.env.EXPECTED_CORE_IMPLEMENTATION,
  expectedBundleImplementation: process.env.EXPECTED_BUNDLE_IMPLEMENTATION,
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

async function simulateBundleOperation(
  bundle: any,
  from: string,
  functionName: string,
  args: unknown[]
) {
  await ethers.provider.call({
    from,
    to: await bundle.getAddress(),
    data: bundle.interface.encodeFunctionData(functionName, args),
  });
  console.log("OK: Bundle simulation", functionName);
}

async function main() {
  const backendOperation = process.env.BACKEND_OPERATION_ADDRESS;
  if (!backendOperation || !ethers.isAddress(backendOperation)) {
    throw new Error("BACKEND_OPERATION_ADDRESS must be a valid address");
  }
  const checkSeriesID = BigInt(process.env.FREE_ORDER_CHECK_SERIES_ID || "90");
  const checkPrizeID = BigInt(process.env.FREE_ORDER_CHECK_PRIZE_ID || "6");
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

  if (ADDRESSES.expectedCoreImplementation) {
    await requireTrue(
      "Core implementation slot",
      coreImplementation.toLowerCase() ===
        ADDRESSES.expectedCoreImplementation.toLowerCase()
    );
  }
  if (ADDRESSES.expectedBundleImplementation) {
    await requireTrue(
      "Bundle implementation slot",
      bundleImplementation.toLowerCase() ===
        ADDRESSES.expectedBundleImplementation.toLowerCase()
    );
  }
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
    "Bundle database-points mode",
    await bundle.databasePointsModeEnabled()
  );
  await requireTrue(
    "Bundle legacy points MINTER_ROLE revoked",
    !(await points.hasRole(await points.MINTER_ROLE(), ADDRESSES.bundle))
  );
  await requireTrue(
    "Backend Bundle OPERATION_ROLE",
    await bundle.hasRole(
      await bundle.OPERATION_ROLE(),
      ethers.getAddress(backendOperation)
    )
  );

  await simulateBundleOperation(
    bundle,
    backendOperation,
    "setSeriesRebateTiers",
    [checkSeriesID, []]
  );
  await simulateBundleOperation(
    bundle,
    backendOperation,
    "setSeriesFreeOrderChallenge",
    [checkSeriesID, 30, [checkPrizeID]]
  );

  let openingDiscountSeriesID: bigint | undefined;
  let openingDiscountPrice: bigint | undefined;
  for (let seriesID = 0; seriesID <= Number(checkSeriesID); seriesID++) {
    const config = await core.seriesMintConfig(seriesID);
    const used = await bundle.openingDiscountUsed(seriesID);
    if (config.priceInPoints > 1n && used === 0n) {
      openingDiscountSeriesID = BigInt(seriesID);
      openingDiscountPrice = config.priceInPoints - 1n;
      break;
    }
  }
  await requireTrue(
    "Opening discount simulation series available",
    openingDiscountSeriesID !== undefined && openingDiscountPrice !== undefined
  );
  await simulateBundleOperation(
    bundle,
    backendOperation,
    "setSeriesOpeningDiscount",
    [openingDiscountSeriesID, 1, openingDiscountPrice]
  );

  const remainingQuantity = await core.seriesSubPrizeRemainingQuantity(
    checkSeriesID,
    checkPrizeID
  );
  console.log(
    `Core seriesSubPrizeRemainingQuantity(${checkSeriesID}, ${checkPrizeID}):`,
    remainingQuantity.toString()
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
