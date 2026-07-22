import { run, ethers, upgrades } from "hardhat";

const DEFAULT_DOUDO_POINTS_ADDRESS = "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";
const DEFAULT_VRF_COORDINATOR = "0x5CE8D5A2BC84beb22a398CCA51996F7930313D61";
const DEFAULT_KEY_HASH =
  "0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be";
const DEFAULT_SUBSCRIPTION_ID =
  "106016056432422253373974444299096295296684744368940754254159766683809634643463";
const DEFAULT_REQUEST_CONFIRMATIONS = 3;
const DEFAULT_CALLBACK_GAS_LIMIT = 2_500_000;

async function verify(address: string, constructorArguments: unknown[] = [], contract?: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments,
      contract,
    });
    console.log("Verified:", address, contract || "");
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address, contract || "");
      return;
    }
    console.warn("Verify failed:", address, contract || "", message);
  }
}

async function verifyProxy(proxyAddress: string, label: string) {
  const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`${label} implementation:`, implementation);
  await verify(implementation);
  await verify(proxyAddress);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  const pointsAddress = process.env.DOUDO_POINTS_ADDRESS || DEFAULT_DOUDO_POINTS_ADDRESS;
  const routerAddress = process.env.DOUDO_VRF_ROUTER_ADDRESS || "";
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "";
  const seriesOpsProxy = process.env.DOUDO_SERIES_OPS_MODULE_PROXY_ADDRESS || "";
  const bundleProxy = process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || "";
  const refundProxy = process.env.DOUDO_REFUND_MODULE_PROXY_ADDRESS || "";
  const redrawProxy = process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || "";
  const rewardProxy = process.env.DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS || "";
  const bookProxy = process.env.COLLECTION_BOOK_PROXY_ADDRESS || "";

  if (!routerAddress || !coreProxy || !seriesOpsProxy || !bundleProxy || !refundProxy || !redrawProxy || !rewardProxy || !bookProxy) {
    throw new Error(
      "Set DOUDO_VRF_ROUTER_ADDRESS, DOUDOCHAIN_CORE_PROXY_ADDRESS, DOUDO_SERIES_OPS_MODULE_PROXY_ADDRESS, DOUDO_BUNDLE_MODULE_PROXY_ADDRESS, DOUDO_REFUND_MODULE_PROXY_ADDRESS, DOUDO_REDRAW_MODULE_PROXY_ADDRESS, DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS, COLLECTION_BOOK_PROXY_ADDRESS"
    );
  }

  if ((process.env.VERIFY_DOUDOCOIN || "false").toLowerCase() === "true") {
    await verify(
      pointsAddress,
      [
        process.env.DOUDOCOIN_DEFAULT_ADMIN || deployerAddress,
        process.env.DOUDOCOIN_MINTER || deployerAddress,
      ],
      "contracts/DDOUDOCOIN.sol:DOUDOCOIN"
    );
  }

  await verify(
    routerAddress,
    [
      process.env.VRF_COORDINATOR || DEFAULT_VRF_COORDINATOR,
      process.env.VRF_SUBSCRIPTION_ID || DEFAULT_SUBSCRIPTION_ID,
      process.env.VRF_KEY_HASH || DEFAULT_KEY_HASH,
      Number(process.env.VRF_REQUEST_CONFIRMATIONS || DEFAULT_REQUEST_CONFIRMATIONS),
      Number(process.env.VRF_CALLBACK_GAS_LIMIT || DEFAULT_CALLBACK_GAS_LIMIT),
    ],
    "contracts/DoudoVRFRouter.sol:DoudoVRFRouter"
  );

  await verifyProxy(coreProxy, "DOUDOCHAINV2CoreUpgradeable");
  await verifyProxy(seriesOpsProxy, "DoudoSeriesOpsModuleUpgradeable");
  await verifyProxy(bundleProxy, "DoudoBundleModuleUpgradeable");
  await verifyProxy(refundProxy, "DoudoRefundModuleUpgradeable");
  await verifyProxy(redrawProxy, "DoudoRedrawModuleUpgradeable");
  await verifyProxy(rewardProxy, "DoudoCollectionRewardModuleUpgradeable");
  await verifyProxy(bookProxy, "CollectionBookUpgradeable");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
