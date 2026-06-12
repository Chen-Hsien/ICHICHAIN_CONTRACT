import { ethers } from "hardhat";

// Repoints the deployed DOUDOCOINNFT's rewardToken to the CANONICAL Arb Sepolia
// DOUDOCOIN (0xFFCD…) and grants the NFT MINTER_ROLE on it. The NFT was originally
// deployed pointing at a different DOUDOCOIN deployment (0x032A95…) by mistake.
// Run: npx hardhat run scripts/repointDoudocoinNftRewardTokenArbSepolia.ts --network arbitrumSepolia
//
// Optional: set REVOKE_OLD_MINTER=1 to also revoke the NFT's now-unused MINTER_ROLE
// on the old token (0x032A95…) — only works if the signer is that token's admin.

const NFT = process.env.DOUDOCOIN_NFT_ADDRESS || "0x35d6650973B713193C9D0Ef96E4EbFB61B96B7B7";
const CANONICAL_DOUDOCOIN =
  process.env.DOUDO_POINTS_ADDRESS || "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";
const OLD_DOUDOCOIN = "0x032A95BBc436dDE16E7aBcDF01e454fB34743Ea9";
const REVOKE_OLD = process.env.REVOKE_OLD_MINTER === "1";

const NFT_ABI = [
  "function rewardToken() view returns (address)",
  "function setRewardToken(address) external",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
];
const COIN_ABI = [
  "function MINTER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function grantRole(bytes32,address) external",
  "function revokeRole(bytes32,address) external",
  "function hasRole(bytes32,address) view returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Signer:", me);
  console.log("NFT:", NFT);
  console.log("Canonical DOUDOCOIN:", CANONICAL_DOUDOCOIN);

  const nft = await ethers.getContractAt(NFT_ABI, NFT);
  const coin = await ethers.getContractAt(COIN_ABI, CANONICAL_DOUDOCOIN);
  const minterRole = await coin.MINTER_ROLE();

  // 1) Repoint rewardToken -> canonical
  const current = await nft.rewardToken();
  console.log("Current rewardToken:", current);
  if (current.toLowerCase() === CANONICAL_DOUDOCOIN.toLowerCase()) {
    console.log("rewardToken already canonical");
  } else {
    if (!(await nft.hasRole(await nft.DEFAULT_ADMIN_ROLE(), me))) {
      throw new Error(`Signer ${me} is not NFT admin; cannot setRewardToken`);
    }
    const tx = await nft.setRewardToken(CANONICAL_DOUDOCOIN);
    console.log("setRewardToken tx:", tx.hash);
    await tx.wait();
  }

  // 2) Grant the NFT MINTER_ROLE on the canonical token
  if (await coin.hasRole(minterRole, NFT)) {
    console.log("NFT already has MINTER_ROLE on canonical DOUDOCOIN");
  } else if (await coin.hasRole(await coin.DEFAULT_ADMIN_ROLE(), me)) {
    const tx = await coin.grantRole(minterRole, NFT);
    console.log("grant MINTER_ROLE tx:", tx.hash);
    await tx.wait();
  } else {
    console.warn(
      `[ACTION REQUIRED] Signer ${me} is not admin of ${CANONICAL_DOUDOCOIN}. ` +
        `Token admin must grantRole(MINTER_ROLE=${minterRole}, ${NFT}).`
    );
  }

  // 3) Optional: revoke MINTER_ROLE on the old/incorrect token
  if (REVOKE_OLD) {
    const old = await ethers.getContractAt(COIN_ABI, OLD_DOUDOCOIN);
    const oldMinter = await old.MINTER_ROLE();
    if (!(await old.hasRole(oldMinter, NFT))) {
      console.log("NFT has no MINTER_ROLE on old token; nothing to revoke");
    } else if (await old.hasRole(await old.DEFAULT_ADMIN_ROLE(), me)) {
      const tx = await old.revokeRole(oldMinter, NFT);
      console.log("revoke old MINTER_ROLE tx:", tx.hash);
      await tx.wait();
    } else {
      console.warn(`[skip revoke] Signer is not admin of old token ${OLD_DOUDOCOIN}.`);
    }
  }

  // 4) Assertions
  const checks: [string, boolean][] = [
    [
      "rewardToken == canonical",
      (await nft.rewardToken()).toLowerCase() === CANONICAL_DOUDOCOIN.toLowerCase(),
    ],
    ["NFT has MINTER_ROLE on canonical", await coin.hasRole(minterRole, NFT)],
  ];
  for (const [label, ok] of checks) {
    console.log(`${ok ? "OK " : "FAIL"} - ${label}`);
    if (!ok) throw new Error(`Assertion failed: ${label}`);
  }
  console.log("\nDone. NFT now mints canonical DOUDOCOIN", CANONICAL_DOUDOCOIN);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
