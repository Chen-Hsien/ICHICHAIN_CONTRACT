const { ethers, upgrades, artifacts } = require('hardhat');
const fs = require('node:fs');
const { deploymentReceipt } = require('./lib/deploymentReceipt');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const OUTPUT = 'deployments/coupon-v2-arbitrum-sepolia.json';
const NETWORK = 421614n;
const COMPONENTS = {
  Bundle: { proxy: '0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6', name: 'DoudoBundleModuleUpgradeable', fields: ['core', 'doudoPoints', 'redrawModule', 'membershipV2', 'pointsAuthorizationSigner', 'databasePointsRefundModule', 'databasePointsModeEnabled', 'paused'] },
  Fixed: { proxy: '0x51a9f7f467498fee72eFBe37043897A3c225F235', name: 'FixedProbabilityLotteryV3Upgradeable', fields: ['router', 'membershipV2', 'authorizationSigner', 'operator', 'paused'], counters: ['nextSeriesId', 'nextOrderId', 'nextDrawId'] },
};
const LIBRARIES = ['FixedProbabilityConfigValidation', 'FixedProbabilitySettlement', 'FixedProbabilityBuybackValidation'];
const sha = v => createHash('sha256').update(v).digest('hex');
const wire = v => typeof v === 'bigint' ? v.toString() : v;
async function main() {
  if ((await ethers.provider.getNetwork()).chainId !== NETWORK) throw Error('Wrong chain');
  const [signer] = await ethers.getSigners();
  if (!signer) throw Error('ARB_TESTNET_PK missing or malformed');
  const admin = await signer.getAddress();
  const execute = process.env.EXECUTE_COUPON_V2_UPGRADE === '1';
  const legacy = JSON.parse(fs.readFileSync('deployments/fixed-probability-uups-arbitrum-sepolia.json'));
  const legacyLibraries = Object.fromEntries(legacy.libraries.map(l => [l.name, l.address]));
  const inventory = {};
  for (const [key, c] of Object.entries(COMPONENTS)) {
    const artifact = await artifacts.readArtifact(c.name);
    const info = await artifacts.getBuildInfo(`${artifact.sourceName}:${artifact.contractName}`);
    if (!info) throw Error('Build metadata missing');
    inventory[key] = { abiSha256: sha(JSON.stringify(artifact.abi, null, 2) + '\n'), sourceBundleSha256: sha(JSON.stringify(info.input)), runtimeBytes: (artifact.deployedBytecode.length - 2) / 2 };
    if (inventory[key].runtimeBytes > 24576) throw Error('EIP170 limit exceeded');
    const factory = await ethers.getContractFactory(c.name, key === 'Fixed' ? { libraries: legacyLibraries } : {});
    const contract = factory.attach(c.proxy).connect(signer);
    if (!await contract.hasRole(await contract.UPGRADER_ROLE(), admin)) throw Error(`${key}: missing UPGRADER_ROLE`);
    await upgrades.validateUpgrade(c.proxy, factory, { kind: 'uups', ...(key === 'Fixed' ? { unsafeAllowLinkedLibraries: true } : {}) });
  }
  const releaseHash = sha(JSON.stringify(inventory));
  const exists = fs.existsSync(OUTPUT);
  const record = exists ? JSON.parse(fs.readFileSync(OUTPUT)) : { schemaVersion: 'coupon-v2-sepolia-upgrade-v1', chainId: 421614, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), signer: admin, releaseHash, inventory, libraries: {}, components: {}, pending: null, status: 'prepared' };
  if (record.chainId !== 421614 || record.releaseHash !== releaseHash || record.signer !== admin) throw Error('Existing journal identity mismatch');
  const save = () => { fs.writeFileSync(OUTPUT + '.tmp', JSON.stringify(record, null, 2) + '\n'); fs.renameSync(OUTPUT + '.tmp', OUTPUT); };
  const snapshot = async (contract, component) => {
    const out = {};
    for (const field of [...component.fields, ...(component.counters || [])]) out[field] = wire(await contract[field]());
    return out;
  };
  for (const [key, c] of Object.entries(COMPONENTS)) {
    const contract = await ethers.getContractAt(c.name, c.proxy, signer);
    const current = await upgrades.erc1967.getImplementationAddress(c.proxy);
    if (!record.components[key]) record.components[key] = { proxy: c.proxy, previousImplementation: current, before: await snapshot(contract, c) };
    const entry = record.components[key];
    if (![entry.previousImplementation, entry.implementation?.address].filter(Boolean).some(a => a.toLowerCase() === current.toLowerCase())) throw Error(`${key}: unexpected implementation; inspect journal`);
  }
  console.log(JSON.stringify({ chainId: 421614, execute, signer: admin, balanceEth: ethers.formatEther(await ethers.provider.getBalance(admin)), releaseHash, inventory, proxies: Object.fromEntries(Object.entries(record.components).map(([k, v]) => [k, { proxy: v.proxy, previousImplementation: v.previousImplementation }])) }, null, 2));
  if (!execute) return;
  save();
  const receipt = async hash => {
    const r = await deploymentReceipt(ethers.provider, hash);
    if (!r || r.status !== 1) throw Error('Transaction unconfirmed or failed; inspect journal');
    const block = await ethers.provider.getBlock(r.blockNumber);
    if (!block || block.hash !== r.blockHash) throw Error('Non-canonical transaction receipt');
    return r;
  };
  const deployed = async (step, factory) => {
    if (!record.pending) {
      const contract = await factory.deploy();
      const tx = contract.deploymentTransaction();
      if (!tx) throw Error('Deployment response missing');
      record.pending = { step, hash: tx.hash, address: await contract.getAddress() }; save();
    }
    if (record.pending.step !== step) throw Error('Unexpected pending stage');
    const p = record.pending, r = await receipt(p.hash);
    if (r.contractAddress?.toLowerCase() !== p.address.toLowerCase()) throw Error('Deployment receipt address mismatch');
    const code = await ethers.provider.getCode(p.address, r.blockNumber);
    if (code === '0x') throw Error('Deployment runtime missing');
    return { address: p.address, transactionHash: p.hash, blockNumber: r.blockNumber, blockHash: r.blockHash, runtimeHash: ethers.keccak256(code), runtimeBytes: (code.length - 2) / 2 };
  };
  for (const name of LIBRARIES) {
    if (!record.libraries[name]) { record.libraries[name] = await deployed(`library:${name}`, await ethers.getContractFactory(name)); record.pending = null; save(); }
    if (ethers.keccak256(await ethers.provider.getCode(record.libraries[name].address)) !== record.libraries[name].runtimeHash) throw Error('Library runtime changed');
  }
  const libraries = Object.fromEntries(Object.entries(record.libraries).map(([k, v]) => [k, v.address]));
  for (const [key, c] of Object.entries(COMPONENTS)) {
    const factory = await ethers.getContractFactory(c.name, key === 'Fixed' ? { libraries } : {});
    const options = { kind: 'uups', ...(key === 'Fixed' ? { unsafeAllowLinkedLibraries: true } : {}) };
    const entry = record.components[key];
    if (!entry.implementation) { entry.implementation = await deployed(`implementation:${key}`, factory); record.pending = null; save(); }
    if (ethers.keccak256(await ethers.provider.getCode(entry.implementation.address)) !== entry.implementation.runtimeHash) throw Error('Implementation runtime changed');
    const current = await upgrades.erc1967.getImplementationAddress(c.proxy);
    if (current.toLowerCase() !== entry.implementation.address.toLowerCase()) {
      if (current.toLowerCase() !== entry.previousImplementation.toLowerCase()) throw Error('Implementation changed concurrently');
      if (!record.pending) {
        const tx = await factory.attach(c.proxy).connect(signer).upgradeTo(entry.implementation.address);
        record.pending = { step: `upgrade:${key}`, hash: tx.hash }; save();
      }
      if (record.pending.step !== `upgrade:${key}`) throw Error('Unexpected pending upgrade');
      entry.upgradeTransactionHash = record.pending.hash; save();
      await receipt(record.pending.hash);
    }
    if (!entry.upgradeTransactionHash && record.pending?.step === `upgrade:${key}`) entry.upgradeTransactionHash = record.pending.hash;
    if (!entry.upgradeTransactionHash) throw Error('Upgrade receipt evidence missing; inspect journal');
    const r = await receipt(entry.upgradeTransactionHash);
    const event = r.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(l => l?.name === 'Upgraded');
    if (!event || event.args[0].toLowerCase() !== entry.implementation.address.toLowerCase()) throw Error('Upgrade event mismatch');
    const contract = factory.attach(c.proxy);
    if ((await upgrades.erc1967.getImplementationAddress(c.proxy)).toLowerCase() !== entry.implementation.address.toLowerCase() || await contract.couponAuthorizationVersion() !== 2n) throw Error('V2 capability verification failed');
    const after = await snapshot(contract, c);
    for (const field of c.fields) if (after[field] !== entry.before[field]) throw Error(`${key}: wiring/state changed: ${field}`);
    for (const field of c.counters || []) if (BigInt(after[field]) < BigInt(entry.before[field])) throw Error(`${key}: counter decreased`);
    if (!await contract.hasRole(await contract.UPGRADER_ROLE(), admin)) throw Error('Upgrader role changed');
    entry.upgradeBlock = r.blockNumber; entry.upgradeBlockHash = r.blockHash; entry.after = after; entry.verified = true;
    record.pending = null; save();
    await upgrades.forceImport(c.proxy, factory, options);
    console.log(JSON.stringify({ component: key, proxy: c.proxy, implementation: entry.implementation.address, transactionHash: entry.upgradeTransactionHash, block: r.blockNumber, couponAuthorizationVersion: 2, statePreserved: true }));
  }
  record.status = 'verified'; save();
}
main().catch(e => { console.error({ code: e.code || e.name, reason: String(e.shortMessage || e.message || 'Unknown error').replace(/https?:\S+/g, '[redacted-url]') }); process.exitCode = 1; });
