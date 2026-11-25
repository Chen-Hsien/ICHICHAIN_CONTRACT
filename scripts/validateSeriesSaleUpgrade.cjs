const { ethers, upgrades, artifacts } = require("hardhat");
const coupon = require("../deployments/coupon-v2-arbitrum-sepolia.json");

async function main() {
  const provider = ethers.provider;
  if ((await provider.getNetwork()).chainId !== 421614n) {
    throw new Error("This candidate was built against the Arbitrum Sepolia Coupon V2 release");
  }
  const libraries = {};
  for (const [name, record] of Object.entries(coupon.libraries)) {
    if (ethers.keccak256(await provider.getCode(record.address)) !== record.runtimeHash) {
      throw new Error("Library runtime mismatch: " + name);
    }
    libraries[name] = record.address;
  }
  const fixed = coupon.components.Fixed;
  const components = [
    {
      name: "DoudoSeriesOpsModuleUpgradeable",
      proxy: "0x2FF7521dEF3903fc5c6f2877252cdf5019380070",
      implementation: "0x5409aa1Fbdd2e28fb47457F7ee50af1f73dD966D",
      hash: "0x9847b2f037917772ab37a25268fb5ee440e3a70340cbdd7fc65819ed3f8ce82c",
      libraries: {},
    },
    {
      name: "FixedProbabilityLotteryV3Upgradeable",
      proxy: fixed.proxy,
      implementation: fixed.implementation.address,
      hash: fixed.implementation.runtimeHash,
      libraries,
    },
  ];
  for (const c of components) {
    const implementation = await upgrades.erc1967.getImplementationAddress(c.proxy);
    if (implementation.toLowerCase() !== c.implementation.toLowerCase() ||
        ethers.keccak256(await provider.getCode(implementation)) !== c.hash) {
      throw new Error(c.name + " baseline has changed");
    }
    const artifact = await artifacts.readArtifact(c.name);
    const bytes = (artifact.deployedBytecode.length - 2) / 2;
    if (bytes > 24576) throw new Error(c.name + " exceeds EIP-170");
    // A provider-only factory permits this validation without a signing key.
    const factory = await ethers.getContractFactory(c.name, { libraries: c.libraries });
    await upgrades.validateUpgrade(c.proxy, factory, {
      kind: "uups",
      unsafeAllowLinkedLibraries: c.name === "FixedProbabilityLotteryV3Upgradeable",
    });
    console.log(c.name, c.proxy, "storage layout validated;", bytes, "bytes");
  }
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
