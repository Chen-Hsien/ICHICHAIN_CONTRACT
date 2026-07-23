import { ethers, upgrades } from "hardhat";

const DOUDOCOINNFT =
  process.env.DOUDOCOIN_NFT_PROXY_ADDRESS ||
  process.env.DOUDOCOIN_NFT_ADDRESS;

if (!DOUDOCOINNFT || !ethers.isAddress(DOUDOCOINNFT)) {
  throw new Error(
    "DOUDOCOIN_NFT_PROXY_ADDRESS (or DOUDOCOIN_NFT_ADDRESS) is required"
  );
}

const MEMBERSHIP_METADATA_BASE =
  "https://lime-basic-thrush-351.mypinata.cloud/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/";

// levelIndex must match on-chain membershipLevels order (0 = NonMembership).
const membershipUpdates = [
  {
    levelIndex: 1,
    name: "Common",
    threshold: 1n,
    tokenURI: `${MEMBERSHIP_METADATA_BASE}common.json`, // https://ipfs.io/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/common.json
    rewardBasisPoints: 0n,
  },
  {
    levelIndex: 2,
    name: "Silver",
    threshold: ethers.parseEther("9000"),
    tokenURI: `${MEMBERSHIP_METADATA_BASE}sliver.json`, // https://ipfs.io/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/sliver.json
    rewardBasisPoints: 25n,
  },
  {
    levelIndex: 3,
    name: "Gold",
    threshold: ethers.parseEther("48000"),
    tokenURI: `${MEMBERSHIP_METADATA_BASE}gold.json`, // https://ipfs.io/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/gold.json
    rewardBasisPoints: 75n,
  },
  {
    levelIndex: 4,
    name: "Platinum",
    threshold: ethers.parseEther("90000"), // https://lime-basic-thrush-351.mypinata.cloud/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/Platinum.json
    tokenURI: `${MEMBERSHIP_METADATA_BASE}Platinum.json`, // https://ipfs.io/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/Platinum.json
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

const NFT_ABI = [
  "function membershipLevels(uint256 index) external view returns (string name, uint256 threshold, string membershipTokenURI, uint256 rewardBasisPoints)",
  "function setMembershipLevelConfig(uint256 levelIndex, uint256 newThreshold, uint256 newRewardBasisPoints) external",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const nft = await ethers.getContractAt(NFT_ABI, DOUDOCOINNFT);
  const implementation = await upgrades.erc1967.getImplementationAddress(
    DOUDOCOINNFT
  );
  const adminRole = await nft.DEFAULT_ADMIN_ROLE();

  console.log("DOUDOCOINNFT:", DOUDOCOINNFT);
  console.log("Implementation:", implementation);
  console.log("Signer:", signerAddress);
  console.log(
    "Has DEFAULT_ADMIN_ROLE:",
    await nft.hasRole(adminRole, signerAddress)
  );

  if (!(await nft.hasRole(adminRole, signerAddress))) {
    throw new Error(`Signer ${signerAddress} is not DEFAULT_ADMIN_ROLE on NFT`);
  }

  for (const level of membershipUpdates) {
    const before = await nft.membershipLevels(level.levelIndex);
    if (before.name !== level.name) {
      throw new Error(
        `Unexpected membership level at index ${level.levelIndex}: expected ${level.name}, got ${before.name}`
      );
    }
    console.log(`\nBefore [${level.levelIndex}] ${before.name}`);
    console.log("  threshold:", before.threshold.toString());
    console.log("  tokenURI:", before.membershipTokenURI);
    console.log("  rewardBasisPoints:", before.rewardBasisPoints.toString());

    if (
      before.threshold === level.threshold &&
      before.rewardBasisPoints === level.rewardBasisPoints
    ) {
      console.log("  unchanged; skipping transaction");
      continue;
    }

    await nft.setMembershipLevelConfig.staticCall(
      level.levelIndex,
      level.threshold,
      level.rewardBasisPoints
    );

    const tx = await nft.setMembershipLevelConfig(
      level.levelIndex,
      level.threshold,
      level.rewardBasisPoints
    );
    console.log(`setMembershipLevelConfig(${level.name}) tx:`, tx.hash);
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
