import { ethers, run, upgrades } from "hardhat";
import { CORE_FQN } from "./linkedCoreFactory";

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
  redraw:
    process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS ||
    "0xE75461828f41C890fbc811e7cABFe2143B3F4afE",
  coreRouter:
    process.env.DOUDO_VRF_ROUTER_ADDRESS ||
    "0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5",
  prizeDrawLib:
    process.env.DOUDO_PRIZE_DRAW_LIB_ADDRESS ||
    "0xbC269A4A26726b02DF521708b7a1Eb1949A25291",
  tokenUriLib:
    process.env.DOUDO_TOKEN_URI_LIB_ADDRESS ||
    "0x9Eda0b3b4f2f1E9b47539bcde02baEfeDdEbe25A",
};

const BUNDLE_FQN =
  "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";

async function requireTrue(label: string, value: boolean) {
  if (!value) throw new Error(`Pre/post-upgrade assertion failed: ${label}`);
  console.log("OK:", label);
}

async function verifyImplementation(address: string, contract: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract,
    });
    console.log("Verified:", address);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address);
      return;
    }
    console.warn("Verification failed (upgrade remains complete):", message);
  }
}

async function main() {
  const execute = process.env.EXECUTE_FREE_ORDER_CHALLENGE_UPGRADE === "1";

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(
      `Expected Arbitrum Sepolia ${CHAIN_ID}, got ${network.chainId}`
    );
  }

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("ARB_TESTNET_PK is missing or invalid");
  const signerAddress = await signer.getAddress();
  const signerBalance = await ethers.provider.getBalance(signerAddress);

  const core: any = await ethers.getContractAt(
    CORE_FQN,
    ADDRESSES.core,
    signer
  );
  const bundle: any = await ethers.getContractAt(
    BUNDLE_FQN,
    ADDRESSES.bundle,
    signer
  );
  const router: any = await ethers.getContractAt(
    "contracts/DoudoVRFRouter.sol:DoudoVRFRouter",
    ADDRESSES.coreRouter,
    signer
  );
  const points: any = await ethers.getContractAt(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN",
    ADDRESSES.points,
    signer
  );

  const oldCoreImplementation = await upgrades.erc1967.getImplementationAddress(
    ADDRESSES.core
  );
  const oldBundleImplementation =
    await upgrades.erc1967.getImplementationAddress(ADDRESSES.bundle);
  const pausedBefore = await core.paused();
  const corePointsBefore = await core.doudoPoints();
  const coreRouterBefore = await core.vrfRouter();
  const bundleCoreBefore = await bundle.core();
  const bundlePointsBefore = await bundle.doudoPoints();
  const bundleRedrawBefore = await bundle.redrawModule();
  const freeOrderConfigBefore = await bundle.freeOrderChallengeConfigs(0);
  const freeOrderTriggerPrizeIDsBefore =
    await bundle.getSeriesFreeOrderTriggerPrizeIDs(0);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Execute upgrade:", execute);
  console.log("Signer:", signerAddress);
  console.log("Signer balance:", ethers.formatEther(signerBalance));
  console.log("Core proxy:", ADDRESSES.core);
  console.log("Core old implementation:", oldCoreImplementation);
  console.log("Bundle proxy:", ADDRESSES.bundle);
  console.log("Bundle old implementation:", oldBundleImplementation);
  console.log("Core paused before:", pausedBefore);
  console.log(
    "Core router pending requests:",
    (await router.pendingRequests()).toString()
  );

  await requireTrue(
    "Core signer UPGRADER_ROLE",
    await core.hasRole(await core.UPGRADER_ROLE(), signerAddress)
  );
  await requireTrue(
    "Core signer OPERATION_ROLE",
    await core.hasRole(await core.OPERATION_ROLE(), signerAddress)
  );
  await requireTrue(
    "Bundle signer UPGRADER_ROLE",
    await bundle.hasRole(await bundle.UPGRADER_ROLE(), signerAddress)
  );
  await requireTrue(
    "Core router has no pending request",
    (await router.pendingRequests()) === 0n
  );
  await requireTrue(
    "PrizeDraw library deployed",
    (await ethers.provider.getCode(ADDRESSES.prizeDrawLib)) !== "0x"
  );
  await requireTrue(
    "TokenURI library deployed",
    (await ethers.provider.getCode(ADDRESSES.tokenUriLib)) !== "0x"
  );

  const Core = await ethers.getContractFactory(CORE_FQN, {
    libraries: {
      DoudoPrizeDrawLib: ADDRESSES.prizeDrawLib,
      DoudoTokenURILib: ADDRESSES.tokenUriLib,
    },
  });
  const Bundle = await ethers.getContractFactory(BUNDLE_FQN);
  await upgrades.validateUpgrade(ADDRESSES.core, Core, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await upgrades.validateUpgrade(ADDRESSES.bundle, Bundle, { kind: "uups" });
  console.log("Core and Bundle storage-layout validation: OK");

  if (!execute) {
    console.log(
      "Dry run complete. Set EXECUTE_FREE_ORDER_CHALLENGE_UPGRADE=1 to send transactions."
    );
    return;
  }

  let pausedByScript = false;
  let newCoreImplementation = oldCoreImplementation;
  let newBundleImplementation = oldBundleImplementation;

  try {
    if (!pausedBefore) {
      const pauseTx = await core.pause();
      console.log("Core pause tx:", pauseTx.hash);
      await pauseTx.wait();
      pausedByScript = true;
    }
    await requireTrue(
      "Core router still has no pending request after pause",
      (await router.pendingRequests()) === 0n
    );

    const upgradedCore: any = await upgrades.upgradeProxy(
      ADDRESSES.core,
      Core,
      {
        kind: "uups",
        unsafeAllowLinkedLibraries: true,
      }
    );
    const coreUpgradeTx = upgradedCore.deploymentTransaction();
    if (coreUpgradeTx) console.log("Core upgrade tx:", coreUpgradeTx.hash);
    await upgradedCore.waitForDeployment();
    newCoreImplementation = await upgrades.erc1967.getImplementationAddress(
      ADDRESSES.core
    );
    await requireTrue(
      "Core implementation changed",
      newCoreImplementation.toLowerCase() !==
        oldCoreImplementation.toLowerCase()
    );

    const upgradedBundle: any = await upgrades.upgradeProxy(
      ADDRESSES.bundle,
      Bundle,
      { kind: "uups" }
    );
    const bundleUpgradeTx = upgradedBundle.deploymentTransaction();
    if (bundleUpgradeTx)
      console.log("Bundle upgrade tx:", bundleUpgradeTx.hash);
    await upgradedBundle.waitForDeployment();
    newBundleImplementation = await upgrades.erc1967.getImplementationAddress(
      ADDRESSES.bundle
    );
    await requireTrue(
      "Bundle implementation changed",
      newBundleImplementation.toLowerCase() !==
        oldBundleImplementation.toLowerCase()
    );

    await requireTrue(
      "Core points wiring preserved",
      (await upgradedCore.doudoPoints()).toLowerCase() ===
        corePointsBefore.toLowerCase()
    );
    await requireTrue(
      "Core router wiring preserved",
      (await upgradedCore.vrfRouter()).toLowerCase() ===
        coreRouterBefore.toLowerCase()
    );
    await requireTrue(
      "Bundle core wiring preserved",
      (await upgradedBundle.core()).toLowerCase() ===
        bundleCoreBefore.toLowerCase()
    );
    await requireTrue(
      "Bundle points wiring preserved",
      (await upgradedBundle.doudoPoints()).toLowerCase() ===
        bundlePointsBefore.toLowerCase()
    );
    await requireTrue(
      "Bundle redraw wiring preserved",
      (await upgradedBundle.redrawModule()).toLowerCase() ===
        bundleRedrawBefore.toLowerCase()
    );
    await requireTrue(
      "Bundle still has points MINTER_ROLE",
      await points.hasRole(await points.MINTER_ROLE(), ADDRESSES.bundle)
    );

    const config = await upgradedBundle.freeOrderChallengeConfigs(0);
    await requireTrue(
      "Free-order config storage preserved",
      config.eligibleFirstTicketCount ===
        freeOrderConfigBefore.eligibleFirstTicketCount &&
        config.version === freeOrderConfigBefore.version &&
        config.active === freeOrderConfigBefore.active
    );
    await requireTrue(
      "Free-order trigger list preserved",
      JSON.stringify(
        (await upgradedBundle.getSeriesFreeOrderTriggerPrizeIDs(0)).map(String)
      ) === JSON.stringify(freeOrderTriggerPrizeIDsBefore.map(String))
    );
  } finally {
    if (pausedByScript && (await core.paused())) {
      const unpauseTx = await core.unpause();
      console.log("Core unpause tx:", unpauseTx.hash);
      await unpauseTx.wait();
    }
  }

  console.log("Core new implementation:", newCoreImplementation);
  console.log("Bundle new implementation:", newBundleImplementation);
  console.log("Core paused after:", await core.paused());

  await verifyImplementation(newCoreImplementation, CORE_FQN);
  await verifyImplementation(newBundleImplementation, BUNDLE_FQN);
  console.log("Free-order challenge Core + Bundle Sepolia upgrade complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
