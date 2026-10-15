const fs = require("fs");
const { ethers } = require("ethers");
const env = require("dotenv").parse(
  fs.readFileSync("/Users/angustsai/doudochain-backend/.env.production"),
);
const p = new ethers.JsonRpcProvider(env.ARBITRUM_ONE_RPC_URL);
const path = "deployments/mainnet-release-20260915.json";
(async () => {
  const r = JSON.parse(fs.readFileSync(path));
  if ((await p.getNetwork()).chainId !== 42161n) throw Error("Wrong chain");
  const manifest = JSON.parse(
    fs.readFileSync(".openzeppelin/arbitrum-one.json"),
  );
  const buyImpl = Object.values(manifest.impls).find(
    (x) => x.address.toLowerCase() === r.buyback.implementation.toLowerCase(),
  );
  if (!buyImpl?.txHash)
    throw Error("Missing Buyback implementation transaction");
  if (!r.transactions.some((t) => t.hash === buyImpl.txHash)) {
    const receipt = await p.getTransactionReceipt(buyImpl.txHash);
    if (receipt?.status !== 1)
      throw Error("Buyback implementation receipt failed");
    r.transactions.push({
      label: "deployImplementation:BUYBACK",
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: String(receipt.gasUsed),
    });
  }
  for (const tx of r.transactions) {
    const receipt = await p.getTransactionReceipt(tx.hash);
    if (receipt?.status !== 1 || receipt.blockNumber !== tx.blockNumber)
      throw Error("Receipt mismatch " + tx.label);
    const block = await p.getBlock(receipt.blockNumber);
    if (block?.hash !== receipt.blockHash) throw Error("Noncanonical receipt");
  }
  const slot = ethers.toBeHex(
    BigInt(ethers.id("eip1967.proxy.implementation")) - 1n,
    32,
  );
  for (const target of [
    ...Object.values(r.implementations),
    { proxy: r.buyback.proxy, next: r.buyback.implementation },
  ]) {
    const raw = await p.getStorage(target.proxy, slot);
    if (("0x" + raw.slice(-40)).toLowerCase() !== target.next.toLowerCase())
      throw Error("Proxy mismatch");
  }
  r.receiptsVerifiedAt = new Date().toISOString();
  fs.writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
  console.log(
    JSON.stringify({
      chainId: 42161,
      verifiedReceipts: r.transactions.length,
      verifiedProxies: 4,
      buyback: r.buyback,
    }),
  );
})()
  .catch((e) => {
    console.error({
      name: e.name,
      message: e.shortMessage || "Verification failed",
    });
    process.exitCode = 1;
  })
  .finally(() => p.destroy());
