// Read-only verification of actual candidate deployments; does not send transactions.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { ethers } = require("hardhat");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const check = (ok, why) => {
  if (!ok) throw Error(why);
};
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
async function main() {
  const release = JSON.parse(
    fs.readFileSync(process.env.PREPARATION_RELEASE_FILE, "utf8")
  );
  const { releaseHash, ...content } = release;
  check(sha(json(content)) === releaseHash, "Release content hash mismatch");
  check(
    release.schemaVersion === "mainnet-series-sale-coupon-v2-preparation-v1" &&
      release.chainId === 42161 &&
      !release.simulation,
    "Real mainnet preparation release required"
  );
  const hashes = JSON.parse(
    fs.readFileSync(process.env.PREPARATION_DEPLOYMENT_RECEIPTS, "utf8")
  );
  const url = new URL(
    process.env.PREPARATION_RPC_URL || "https://arb1.arbitrum.io/rpc"
  );
  check(
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "Mainnet deployment evidence cannot use localhost"
  );
  const provider = new ethers.JsonRpcProvider(url.href, undefined, {
    cacheTimeout: -1,
  });
  check(
    BigInt(await provider.send("eth_chainId", [])) === 42161n,
    "Wrong RPC chain ID"
  );
  check(
    !/anvil|hardhat/i.test(await provider.send("web3_clientVersion", [])),
    "Simulation client forbidden"
  );
  const checked = [];
  for (const planned of release.transactions.filter(
    (t) => t.predictedAddress
  )) {
    const hash = hashes[planned.step];
    check(
      /^0x[0-9a-fA-F]{64}$/.test(hash),
      "Missing deployment hash " + planned.step
    );
    const receipt = await provider.getTransactionReceipt(hash),
      tx = await provider.getTransaction(hash);
    check(
      receipt?.status === 1 && tx && tx.chainId === 42161n,
      "Unsuccessful deployment " + planned.step
    );
    check(
      eq(tx.from, planned.from) &&
        tx.to === null &&
        tx.nonce === planned.nonce &&
        eq(tx.data, planned.data) &&
        tx.value === 0n,
      "Deployment transaction differs from approved plan " + planned.step
    );
    check(
      eq(receipt.contractAddress, planned.predictedAddress),
      "Unexpected deployment address " + planned.step
    );
    const block = await provider.getBlock(receipt.blockNumber);
    check(
      block?.hash === receipt.blockHash,
      "Noncanonical receipt " + planned.step
    );
    check(
      ethers.keccak256(
        await provider.getCode(receipt.contractAddress, receipt.blockNumber)
      ) === planned.expectedRuntimeHash,
      "Runtime hash mismatch at deployment " + planned.step
    );
    check(
      ethers.keccak256(await provider.getCode(receipt.contractAddress)) ===
        planned.expectedRuntimeHash,
      "Current runtime hash mismatch " + planned.step
    );
    checked.push({
      step: planned.step,
      address: receipt.contractAddress,
      transactionHash: hash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      runtimeHash: planned.expectedRuntimeHash,
    });
  }
  const block = await provider.getBlock("latest");
  for (const [key, c] of Object.entries(release.components)) {
    check(
      eq(
        ethers.getAddress(
          "0x" +
            (await provider.getStorage(c.proxy, SLOT, block.number)).slice(-40)
        ),
        c.implementation
      ),
      "Proxy changed before upgrade " + key
    );
    check(
      ethers.keccak256(
        await provider.getCode(c.implementation, block.number)
      ) === c.implementationRuntimeHash,
      "Baseline runtime changed " + key
    );
    const contract = new ethers.Contract(
        c.proxy,
        release.candidate[c.name].abi,
        provider
      ),
      at = { blockTag: block.number };
    check(
      await contract.hasRole(
        ethers.id("UPGRADER_ROLE"),
        release.baseline.admin,
        at
      ),
      "Admin upgrade role changed " + key
    );
    for (const field of c.fields) {
      const current = String(await contract[field](at));
      check(
        key === "Fixed" &&
          ["nextSeriesId", "nextOrderId", "nextDrawId"].includes(field)
          ? BigInt(current) >= BigInt(c.before[field])
          : current === c.before[field],
        "State changed; re-review required " + key + "." + field
      );
    }
  }
  const firstUpgrade = release.transactions.find((t) =>
    t.step.startsWith("upgrade:")
  );
  check(
    (await provider.getTransactionCount(release.baseline.admin, "pending")) ===
      firstUpgrade.nonce,
    "Admin nonce drift before upgrades"
  );
  const evidence = {
    schemaVersion: "mainnet-series-sale-coupon-v2-deployments-verified-v1",
    releaseHash,
    simulation: false,
    readOnly: true,
    mainnetTransactionsSent: 0,
    checkedAtBlock: { number: block.number, hash: block.hash },
    deployments: checked,
    baselineUnchanged: true,
    upgradeCalldata: release.transactions.filter((t) =>
      t.step.startsWith("upgrade:")
    ),
  };
  const out = path.resolve(
    process.env.PREPARATION_VERIFICATION_OUTPUT ||
      "reports/mainnet-series-sale-coupon-v2",
    sha(json(evidence)) + ".deployments-verified.json"
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json(evidence), { flag: "wx", mode: 0o444 });
  console.log(
    json({
      status: "deployments-verified",
      output: out,
      mainnetTransactionsSent: 0,
    })
  );
}
main().catch((e) => {
  console.error(
    String(e.shortMessage || e.message).replace(/https?:\S+/g, "[redacted-rpc]")
  );
  process.exitCode = 1;
});
