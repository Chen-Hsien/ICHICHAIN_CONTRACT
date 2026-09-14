const fs = require("fs");
const { ethers, artifacts, upgrades } = require("hardhat");
const names = {
  DOUDO_PRIZE_BUYBACK_MODULE: "DoudoPrizeBuybackModuleUpgradeable",
  DOUDOCOIN: "DOUDOCOIN",
  DOUDO_VRF_ROUTER: "DoudoVRFRouter",
  DOUDO_PRIZE_DRAW_LIB: "DoudoPrizeDrawLib",
  DOUDO_TOKEN_URI_LIB: "DoudoTokenURILib",
  DOUDO_CORE: "DOUDOCHAINV2CoreUpgradeable",
  DOUDO_SERIES_OPS_MODULE: "DoudoSeriesOpsModuleUpgradeable",
  DOUDO_BUNDLE_MODULE: "DoudoBundleModuleUpgradeable",
  DOUDO_REFUND_MODULE: "DoudoRefundModuleUpgradeable",
  DOUDO_REDRAW_MODULE: "DoudoRedrawModuleUpgradeable",
  DOUDO_COLLECTION_REWARD_MODULE: "DoudoCollectionRewardModuleUpgradeable",
  DOUDO_COLLECTION_BOOK: "CollectionBookUpgradeable",
  DOUDO_COIN_NFT: "DOUDOCOINNFT",
  DOUDO_MERCHANT_REGISTRY: "MerchantSeriesRegistry",
  DOUDO_MERCHANT_PUBLISHER: "MerchantSeriesPublisher",
  DOUDO_MEMBERSHIP_V2: "DoudoMembershipV2Upgradeable",
};
async function main() {
  const cp = JSON.parse(fs.readFileSync("deployments/arbitrum-one.json"));
  if ((await ethers.provider.getNetwork()).chainId !== 42161n)
    throw Error("Wrong chain");
  const report = {
    chainId: 42161,
    block: await ethers.provider.getBlockNumber(),
    modules: [],
  };
  for (const [key, name] of Object.entries(names)) {
    const proxy = cp.addresses[key];
    if (!proxy) throw Error("Missing address " + key);
    const isProxy = !!cp.implementations[key];
    const impl = isProxy
      ? await upgrades.erc1967.getImplementationAddress(proxy)
      : proxy;
    const artifact = await artifacts.readArtifact(name);
    const info = await artifacts.getBuildInfo(
      artifact.sourceName + ":" + artifact.contractName,
    );
    const evm =
      info.output.contracts[artifact.sourceName][artifact.contractName].evm;
    let deployed = (await ethers.provider.getCode(impl)).slice(2).toLowerCase(),
      target = artifact.deployedBytecode.slice(2).toLowerCase();
    const refs = [
      ...Object.values(evm.deployedBytecode.immutableReferences || {}).flat(),
      ...Object.values(artifact.deployedLinkReferences || {}).flatMap((x) =>
        Object.values(x).flat(),
      ),
    ];
    if (key.endsWith("_LIB")) refs.push({ start: 1, length: 20 });
    for (const { start, length } of refs) {
      deployed =
        deployed.slice(0, start * 2) +
        "0".repeat(length * 2) +
        deployed.slice((start + length) * 2);
      target =
        target.slice(0, start * 2) +
        "0".repeat(length * 2) +
        target.slice((start + length) * 2);
    }
    const row = {
      key,
      name,
      proxy,
      implementation: impl,
      bytes: target.length / 2,
      matchesMain: target === deployed,
    };
    if (isProxy) {
      const factory = await ethers.getContractFactory(
        name,
        key === "DOUDO_CORE"
          ? {
              libraries: {
                DoudoPrizeDrawLib: cp.addresses.DOUDO_PRIZE_DRAW_LIB,
                DoudoTokenURILib: cp.addresses.DOUDO_TOKEN_URI_LIB,
              },
            }
          : {},
      );
      await upgrades.validateUpgrade(proxy, factory, {
        kind: "uups",
        unsafeAllowLinkedLibraries: key === "DOUDO_CORE",
      });
      row.storageLayout = "valid";
      const c = new ethers.Contract(
        proxy,
        ["function hasRole(bytes32,address) view returns(bool)"],
        ethers.provider,
      );
      row.adminCanUpgrade = await c.hasRole(
        ethers.id("UPGRADER_ROLE"),
        cp.admin,
      );
      if (!row.adminCanUpgrade) throw Error("Missing upgrader " + key);
    }
    report.modules.push(row);
    console.log(JSON.stringify(row));
  }
  fs.writeFileSync(
    "deployments/mainnet-module-inventory-20260915-post.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
main().catch((e) => {
  console.error({
    name: e.name,
    message: e.message?.replace(/https?:\/\/[^\s]+/g, "[redacted URL]"),
  });
  process.exitCode = 1;
});
