import { ethers, upgrades } from "hardhat";

// Redeploys the corrected DOUDOCOINNFT as a UUPS proxy,
// grants it MINTER_ROLE on the soulbound DOUDO points token, and recreates the 14
// voucher types. Run with: npx hardhat run scripts/redeployDoudocoinNftArbSepolia.ts --network arbitrumSepolia
//
// After running, repoint the frontend / off-chain scripts from the old immutable
// DOUDOCOINNFT (0xaABDFbC1E36ed77B0EA0788234276a1348832eEb) to the new address.

// Canonical Arb Sepolia soulbound DOUDO points token (DDOUDOCOIN.sol:DOUDOCOIN)
const DOUDOCOIN = process.env.DOUDO_POINTS_ADDRESS || "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";

// Canonical voucher metadata base (matches the live deployment).
const VOUCHER_URI_BASE =
  "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/";

// amount is the raw token count; the contract scales by 1e18 at redemption.
const VOUCHER_AMOUNTS = [
  10, 50, 100, 250, 500, 1000, 1500, 2000, 2500, 5000, 10000, 15000, 25000,
  30000,
];
const MAX_PER_USER = 99999;

const voucherData = VOUCHER_AMOUNTS.map((amount) => ({
  amount,
  maxPerUser: MAX_PER_USER,
  tokenURI: `${VOUCHER_URI_BASE}${amount}.json`,
}));

const COIN_ABI = [
  "function MINTER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();

  console.log("Network:", network.name, `(chainId ${network.chainId})`);
  console.log("Deployer:", deployerAddress);
  console.log(
    "Deployer ETH balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployerAddress))
  );
  console.log("Reward token (soulbound DOUDO points):", DOUDOCOIN);

  // 1) Deploy the corrected NFT (rewardToken, defaultAdmin, minter).
  const factory = await ethers.getContractFactory("DOUDOCOINNFT");
  const nft = await upgrades.deployProxy(
    factory,
    [DOUDOCOIN, deployerAddress, deployerAddress],
    { initializer: "initialize", kind: "uups" }
  );
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("DOUDOCOINNFT UUPS proxy deployed to:", nftAddress);
  console.log(
    "Implementation:",
    await upgrades.erc1967.getImplementationAddress(nftAddress)
  );

  // 2) Grant the new NFT MINTER_ROLE on the soulbound DOUDO points token.
  const coin = await ethers.getContractAt(COIN_ABI, DOUDOCOIN);
  const minterRole = await coin.MINTER_ROLE();
  if (await coin.hasRole(minterRole, nftAddress)) {
    console.log("NFT already has DOUDOCOIN MINTER_ROLE");
  } else {
    const coinAdminRole = await coin.DEFAULT_ADMIN_ROLE();
    if (!(await coin.hasRole(coinAdminRole, deployerAddress))) {
      console.warn(
        `\n[ACTION REQUIRED] Deployer ${deployerAddress} is not admin of DOUDOCOIN ${DOUDOCOIN}.\n` +
          `Have the token admin run: grantRole(MINTER_ROLE=${minterRole}, ${nftAddress})\n`
      );
    } else {
      const grantTx = await coin.grantRole(minterRole, nftAddress);
      console.log("Grant DOUDOCOIN MINTER_ROLE tx:", grantTx.hash);
      await grantTx.wait();
    }
  }

  // 3) Recreate the voucher types (fresh deploy starts at 0).
  const startId = await nft.nextVoucherTypeId();
  if (startId !== 0n) {
    throw new Error(
      `Expected a fresh deployment (nextVoucherTypeId 0), got ${startId}.`
    );
  }
  for (const [index, voucher] of voucherData.entries()) {
    const tx = await nft.createVoucherType(
      voucher.amount,
      voucher.maxPerUser,
      voucher.tokenURI
    );
    console.log(`createVoucherType[${index}] (amount ${voucher.amount}) tx:`, tx.hash);
    await tx.wait();
  }

  // 4) Post-deploy assertions (fail fast on any wiring mismatch).
  const adminRole = await nft.DEFAULT_ADMIN_ROLE();
  const nftMinterRole = await nft.MINTER_ROLE();
  const checks: [string, boolean][] = [
    [
      "rewardToken == soulbound DOUDOCOIN",
      (await nft.rewardToken()).toLowerCase() === DOUDOCOIN.toLowerCase(),
    ],
    ["voucher types == 14", (await nft.nextVoucherTypeId()) === 14n],
    ["NFT has DOUDOCOIN MINTER_ROLE", await coin.hasRole(minterRole, nftAddress)],
    ["deployer is NFT admin", await nft.hasRole(adminRole, deployerAddress)],
    ["deployer is NFT minter", await nft.hasRole(nftMinterRole, deployerAddress)],
  ];
  for (const [label, ok] of checks) {
    console.log(`${ok ? "OK " : "FAIL"} - ${label}`);
    if (!ok) throw new Error(`Post-deploy assertion failed: ${label}`);
  }

  console.log("\nDone. New DOUDOCOINNFT:", nftAddress);
  console.log(
    "Next: update frontend / scripts referencing the old NFT 0xaABDFbC1E36ed77B0EA0788234276a1348832eEb -> " +
      nftAddress
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
