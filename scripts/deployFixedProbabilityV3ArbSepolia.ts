import { ethers } from "hardhat";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROUTER = "0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5";
const MEMBERSHIP = "0x2aBAd03eA3399e03a6c768405F0647f2aAe32B99";
const AUTHORIZATION_SIGNER = "0x56535d9904D7F3F1B462ED97997C8E9CDFB52227";
const OPERATOR = "0x25f7F9577A93d9708234245A50a860eA5845ff0b";
const outputPath = resolve(
  "deployments/fixed-probability-v3-arbitrum-sepolia.json"
);

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 421614n) {
    throw new Error(`Wrong chain: ${network.chainId}`);
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("ARB_TESTNET_PK is not configured");
  const deployerAddress = await deployer.getAddress();
  const router = await ethers.getContractAt(
    [
      "function owner() view returns (address)",
      "function isRequester(address) view returns (bool)",
      "function setRequester(address,bool)",
    ],
    ROUTER,
    deployer
  );
  const membership = await ethers.getContractAt(
    [
      "function hasRole(bytes32,address) view returns (bool)",
      "function grantRole(bytes32,address)",
      "function CONSUMPTION_RECORDER_ROLE() view returns (bytes32)",
    ],
    MEMBERSHIP,
    deployer
  );
  const [routerOwner, recorderRole, isMembershipAdmin] = await Promise.all([
    router.owner(),
    membership.CONSUMPTION_RECORDER_ROLE(),
    membership.hasRole(ethers.ZeroHash, deployerAddress),
  ]);
  const preflight = {
    chainId: network.chainId.toString(),
    deployer: deployerAddress,
    routerOwner,
    canConfigureRouter:
      routerOwner.toLowerCase() === deployerAddress.toLowerCase(),
    canConfigureMembership: isMembershipAdmin,
    execute: process.env.EXECUTE_FIXED_PROBABILITY_V3_DEPLOY === "1",
  };
  console.log(JSON.stringify(preflight, null, 2));
  if (!preflight.execute) return;
  if (!preflight.canConfigureRouter || !preflight.canConfigureMembership) {
    throw new Error("Deployer lacks router or membership administration");
  }

  const factory = await ethers.getContractFactory("FixedProbabilityLotteryV3");
  const lottery = await factory.deploy(
    ROUTER,
    AUTHORIZATION_SIGNER,
    OPERATOR,
    MEMBERSHIP
  );
  const deploymentTx = lottery.deploymentTransaction();
  if (!deploymentTx) throw new Error("Missing deployment transaction");
  const receipt = await deploymentTx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Deployment failed");
  const address = await lottery.getAddress();

  const requesterTx = await router.setRequester(address, true);
  const requesterReceipt = await requesterTx.wait();
  if (requesterReceipt?.status !== 1) throw new Error("Router setup failed");
  const roleTx = await membership.grantRole(recorderRole, address);
  const roleReceipt = await roleTx.wait();
  if (roleReceipt?.status !== 1) throw new Error("Membership setup failed");

  const [runtime, block, requesterEnabled, recorderEnabled, source] =
    await Promise.all([
      ethers.provider.getCode(address),
      ethers.provider.getBlock(receipt.blockNumber),
      router.isRequester(address),
      membership.hasRole(recorderRole, address),
      readFile(resolve("contracts/FixedProbabilityLotteryV3.sol"), "utf8"),
    ]);
  if (!block?.hash || !requesterEnabled || !recorderEnabled) {
    throw new Error("Deployment verification failed");
  }
  const record = {
    chainId: Number(network.chainId),
    address,
    startBlock: receipt.blockNumber,
    transactionHash: deploymentTx.hash,
    blockHash: block.hash,
    runtimeHash: ethers.keccak256(runtime),
    sourceHash: ethers.keccak256(ethers.toUtf8Bytes(source)),
    routerAddress: ROUTER,
    membershipAddress: MEMBERSHIP,
    authorizationSigner: AUTHORIZATION_SIGNER,
    operator: OPERATOR,
    routerRequesterTransactionHash: requesterTx.hash,
    membershipRoleTransactionHash: roleTx.hash,
    protocolVersion: "3",
    sourcePath:
      "contracts/FixedProbabilityLotteryV3.sol:FixedProbabilityLotteryV3",
    compiler: "0.8.20",
    compilerSettings: {
      optimizer: { enabled: true, runs: 0 },
      viaIR: true,
      metadata: { bytecodeHash: "none" },
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
