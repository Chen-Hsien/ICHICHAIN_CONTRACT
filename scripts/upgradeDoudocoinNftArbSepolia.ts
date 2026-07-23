import { ethers } from "hardhat";

/**
 * Updates membership metadata URIs (and reward basis points on new bytecode)
 * on the deployed DOUDOCOINNFT at 0x35d665… on Arbitrum Sepolia.
 *
 * Run: npx hardhat run scripts/upgradeDoudocoinNftArbSepolia.ts --network arbitrumSepolia
 *
 * Note: 0x35d665… is a non-proxy deployment. On-chain bytecode still exposes the
 * legacy 3-arg updateMembershipLevel; reward basis points cannot change until redeploy.
 */

const DOUDOCOINNFT =
  process.env.DOUDOCOIN_NFT_ADDRESS || "0x35d6650973B713193C9D0Ef96E4EbFB61B96B7B7";

const MEMBERSHIP_METADATA_BASE =
  "https://lime-basic-thrush-351.mypinata.cloud/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/";

const membershipUpdates = [
  {
    levelIndex: 1,
    name: "Common",
    threshold: 1n,
    tokenURI: `${MEMBERSHIP_METADATA_BASE}common.json`,
    rewardBasisPoints: 0n,
  },
  {
    levelIndex: 2,
    name: "Silver",
    threshold: ethers.parseEther("9000"),
    tokenURI: `${MEMBERSHIP_METADATA_BASE}sliver.json`,
    rewardBasisPoints: 25n,
  },
  {
    levelIndex: 3,
    name: "Gold",
    threshold: ethers.parseEther("48000"),
    tokenURI: `${MEMBERSHIP_METADATA_BASE}gold.json`,
    rewardBasisPoints: 75n,
  },
  {
    levelIndex: 4,
    name: "Platinum",
    threshold: ethers.parseEther("90000"),
    tokenURI: `${MEMBERSHIP_METADATA_BASE}Platinum.json`,
    rewardBasisPoints: 150n,
  },
  {
    levelIndex: 5,
    name: "Emerald",
    threshold: ethers.parseEther("180000"),
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/bafybeifydnzvcfadln226n63fqow3xrlhqhrbmvuphokyysgzkhcnsxvwe/Emerald.json",
    rewardBasisPoints: 250n,
  },
];

const NFT_ABI_LEGACY = [
  "function membershipLevels(uint256 index) external view returns (string name, uint256 threshold, string membershipTokenURI, uint256 rewardBasisPoints)",
  "function updateMembershipLevel(uint256 levelIndex, uint256 newThreshold, string newTokenURI) external",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

const NFT_ABI_V2 = [
  ...NFT_ABI_LEGACY.slice(0, 1),
  "function updateMembershipLevel(uint256 levelIndex, uint256 newThreshold, string newTokenURI, uint256 newRewardBasisPoints) external",
  ...NFT_ABI_LEGACY.slice(2),
];

async function supportsFourArgUpdate(nftAddress: string): Promise<boolean> {
  if (process.env.FORCE_LEGACY_NFT_UPDATE === "1") {
    return false;
  }
  const code = await ethers.provider.getCode(nftAddress);
  const selector4 = ethers
    .id("updateMembershipLevel(uint256,uint256,string,uint256)")
    .slice(2, 10);
  return code.toLowerCase().includes(selector4.toLowerCase());
}

async function main() {
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const fourArg = await supportsFourArgUpdate(DOUDOCOINNFT);
  const nft = await ethers.getContractAt(
    fourArg ? NFT_ABI_V2 : NFT_ABI_LEGACY,
    DOUDOCOINNFT
  );
  const adminRole = await nft.DEFAULT_ADMIN_ROLE();

  console.log("DOUDOCOINNFT:", DOUDOCOINNFT);
  console.log("Signer:", signerAddress);
  console.log("Supports 4-arg updateMembershipLevel:", fourArg);
  console.log(
    "Has DEFAULT_ADMIN_ROLE:",
    await nft.hasRole(adminRole, signerAddress)
  );

  if (!(await nft.hasRole(adminRole, signerAddress))) {
    throw new Error(`Signer ${signerAddress} is not DEFAULT_ADMIN_ROLE on NFT`);
  }

  if (!fourArg) {
    console.log(
      "Legacy deployment: updating threshold + tokenURI only (rewardBasisPoints unchanged on-chain)."
    );
  }

  for (const level of membershipUpdates) {
    const before = await nft.membershipLevels(level.levelIndex);
    console.log(`\nBefore [${level.levelIndex}] ${before.name}`);
    console.log("  threshold:", before.threshold.toString());
    console.log("  tokenURI:", before.membershipTokenURI);
    console.log("  rewardBasisPoints:", before.rewardBasisPoints.toString());

    const tx = fourArg
      ? await nft.updateMembershipLevel(
          level.levelIndex,
          level.threshold,
          level.tokenURI,
          level.rewardBasisPoints
        )
      : await nft.updateMembershipLevel(
          level.levelIndex,
          level.threshold,
          level.tokenURI
        );
    console.log(`updateMembershipLevel(${level.name}) tx:`, tx.hash);
    await tx.wait();

    const after = await nft.membershipLevels(level.levelIndex);
    console.log(`After [${level.levelIndex}] ${after.name}`);
    console.log("  threshold:", after.threshold.toString());
    console.log("  tokenURI:", after.membershipTokenURI);
    console.log("  rewardBasisPoints:", after.rewardBasisPoints.toString());
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
