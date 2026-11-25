const fs = require("node:fs");
const { ethers, upgrades, artifacts } = require("hardhat");
const { deploymentReceipt } = require("./lib/deploymentReceipt");
const coupon = require("../deployments/coupon-v2-arbitrum-sepolia.json");
const output = "deployments/series-sale-arbitrum-sepolia.json";

async function main() {
  const provider = ethers.provider;
  if ((await provider.getNetwork()).chainId !== 421614n)
    throw Error("Arbitrum Sepolia required");
  const [signer] = await ethers.getSigners();
  if (!signer) throw Error("Testnet signer unavailable");
  const fixed = coupon.components.Fixed;
  const libraries = {};
  for (const [name, lib] of Object.entries(coupon.libraries)) {
    if (
      ethers.keccak256(await provider.getCode(lib.address)) !== lib.runtimeHash
    )
      throw Error("Library mismatch: " + name);
    libraries[name] = lib.address;
  }
  const targets = [
    {
      name: "DoudoSeriesOpsModuleUpgradeable",
      proxy: "0x2FF7521dEF3903fc5c6f2877252cdf5019380070",
      previous: "0x5409aa1Fbdd2e28fb47457F7ee50af1f73dD966D",
      previousHash:
        "0x9847b2f037917772ab37a25268fb5ee440e3a70340cbdd7fc65819ed3f8ce82c",
      fields: ["core", "defaultLockDuration"],
    },
    {
      name: "FixedProbabilityLotteryV3Upgradeable",
      proxy: fixed.proxy,
      previous: fixed.implementation.address,
      previousHash: fixed.implementation.runtimeHash,
      fields: [
        "router",
        "membershipV2",
        "authorizationSigner",
        "operator",
        "paused",
      ],
    },
  ];
  const record = fs.existsSync(output)
    ? JSON.parse(fs.readFileSync(output))
    : { chainId: 421614, signer: signer.address, components: {} };
  if (record.chainId !== 421614 || record.signer !== signer.address)
    throw Error("Journal mismatch");
  const save = () => {
    fs.writeFileSync(output + ".tmp", JSON.stringify(record, null, 2) + "\n");
    fs.renameSync(output + ".tmp", output);
  };
  for (const t of targets) {
    const isFixed = t === targets[1];
    t.factory = await ethers.getContractFactory(t.name, {
      signer,
      libraries: isFixed ? libraries : {},
    });
    t.contract = t.factory.attach(t.proxy);
    const current = await upgrades.erc1967.getImplementationAddress(t.proxy);
    if (
      ![t.previous, record.components[t.name]?.implementation].includes(current)
    )
      throw Error(t.name + " unexpected implementation");
    if (ethers.keccak256(await provider.getCode(t.previous)) !== t.previousHash)
      throw Error("Baseline code mismatch");
    if (
      !(await t.contract.hasRole(
        await t.contract.UPGRADER_ROLE(),
        signer.address
      ))
    )
      throw Error(t.name + " missing upgrader role");
    t.options = { kind: "uups", unsafeAllowLinkedLibraries: isFixed };
    await upgrades.validateUpgrade(t.previous, t.factory, t.options);
    const bytes =
      ((await artifacts.readArtifact(t.name)).deployedBytecode.length - 2) / 2;
    if (bytes > 24576) throw Error("EIP-170 size exceeded");
    const state = {};
    for (const field of t.fields)
      state[field] = String(await t.contract[field]());
    const entry = (record.components[t.name] ??= {
      proxy: t.proxy,
      previousImplementation: t.previous,
      bytecodeHash: ethers.keccak256(t.factory.bytecode),
      runtimeBytes: bytes,
      before: state,
    });
    if (
      entry.bytecodeHash !== ethers.keccak256(t.factory.bytecode) ||
      entry.proxy !== t.proxy
    )
      throw Error("Candidate changed");
  }
  if (process.env.EXECUTE_SERIES_SALE_TEST !== "1") {
    console.log("Preflight passed for both proxies. Signer:", signer.address);
    return;
  }
  save();
  for (const t of targets) {
    const entry = record.components[t.name];
    if (!entry.deploymentTx) {
      const impl = await t.factory.deploy();
      entry.deploymentTx = impl.deploymentTransaction().hash;
      entry.implementation = await impl.getAddress();
      save();
    }
    const deployment = await deploymentReceipt(provider, entry.deploymentTx);
    const code = await provider.getCode(entry.implementation);
    if (
      deployment.contractAddress !== entry.implementation ||
      (code.length - 2) / 2 !== entry.runtimeBytes
    )
      throw Error("Deployed implementation mismatch");
    entry.deploymentBlock = deployment.blockNumber;
    entry.deploymentBlockHash = deployment.blockHash;
    entry.runtimeHash = ethers.keccak256(code);
    if (!entry.upgradeTx) {
      if (
        (await upgrades.erc1967.getImplementationAddress(t.proxy)) !==
        t.previous
      )
        throw Error("Proxy changed during deployment");
      await t.contract.upgradeTo.staticCall(entry.implementation);
      const tx = await t.contract.upgradeTo(entry.implementation);
      entry.upgradeTx = tx.hash;
      save();
    }
    const receipt = await deploymentReceipt(provider, entry.upgradeTx);
    const upgraded = t.factory.interface.getEvent("Upgraded").topicHash;
    if (
      !receipt.logs.some(
        (l) =>
          l.address.toLowerCase() === t.proxy.toLowerCase() &&
          l.topics[0] === upgraded &&
          ethers.getAddress("0x" + l.topics[1].slice(-40)) ===
            entry.implementation
      )
    )
      throw Error("Upgraded event missing");
    if (
      (await upgrades.erc1967.getImplementationAddress(t.proxy)) !==
      entry.implementation
    )
      throw Error("Unexpected live implementation");
    for (const field of t.fields)
      if (String(await t.contract[field]()) !== entry.before[field])
        throw Error("Configuration mismatch: " + field);
    await t.contract.saleSchedules(0);
    if (
      t === targets[1] &&
      (await t.contract.couponAuthorizationVersion()) !== 2n
    )
      throw Error("Coupon V2 missing");
    entry.upgradeBlock = receipt.blockNumber;
    entry.upgradeBlockHash = receipt.blockHash;
    save();
    await upgrades.forceImport(t.proxy, t.factory, t.options);
    console.log(
      t.name,
      entry.upgradeTx,
      entry.implementation,
      entry.upgradeBlock
    );
  }
}
main().catch((e) => {
  console.error(
    String(e.shortMessage || e.message).replace(/https?:\S+/g, "[RPC]")
  );
  process.exitCode = 1;
});
