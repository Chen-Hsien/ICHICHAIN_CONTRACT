import { ethers, upgrades } from "hardhat";

const LEGACY_NFT =
  process.env.LEGACY_DOUDOCOIN_NFT_ADDRESS ||
  "0x35d6650973B713193C9D0Ef96E4EbFB61B96B7B7";
const NEW_NFT = process.env.NEW_DOUDOCOIN_NFT_PROXY;

const LEGACY_ABI = [
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function isMembershipNFT(uint256) view returns (bool)",
  "function voucherTypeIds(uint256) view returns (uint256)",
  "function userInfo(address) view returns (uint256 totalRedeemed, uint256 currentRoundRedeemed, uint256 membershipLevel, uint256 membershipNFT, uint256 lastActiveTimestamp)",
];

async function main() {
  if (!NEW_NFT || !ethers.isAddress(NEW_NFT)) {
    throw new Error("Set NEW_DOUDOCOIN_NFT_PROXY to the deployed UUPS proxy");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 421614n) {
    throw new Error(`Expected Arbitrum Sepolia (421614), got ${network.chainId}`);
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const legacy = await ethers.getContractAt(LEGACY_ABI, LEGACY_NFT);
  const nft = await ethers.getContractAt("DOUDOCOINNFT", NEW_NFT);
  const implementation = await upgrades.erc1967.getImplementationAddress(NEW_NFT);
  const migratorRole = await nft.MIGRATOR_ROLE();

  if (!(await nft.hasRole(migratorRole, deployerAddress))) {
    throw new Error("Deployer no longer has MIGRATOR_ROLE");
  }

  const supply = await legacy.totalSupply();
  const tokenIds = await Promise.all(
    Array.from({ length: Number(supply) }, (_, index) => legacy.tokenByIndex(index))
  );
  tokenIds.sort((a: bigint, b: bigint) => (a < b ? -1 : 1));

  console.log("Proxy:", NEW_NFT);
  console.log("Implementation:", implementation);
  console.log("Legacy token count:", tokenIds.length);

  for (const tokenId of tokenIds) {
    const owner = await legacy.ownerOf(tokenId);
    try {
      const currentOwner = await nft.ownerOf(tokenId);
      if (currentOwner.toLowerCase() !== owner.toLowerCase()) {
        throw new Error(`Owner mismatch for existing token ${tokenId}`);
      }
      console.log(`Token ${tokenId} already migrated`);
      continue;
    } catch (error: any) {
      const message = String(error?.shortMessage || error?.message);
      if (
        !message.includes("ERC721NonexistentToken") &&
        !message.includes("ERC721: invalid token ID")
      ) {
        throw error;
      }
    }

    const membership = await legacy.isMembershipNFT(tokenId);
    let tx;
    if (membership) {
      const info = await legacy.userInfo(owner);
      if (info.membershipNFT !== tokenId) {
        throw new Error(`Legacy membership mismatch for ${owner}: token ${tokenId}`);
      }
      await nft.migrateLegacyMembership.staticCall(
        owner,
        tokenId,
        info.totalRedeemed,
        info.currentRoundRedeemed,
        info.membershipLevel,
        info.lastActiveTimestamp
      );
      tx = await nft.migrateLegacyMembership(
        owner,
        tokenId,
        info.totalRedeemed,
        info.currentRoundRedeemed,
        info.membershipLevel,
        info.lastActiveTimestamp,
        { gasLimit: 1_500_000 }
      );
    } else {
      const voucherTypeId = await legacy.voucherTypeIds(tokenId);
      await nft.migrateLegacyVoucher.staticCall(owner, tokenId, voucherTypeId);
      tx = await nft.migrateLegacyVoucher(owner, tokenId, voucherTypeId, {
        gasLimit: 1_500_000,
      });
    }
    console.log(`Resume token ${tokenId} tx:`, tx.hash);
    await tx.wait();
  }

  if ((await nft.totalSupply()) !== supply) {
    throw new Error("Post-migration totalSupply mismatch");
  }
  for (const tokenId of tokenIds) {
    const expectedOwner = await legacy.ownerOf(tokenId);
    const actualOwner = await nft.ownerOf(tokenId);
    if (actualOwner.toLowerCase() !== expectedOwner.toLowerCase()) {
      throw new Error(`Post-migration owner mismatch for token ${tokenId}`);
    }
  }

  const revokeTx = await nft.revokeRole(migratorRole, deployerAddress);
  console.log("Revoke deployer MIGRATOR_ROLE tx:", revokeTx.hash);
  await revokeTx.wait();
  console.log("Migration resumed and verified.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
