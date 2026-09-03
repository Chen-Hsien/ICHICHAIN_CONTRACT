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

const requiredAddress = (name: string) => {
  const value = process.env[name];
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return ethers.getAddress(value);
};

async function requireTrue(label: string, value: boolean) {
  if (!value) throw new Error(`Pre/post-repair assertion failed: ${label}`);
  console.log("OK:", label);
}

async function verifyImplementation(address: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract: CORE_FQN,
    });
    console.log("Verified:", address);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address);
      return;
    }
    console.warn("Verification failed (repair remains complete):", message);
  }
}

async function supportsRemainingQuantityGetter(core: any) {
  try {
    await core.seriesSubPrizeRemainingQuantity(0, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const execute = process.env.EXECUTE_FREE_ORDER_CHALLENGE_REPAIR === "1";
  const backendOperation = requiredAddress("BACKEND_OPERATION_ADDRESS");
  const checkSeriesID = BigInt(process.env.FREE_ORDER_CHECK_SERIES_ID || "90");
  const checkPrizeID = BigInt(process.env.FREE_ORDER_CHECK_PRIZE_ID || "6");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(
      `Expected Arbitrum Sepolia ${CHAIN_ID}, got ${network.chainId}`
    );
  }

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("ARB_TESTNET_PK is missing or invalid");
  const signerAddress = await signer.getAddress();
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

  const oldCoreImplementation = await upgrades.erc1967.getImplementationAddress(
    ADDRESSES.core
  );
  const bundleImplementation = await upgrades.erc1967.getImplementationAddress(
    ADDRESSES.bundle
  );
  const getterSupportedBefore = await supportsRemainingQuantityGetter(core);
  const operationRole = await bundle.OPERATION_ROLE();
  const backendHadOperationRole = await bundle.hasRole(
    operationRole,
    backendOperation
  );
  const pausedBefore = await core.paused();
  const corePointsBefore = await core.doudoPoints();
  const coreRouterBefore = await core.vrfRouter();
  const bundleCoreBefore = await bundle.core();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Execute repair:", execute);
  console.log("Signer:", signerAddress);
  console.log("Backend operation signer:", backendOperation);
  console.log("Core proxy:", ADDRESSES.core);
  console.log("Core implementation:", oldCoreImplementation);
  console.log("Core remaining-quantity getter before:", getterSupportedBefore);
  console.log("Bundle proxy:", ADDRESSES.bundle);
  console.log(
    "Bundle implementation (will not be upgraded):",
    bundleImplementation
  );
  console.log("Backend Bundle OPERATION_ROLE before:", backendHadOperationRole);

  await requireTrue(
    "PrizeDraw library deployed",
    (await ethers.provider.getCode(ADDRESSES.prizeDrawLib)) !== "0x"
  );
  await requireTrue(
    "TokenURI library deployed",
    (await ethers.provider.getCode(ADDRESSES.tokenUriLib)) !== "0x"
  );
  await requireTrue(
    "Bundle still uses database points",
    await bundle.databasePointsModeEnabled()
  );
  await requireTrue(
    "Bundle core wiring",
    bundleCoreBefore.toLowerCase() === ADDRESSES.core.toLowerCase()
  );

  const Core = await ethers.getContractFactory(CORE_FQN, {
    libraries: {
      DoudoPrizeDrawLib: ADDRESSES.prizeDrawLib,
      DoudoTokenURILib: ADDRESSES.tokenUriLib,
    },
  });
  await upgrades.validateUpgrade(ADDRESSES.core, Core, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  console.log("Core storage-layout validation: OK");

  if (!getterSupportedBefore) {
    await requireTrue(
      "Core signer UPGRADER_ROLE",
      await core.hasRole(await core.UPGRADER_ROLE(), signerAddress)
    );
    await requireTrue(
      "Core signer OPERATION_ROLE",
      await core.hasRole(await core.OPERATION_ROLE(), signerAddress)
    );
    await requireTrue(
      "Core router has no pending request",
      (await router.pendingRequests()) === 0n
    );
  }
  if (!backendHadOperationRole) {
    await requireTrue(
      "Bundle signer DEFAULT_ADMIN_ROLE",
      await bundle.hasRole(await bundle.DEFAULT_ADMIN_ROLE(), signerAddress)
    );
  }

  if (!execute) {
    console.log(
      "Preflight complete. Set EXECUTE_FREE_ORDER_CHALLENGE_REPAIR=1 to upgrade Core and restore the Bundle operation role."
    );
    return;
  }

  let pausedByScript = false;
  let newCoreImplementation = oldCoreImplementation;
  let coreChanged = false;

  try {
    if (!getterSupportedBefore) {
      if (!pausedBefore) {
        const pauseTx = await core.pause();
        console.log("Core pause tx:", pauseTx.hash);
        await pauseTx.wait();
        pausedByScript = true;
      }

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
      coreChanged =
        newCoreImplementation.toLowerCase() !==
        oldCoreImplementation.toLowerCase();
      await requireTrue("Core implementation changed", coreChanged);
    }

    if (!(await bundle.hasRole(operationRole, backendOperation))) {
      const grantTx = await bundle.grantRole(operationRole, backendOperation);
      console.log("Bundle grant backend OPERATION_ROLE tx:", grantTx.hash);
      await grantTx.wait();
    }
  } finally {
    if (pausedByScript && (await core.paused())) {
      const unpauseTx = await core.unpause();
      console.log("Core unpause tx:", unpauseTx.hash);
      await unpauseTx.wait();
    }
  }

  const repairedCore: any = await ethers.getContractAt(
    CORE_FQN,
    ADDRESSES.core,
    signer
  );
  const remainingQuantity = await repairedCore.seriesSubPrizeRemainingQuantity(
    checkSeriesID,
    checkPrizeID
  );
  await requireTrue("Core remaining-quantity getter", true);
  await requireTrue("Core is unpaused", !(await repairedCore.paused()));
  await requireTrue(
    "Core points wiring preserved",
    (await repairedCore.doudoPoints()).toLowerCase() ===
      corePointsBefore.toLowerCase()
  );
  await requireTrue(
    "Core router wiring preserved",
    (await repairedCore.vrfRouter()).toLowerCase() ===
      coreRouterBefore.toLowerCase()
  );
  await requireTrue(
    "Bundle implementation unchanged",
    (
      await upgrades.erc1967.getImplementationAddress(ADDRESSES.bundle)
    ).toLowerCase() === bundleImplementation.toLowerCase()
  );
  await requireTrue(
    "Backend Bundle OPERATION_ROLE",
    await bundle.hasRole(operationRole, backendOperation)
  );

  console.log(
    `Core seriesSubPrizeRemainingQuantity(${checkSeriesID}, ${checkPrizeID}):`,
    remainingQuantity.toString()
  );
  console.log("Core implementation after:", newCoreImplementation);
  if (coreChanged) await verifyImplementation(newCoreImplementation);
  console.log("Free-order challenge Sepolia repair complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
