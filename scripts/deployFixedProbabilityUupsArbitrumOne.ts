import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { artifacts, ethers, network, upgrades } from "hardhat";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deploymentReceipt } from "./lib/deploymentReceipt";

const reference = JSON.parse(readFileSync(resolve("deployments/arbitrum-one.json"), "utf8"));
const isFork = network.name === "arbitrumOneFork" && process.env.MAINNET_FORK_REHEARSAL === "1";
if (process.env.MAINNET_FORK_REHEARSAL === "1" && !isFork) throw new Error("Fork rehearsal requires arbitrumOneFork");
if (!isFork && network.name !== "arbitrumOne") throw new Error("Mainnet deployment requires arbitrumOne");
const mainnetOutput = resolve("deployments/fixed-probability-uups-arbitrum-one.json");
const output = isFork ? resolve(process.env.MAINNET_FORK_JOURNAL || "") : mainnetOutput;
if (isFork && (!process.env.MAINNET_FORK_JOURNAL || output === mainnetOutput)) throw new Error("Fork rehearsal requires a separate journal");
const target = {
  routerAddress: ethers.getAddress(reference.addresses.DOUDO_VRF_ROUTER),
  membershipAddress: ethers.getAddress(reference.addresses.DOUDO_MEMBERSHIP_V2),
  authorizationSigner: ethers.getAddress(reference.databasePointsCutover.pointsAuthorizationSigner),
  operator: ethers.getAddress(reference.operation),
};
const expectedAdmin = ethers.getAddress(reference.admin);
const fqn = "contracts/FixedProbabilityLotteryV3Upgradeable.sol:FixedProbabilityLotteryV3Upgradeable";
const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const names = ["FixedProbabilityConfigValidation", "FixedProbabilitySettlement", "FixedProbabilityBuybackValidation"];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== 42161n) throw new Error("Wrong chain");
  if (reference.chainId !== "42161") throw new Error("Reference deployment chain mismatch");
  if (isFork) {
    if (!("url" in network.config) || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(network.config.url).hostname)) throw new Error("Fork RPC must be local");
    const client = await ethers.provider.send("web3_clientVersion", []);
    if (!String(client).toLowerCase().includes("anvil")) throw new Error("Fork rehearsal requires an Anvil node");
    await ethers.provider.send("anvil_impersonateAccount", [expectedAdmin]);
    await ethers.provider.send("anvil_setBalance", [expectedAdmin, ethers.toQuantity(ethers.parseEther("10"))]);
  }
  const deployer = isFork ? await ethers.getSigner(expectedAdmin) : (await ethers.getSigners())[0];
  if (!deployer) throw new Error("Mainnet deployer unavailable");
  const admin = await deployer.getAddress();
  if (admin !== expectedAdmin) throw new Error("Mainnet deployer does not match recorded administrator");
  const buybackAuthorizer = ethers.getAddress(target.authorizationSigner);
  const initializer = [target.routerAddress, target.authorizationSigner, target.operator, target.membershipAddress, admin, admin];
  const router = new ethers.Contract(target.routerAddress, ["function owner() view returns(address)", "function isRequester(address) view returns(bool)", "function setRequester(address,bool)"], deployer);
  const membership = new ethers.Contract(target.membershipAddress, ["function hasRole(bytes32,address) view returns(bool)", "function grantRole(bytes32,address)"], deployer);
  const recorderRole = ethers.id("CONSUMPTION_RECORDER_ROLE");
  const canConfigureRouter = (await router.owner()).toLowerCase() === admin.toLowerCase();
  const canConfigureMembership = await membership.hasRole(ethers.ZeroHash, admin);
  for (const address of [target.routerAddress, target.membershipAddress, reference.addresses.DOUDO_BUNDLE_MODULE]) {
    if (await ethers.provider.getCode(address) === "0x") throw new Error("Reference dependency has no runtime");
  }
  for (const address of [admin, target.operator, target.authorizationSigner]) {
    if (address === ethers.ZeroAddress || await ethers.provider.getCode(address) !== "0x") throw new Error("Expected nonzero EOA role holder");
  }
  if (new Set([admin.toLowerCase(), target.operator.toLowerCase(), target.authorizationSigner.toLowerCase()]).size !== 3) throw new Error("Mainnet administrator, operator and authorization signer must be independent");
  const bundle = new ethers.Contract(reference.addresses.DOUDO_BUNDLE_MODULE, ["function pointsAuthorizationSigner() view returns(address)"], deployer);
  if ((await bundle.pointsAuthorizationSigner()).toLowerCase() !== target.authorizationSigner.toLowerCase()) throw new Error("Recorded authorization signer differs from live mainnet bundle");
  const artifact = await artifacts.readArtifact(fqn);
  const info = await artifacts.getBuildInfo(fqn);
  if (!info || (artifact.deployedBytecode.length - 2) / 2 > 24576) throw new Error("Invalid compiled artifact");
  const handoff = JSON.parse(readFileSync(resolve("deployments/fixed-probability-uups-mainnet-artifact.json"), "utf8"));
  const abiSha256 = sha(JSON.stringify(artifact.abi, null, 2) + "\n");
  if (handoff.abiSha256 !== abiSha256) throw new Error("ABI handoff mismatch");
  const compiled = info.output.contracts[artifact.sourceName][artifact.contractName];
  const storageLayoutSha256 = sha(JSON.stringify((compiled as typeof compiled & { storageLayout: unknown }).storageLayout));
  if (storageLayoutSha256 !== handoff.storageLayoutSha256) throw new Error("Storage layout handoff mismatch");
  const sourceBundleSha256 = sha(JSON.stringify(info.input));
  const preflight = { chainId: 42161, deployer: admin, initializer, buybackAuthorizer, canConfigureRouter, canConfigureMembership, balanceWei: (await ethers.provider.getBalance(admin)).toString(), abiSha256, sourceBundleSha256, simulation: isFork, execute: isFork || process.env.EXECUTE_FIXED_PROBABILITY_MAINNET_DEPLOY === "1" };
  console.log(JSON.stringify(preflight, null, 2));
  if (!preflight.execute) return;
  if (!canConfigureRouter || !canConfigureMembership) throw new Error("Missing mainnet administration");
  // Persist every submitted transaction before waiting, so an interrupted run resumes it.
  const record: any = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : {
    schemaVersion: "fixed-probability-uups-deployment-v1", chainId: 42161, proxyKind: "uups", protocolVersion: 1,
    simulation: isFork, referenceDeployment: "deployments/arbitrum-one.json", initializer, buybackAuthorizer, abiSha256,
    storageLayoutSha256: handoff.storageLayoutSha256, sourceBundleSha256,
    sourcePath: fqn, sourceHash: ethers.keccak256(ethers.toUtf8Bytes(readFileSync(resolve(artifact.sourceName), "utf8"))),
    compiler: info.solcLongVersion, compilerSettings: info.input.settings,
    libraries: [], transactions: {}, pending: null, status: "deploying",
  };
  if (record.chainId !== 42161 || record.simulation !== isFork || record.sourceBundleSha256 !== sourceBundleSha256 || JSON.stringify(record.initializer) !== JSON.stringify(initializer) || record.buybackAuthorizer !== buybackAuthorizer) throw new Error("Existing deployment journal does not match this release");
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
    const evidence = await deployContract(name, await ethers.getContractFactory(name, deployer));
    record.libraries.push({ name, ...evidence }); record.pending = null; save();
    console.log(`${name}: ${evidence.address}`);
  }
  const libraries = Object.fromEntries(record.libraries.map((item: any) => [item.name, item.address]));
  const factory = await ethers.getContractFactory("FixedProbabilityLotteryV3Upgradeable", { libraries, signer: deployer });
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
    operatorNotAdmin: !await lottery.hasRole(ethers.ZeroHash, target.operator),
    authorizerNotAdmin: !await lottery.hasRole(ethers.ZeroHash, buybackAuthorizer),
    operatorNotUpgrader: !await lottery.hasRole(await lottery.UPGRADER_ROLE(), target.operator),
    authorizerNotUpgrader: !await lottery.hasRole(await lottery.UPGRADER_ROLE(), buybackAuthorizer),
    upgrader: await lottery.hasRole(await lottery.UPGRADER_ROLE(), admin),
    operator: await lottery.hasRole(await lottery.OPERATOR_ROLE(), target.operator),
    authorizationSigner: (await lottery.authorizationSigner()).toLowerCase() === target.authorizationSigner.toLowerCase(),
    router: (await lottery.router()).toLowerCase() === target.routerAddress.toLowerCase(),
    membership: (await lottery.membershipV2()).toLowerCase() === target.membershipAddress.toLowerCase(),
    requester: await router.isRequester(record.address), recorder: await membership.hasRole(recorderRole, record.address),
    buybackAuthorizer: await lottery.hasRole(authorizerRole, buybackAuthorizer),
    mintDomain: domain[1] === "FixedProbabilityLottery" && domain[2] === "3" && domain[3] === 42161n && domain[4].toLowerCase() === record.address.toLowerCase(),
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
  console.error(`Mainnet UUPS deployment stopped (${error?.code || error?.name || "unknown"}): ${diagnostic}`);
  console.error("Inspect the saved journal before retrying. Credentials are not printed.");
  process.exitCode = 1;
});
