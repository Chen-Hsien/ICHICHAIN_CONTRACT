import { ethers } from "hardhat";

/**
 * Appends Emerald as the next membership level (expected index 5) on Arb Sepolia DOUDOCOINNFT.
 *
 * Run:
 *   npx hardhat run scripts/addMembershipLevelEmeraldArbSepolia.ts --network arbitrumSepolia
 *
 * Optional env:
 *   DOUDOCOIN_NFT_ADDRESS
 */

const DOUDOCOINNFT =
  process.env.DOUDOCOIN_NFT_ADDRESS || "0x35d6650973B713193C9D0Ef96E4EbFB61B96B7B7";

const NEW_LEVEL = {
  name: "Emerald",
  // 180000 DOUDO (180000e18)
  threshold: 180000000000000000000000n,
  tokenURI:
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/bafybeifydnzvcfadln226n63fqow3xrlhqhrbmvuphokyysgzkhcnsxvwe/Emerald.json",
  // 2.5% = 250 basis points
  rewardBasisPoints: 250n,
};

const NFT_ABI = [
  "function membershipLevels(uint256 index) external view returns (string name, uint256 threshold, string membershipTokenURI, uint256 rewardBasisPoints)",
  "function addMembershipLevel(string name, uint256 threshold, string membershipTokenURI, uint256 rewardBasisPoints) external",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

async function tryReadLevel(nft: any, index: number) {
  try {
    return await nft.membershipLevels(index);
  } catch {
    return null;
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const network = await ethers.provider.getNetwork();
  const nft = await ethers.getContractAt(NFT_ABI, DOUDOCOINNFT);

  const adminRole = await nft.DEFAULT_ADMIN_ROLE();
  const hasAdmin = await nft.hasRole(adminRole, signerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("DOUDOCOINNFT:", DOUDOCOINNFT);
  console.log("Deployer:", signerAddress);
  console.log("Has DEFAULT_ADMIN_ROLE:", hasAdmin);
  console.log("New level:", {
    name: NEW_LEVEL.name,
    threshold: NEW_LEVEL.threshold.toString(),
    thresholdEther: ethers.formatEther(NEW_LEVEL.threshold),
    tokenURI: NEW_LEVEL.tokenURI,
    rewardBasisPoints: NEW_LEVEL.rewardBasisPoints.toString(),
    rewardPercent: `${Number(NEW_LEVEL.rewardBasisPoints) / 100}%`,
  });

  if (!hasAdmin) {
    throw new Error(`Deployer ${signerAddress} does not have DEFAULT_ADMIN_ROLE`);
  }

  // Existing ladder: 0 NonMembership … 4 Platinum. Emerald should become index 5.
  const platinum = await tryReadLevel(nft, 4);
  if (!platinum) {
    throw new Error("membershipLevels(4) missing — unexpected ladder state");
  }
  console.log("Current Platinum (index 4):", {
    name: platinum.name,
    threshold: platinum.threshold.toString(),
    rewardBasisPoints: platinum.rewardBasisPoints.toString(),
  });

  if (NEW_LEVEL.threshold <= BigInt(platinum.threshold)) {
    throw new Error(
      `Emerald threshold (${NEW_LEVEL.threshold}) must be > Platinum (${platinum.threshold})`
    );
  }

  const existingEmerald = await tryReadLevel(nft, 5);
  if (existingEmerald && existingEmerald.name === "Emerald") {
    console.log("Emerald already exists at index 5:");
    console.log({
      name: existingEmerald.name,
      threshold: existingEmerald.threshold.toString(),
      tokenURI: existingEmerald.membershipTokenURI,
      rewardBasisPoints: existingEmerald.rewardBasisPoints.toString(),
    });
    return;
  }

  const code = await ethers.provider.getCode(DOUDOCOINNFT);
  const selector = ethers.id("addMembershipLevel(string,uint256,string,uint256)").slice(2, 10);
  if (!code.toLowerCase().includes(selector.toLowerCase())) {
    throw new Error(
      `On-chain bytecode at ${DOUDOCOINNFT} does not contain addMembershipLevel(string,uint256,string,uint256). Redeploy DOUDOCOINNFT first.`
    );
  }

  await nft.addMembershipLevel.staticCall(
    NEW_LEVEL.name,
    NEW_LEVEL.threshold,
    NEW_LEVEL.tokenURI,
    NEW_LEVEL.rewardBasisPoints
  );

  const tx = await nft.addMembershipLevel(
    NEW_LEVEL.name,
    NEW_LEVEL.threshold,
    NEW_LEVEL.tokenURI,
    NEW_LEVEL.rewardBasisPoints
  );
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);
  console.log("Gas used:", receipt?.gasUsed.toString());

  const level5 = await nft.membershipLevels(5);
  console.log("membershipLevels(5):", {
    name: level5.name,
    threshold: level5.threshold.toString(),
    thresholdEther: ethers.formatEther(level5.threshold),
    tokenURI: level5.membershipTokenURI,
    rewardBasisPoints: level5.rewardBasisPoints.toString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
