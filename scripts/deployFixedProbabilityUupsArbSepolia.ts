import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { artifacts, ethers, upgrades } from "hardhat";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deploymentReceipt } from "./lib/deploymentReceipt";

const output = resolve("deployments/fixed-probability-uups-arbitrum-sepolia.json");
const legacy = JSON.parse(readFileSync(resolve("deployments/fixed-probability-v3-arbitrum-sepolia.json"), "utf8"));
const fqn = "contracts/FixedProbabilityLotteryV3Upgradeable.sol:FixedProbabilityLotteryV3Upgradeable";
const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const names = ["FixedProbabilityConfigValidation", "FixedProbabilitySettlement", "FixedProbabilityBuybackValidation"];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== 421614n) throw new Error("Wrong chain");
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Staging deployer unavailable");
  const admin = await deployer.getAddress();
  const buybackAuthorizer = ethers.getAddress(process.env.POINTS_AUTHORIZATION_SIGNER_WALLET_ADDRESS || legacy.authorizationSigner);
  const initializer = [legacy.routerAddress, legacy.authorizationSigner, legacy.operator, legacy.membershipAddress, admin, admin];
  const router = new ethers.Contract(legacy.routerAddress, ["function owner() view returns(address)", "function isRequester(address) view returns(bool)", "function setRequester(address,bool)"], deployer);
  const membership = new ethers.Contract(legacy.membershipAddress, ["function hasRole(bytes32,address) view returns(bool)", "function grantRole(bytes32,address)"], deployer);
  const recorderRole = ethers.id("CONSUMPTION_RECORDER_ROLE");
  const canConfigureRouter = (await router.owner()).toLowerCase() === admin.toLowerCase();
  const canConfigureMembership = await membership.hasRole(ethers.ZeroHash, admin);
  const artifact = await artifacts.readArtifact(fqn);
  const info = await artifacts.getBuildInfo(fqn);
  if (!info || (artifact.deployedBytecode.length - 2) / 2 > 24576) throw new Error("Invalid compiled artifact");
  const handoff = JSON.parse(readFileSync(resolve("deployments/fixed-probability-uups-artifact.json"), "utf8"));
  const abiSha256 = sha(JSON.stringify(artifact.abi, null, 2) + "\n");
  if (handoff.abiSha256 !== abiSha256) throw new Error("ABI handoff mismatch");
  const sourceBundleSha256 = sha(JSON.stringify(info.input));
  const preflight = { chainId: 421614, deployer: admin, initializer, buybackAuthorizer, canConfigureRouter, canConfigureMembership, balanceWei: (await ethers.provider.getBalance(admin)).toString(), abiSha256, sourceBundleSha256, execute: process.env.EXECUTE_FIXED_PROBABILITY_UUPS_DEPLOY === "1" };
  console.log(JSON.stringify(preflight, null, 2));
  if (!preflight.execute) return;
  if (!canConfigureRouter || !canConfigureMembership) throw new Error("Missing staging administration");
  // Persist every submitted transaction before waiting, so an interrupted run resumes it.
  const record: any = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : {
    schemaVersion: "fixed-probability-uups-deployment-v1", chainId: 421614, proxyKind: "uups", protocolVersion: 1,
    legacyAddress: legacy.address, initializer, buybackAuthorizer, abiSha256,
    storageLayoutSha256: handoff.storageLayoutSha256, sourceBundleSha256,
    sourcePath: fqn, sourceHash: ethers.keccak256(ethers.toUtf8Bytes(readFileSync(resolve(artifact.sourceName), "utf8"))),
    compiler: info.solcLongVersion, compilerSettings: info.input.settings,
    libraries: [], transactions: {}, pending: null, status: "deploying",
  };
  if (record.sourceBundleSha256 !== sourceBundleSha256 || JSON.stringify(record.initializer) !== JSON.stringify(initializer) || record.buybackAuthorizer !== buybackAuthorizer) throw new Error("Existing deployment journal does not match this release");
  const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output + ".tmp", JSON.stringify(record, null, 2) + "\n"); renameSync(output + ".tmp", output); };
  const receiptFor = async (hash: string) => {
    return deploymentReceipt(ethers.provider, hash);
  };
  const evidenceFor = async (address: string, hash: string) => {
    const receipt = await receiptFor(hash);
    if (receipt.contractAddress?.toLowerCase() !== address.toLowerCase()) throw new Error("Deployment receipt address mismatch");
    const code = await ethers.provider.getCode(address, receipt.blockNumber);
    if (code === "0x") throw new Error("Deployment runtime missing");
    return { address, transactionHash: hash, startBlock: receipt.blockNumber, blockHash: receipt.blockHash, runtimeHash: ethers.keccak256(code), runtimeBytes: (code.length - 2) / 2 };
  };
  const deployContract = async (name: string, factory: any, args: any[] = []) => {
    if (!record.pending) {
      const contract = await factory.deploy(...args);
      const tx = contract.deploymentTransaction();
      if (!tx) throw new Error("Missing deployment transaction");
      record.pending = { name, address: await contract.getAddress(), hash: tx.hash }; save();
    }
    if (record.pending.name !== name) throw new Error("Unexpected pending deployment stage");
    return evidenceFor(record.pending.address, record.pending.hash);
  };
  save();
  for (const name of names) {
    const previous = record.libraries.find((item: any) => item.name === name);
    if (previous) {
      if (ethers.keccak256(await ethers.provider.getCode(previous.address)) !== previous.runtimeHash) throw new Error("Library runtime changed");
      continue;
    }
    const evidence = await deployContract(name, await ethers.getContractFactory(name));
    record.libraries.push({ name, ...evidence }); record.pending = null; save();
    console.log(`${name}: ${evidence.address}`);
  }
  const libraries = Object.fromEntries(record.libraries.map((item: any) => [item.name, item.address]));
  const factory = await ethers.getContractFactory("FixedProbabilityLotteryV3Upgradeable", { libraries });
  await upgrades.validateImplementation(factory, { kind: "uups", unsafeAllowLinkedLibraries: true });
  if (!record.implementation) {
    if (!record.pending) {
      const tx = await upgrades.deployImplementation(factory, { kind: "uups", unsafeAllowLinkedLibraries: true, getTxResponse: true });
      if (typeof tx === "string") throw new Error("Implementation transaction evidence unavailable");
      record.pending = { name: "implementation", hash: tx.hash, address: ethers.getCreateAddress({ from: tx.from, nonce: tx.nonce }) }; save();
    }
    if (record.pending.name !== "implementation") throw new Error("Unexpected implementation stage");
    record.implementation = await evidenceFor(record.pending.address, record.pending.hash);
    record.pending = null; save();
  }
  if (ethers.keccak256(await ethers.provider.getCode(record.implementation.address)) !== record.implementation.runtimeHash) throw new Error("Implementation runtime changed");
  if (!record.address) {
    const proxyArtifact = require("@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");
    const proxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, deployer);
    const proxy = await deployContract("proxy", proxyFactory, [record.implementation.address, factory.interface.encodeFunctionData("initialize", initializer)]);
    Object.assign(record, proxy); record.pending = null; save();
  }
  const lottery = factory.attach(record.address) as any;
  const configure = async (name: string, send: () => Promise<any>) => {
    if (!record.transactions[name]) { const tx = await send(); record.transactions[name] = tx.hash; save(); }
    await receiptFor(record.transactions[name]);
  };
  if (!await router.isRequester(record.address)) await configure("routerRequester", () => router.setRequester(record.address, true));
  if (!await membership.hasRole(recorderRole, record.address)) await configure("membershipRecorder", () => membership.grantRole(recorderRole, record.address));
  const authorizerRole = await lottery.BUYBACK_AUTHORIZER_ROLE();
  if (!await lottery.hasRole(authorizerRole, buybackAuthorizer)) await configure("buybackAuthorizer", () => lottery.grantRole(authorizerRole, buybackAuthorizer));
  const block = await ethers.provider.getBlock("latest");
  if (!block?.hash) throw new Error("Canonical verification block unavailable");
  const implementationSlot = await ethers.provider.getStorage(record.address, slot, block.number);
  const domain = await lottery.eip712Domain({ blockTag: block.number });
  const checks = {
    proxyRuntime: ethers.keccak256(await ethers.provider.getCode(record.address, block.number)) === record.runtimeHash,
    implementationSlot: ("0x" + implementationSlot.slice(-40)).toLowerCase() === record.implementation.address.toLowerCase(),
    uuid: await lottery.runner.provider.call({ to: record.implementation.address, data: "0x52d1902d", blockTag: block.number }) === slot,
    initializedAdmin: await lottery.hasRole(ethers.ZeroHash, admin),
    upgrader: await lottery.hasRole(await lottery.UPGRADER_ROLE(), admin),
    operator: await lottery.hasRole(await lottery.OPERATOR_ROLE(), legacy.operator),
    authorizationSigner: (await lottery.authorizationSigner()).toLowerCase() === legacy.authorizationSigner.toLowerCase(),
    router: (await lottery.router()).toLowerCase() === legacy.routerAddress.toLowerCase(),
    membership: (await lottery.membershipV2()).toLowerCase() === legacy.membershipAddress.toLowerCase(),
    requester: await router.isRequester(record.address), recorder: await membership.hasRole(recorderRole, record.address),
    buybackAuthorizer: await lottery.hasRole(authorizerRole, buybackAuthorizer),
    mintDomain: domain[1] === "FixedProbabilityLottery" && domain[2] === "3" && domain[3] === 421614n && domain[4].toLowerCase() === record.address.toLowerCase(),
    implementationSize: record.implementation.runtimeBytes <= 24576,
  };
  record.verification = { blockNumber: block.number, blockHash: block.hash, checks };
  if (Object.values(checks).some(value => value !== true)) { save(); throw new Error("Post-deployment checks failed"); }
  await upgrades.forceImport(record.address, factory, { kind: "uups" });
  record.status = "verified"; save();
  console.log(JSON.stringify(record, null, 2));
}
main().catch((error) => {
  const diagnostic = String(error?.shortMessage || error?.message || error?.name || "unknown").replace(/https?:\/\/[^\s]+/g, "[redacted-url]");
  console.error(`Staging UUPS deployment stopped (${error?.code || error?.name || "unknown"}): ${diagnostic}`);
  console.error("Inspect the saved journal before retrying. Credentials are not printed.");
  process.exitCode = 1;
});
