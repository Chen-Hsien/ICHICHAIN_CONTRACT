import { ethers, upgrades } from "hardhat";

const LEGACY_NFT =
  process.env.LEGACY_DOUDOCOIN_NFT_ADDRESS ||
  "0x35d6650973B713193C9D0Ef96E4EbFB61B96B7B7";
const DOUDO_POINTS =
  process.env.DOUDO_POINTS_ADDRESS ||
  "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";

const LEGACY_ABI = [
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function isMembershipNFT(uint256) view returns (bool)",
  "function voucherTypeIds(uint256) view returns (uint256)",
  "function userInfo(address) view returns (uint256 totalRedeemed, uint256 currentRoundRedeemed, uint256 membershipLevel, uint256 membershipNFT, uint256 lastActiveTimestamp)",
  "function nextVoucherTypeId() view returns (uint256)",
  "function voucherTypes(uint256) view returns (uint256 amount, uint256 maxPerUser, string tokenURI)",
  "function membershipExpirationPeriod() view returns (uint256)",
  "function rewardToken() view returns (address)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
];

const POINTS_ABI = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address) external",
];

type LegacyToken = {
  tokenId: bigint;
  owner: string;
  membership: boolean;
  voucherTypeId: bigint;
};

async function readLegacySnapshot(legacy: any): Promise<{
  tokens: LegacyToken[];
  voucherTypes: Array<{ amount: bigint; maxPerUser: bigint; tokenURI: string }>;
}> {
  const totalSupply = await legacy.totalSupply();
  const tokenIds = await Promise.all(
    Array.from({ length: Number(totalSupply) }, (_, index) =>
      legacy.tokenByIndex(index)
    )
  );
  const tokens = await Promise.all(
    tokenIds.map(async (tokenId: bigint) => ({
      tokenId,
      owner: await legacy.ownerOf(tokenId),
      membership: await legacy.isMembershipNFT(tokenId),
      voucherTypeId: await legacy.voucherTypeIds(tokenId),
    }))
  );
  tokens.sort((a, b) => (a.tokenId < b.tokenId ? -1 : 1));

  const voucherTypeCount = await legacy.nextVoucherTypeId();
  const voucherTypes = await Promise.all(
    Array.from({ length: Number(voucherTypeCount) }, async (_, index) => {
      const value = await legacy.voucherTypes(index);
      return {
        amount: value.amount,
        maxPerUser: value.maxPerUser,
        tokenURI: value.tokenURI,
      };
    })
  );
  return { tokens, voucherTypes };
}

async function readActiveLegacyRoleAccounts(
  legacy: any,
  role: string
): Promise<string[]> {
  const fromBlock = Number(
    process.env.LEGACY_DOUDOCOIN_NFT_START_BLOCK || "275143005"
  );
  const latestBlock = await ethers.provider.getBlockNumber();
  const grantedTopic = ethers.id("RoleGranted(bytes32,address,address)");
  const revokedTopic = ethers.id("RoleRevoked(bytes32,address,address)");
  const accounts = new Set<string>();
  for (let start = fromBlock; start <= latestBlock; start += 500_000) {
    const logs = await ethers.provider.getLogs({
      address: LEGACY_NFT,
      topics: [[grantedTopic, revokedTopic], role],
      fromBlock: start,
      toBlock: Math.min(start + 499_999, latestBlock),
    });
    for (const log of logs) {
      accounts.add(ethers.getAddress(`0x${log.topics[2].slice(-40)}`));
    }
  }

  const active: string[] = [];
  for (const account of accounts) {
    if (await legacy.hasRole(role, account)) active.push(account);
  }
  return active;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 421614n) {
    throw new Error(`Expected Arbitrum Sepolia (421614), got ${network.chainId}`);
  }

  const legacy = await ethers.getContractAt(LEGACY_ABI, LEGACY_NFT);
  const legacyRewardToken = await legacy.rewardToken();
  if (legacyRewardToken.toLowerCase() !== DOUDO_POINTS.toLowerCase()) {
    throw new Error(
      `Legacy reward token ${legacyRewardToken} does not match ${DOUDO_POINTS}`
    );
  }
  const snapshot = await readLegacySnapshot(legacy);
  const legacyAdminRole = await legacy.DEFAULT_ADMIN_ROLE();
  const legacyMinterRole = await legacy.MINTER_ROLE();
  const legacyAdmins = await readActiveLegacyRoleAccounts(
    legacy,
    legacyAdminRole
  );
  const legacyMinters = await readActiveLegacyRoleAccounts(
    legacy,
    legacyMinterRole
  );
  const legacyExpirationPeriod = await legacy.membershipExpirationPeriod();
  const contractHolders = [];
  for (const owner of new Set(snapshot.tokens.map((token) => token.owner))) {
    if ((await ethers.provider.getCode(owner)) !== "0x") {
      contractHolders.push(owner);
    }
  }

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Legacy DOUDOCOINNFT:", LEGACY_NFT);
  console.log("DOUDO points:", DOUDO_POINTS);
  console.log("Deployer:", deployerAddress);
  console.log("Voucher type count:", snapshot.voucherTypes.length);
  console.log("NFT count:", snapshot.tokens.length);
  console.log(
    "Membership NFT count:",
    snapshot.tokens.filter((token) => token.membership).length
  );
  console.log("Contract holder count:", contractHolders.length);
  console.log("Legacy admin count:", legacyAdmins.length);
  console.log("Legacy minter count:", legacyMinters.length);

  if (process.env.EXECUTE_DOUDOCOIN_NFT_UUPS_DEPLOY !== "1") {
    console.log(
      "Dry run only. Set EXECUTE_DOUDOCOIN_NFT_UUPS_DEPLOY=1 after reviewing the snapshot."
    );
    if (contractHolders.length > 0) {
      console.log(
        "Contract-held NFTs require ALLOW_CONTRACT_HOLDER_MIGRATION=1 after receiver review."
      );
    }
    return;
  }
  if (
    contractHolders.length > 0 &&
    process.env.ALLOW_CONTRACT_HOLDER_MIGRATION !== "1"
  ) {
    throw new Error(
      "Contract-held NFTs require ALLOW_CONTRACT_HOLDER_MIGRATION=1 after receiver review"
    );
  }

  const points = await ethers.getContractAt(POINTS_ABI, DOUDO_POINTS);
  const pointsAdminRole = await points.DEFAULT_ADMIN_ROLE();
  if (!(await points.hasRole(pointsAdminRole, deployerAddress))) {
    throw new Error("Deployer is not DEFAULT_ADMIN_ROLE on DOUDO points");
  }

  const Factory = await ethers.getContractFactory("DOUDOCOINNFT");
  const nft = await upgrades.deployProxy(
    Factory,
    [DOUDO_POINTS, deployerAddress, deployerAddress],
    { initializer: "initialize", kind: "uups" }
  );
  await nft.waitForDeployment();
  const proxyAddress = await nft.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("UUPS proxy:", proxyAddress);
  console.log("Implementation:", implementationAddress);

  if ((await nft.membershipExpirationPeriod()) !== legacyExpirationPeriod) {
    const expirationTx = await nft.setMembershipExpirationPeriod(
      legacyExpirationPeriod
    );
    console.log("Copy membership expiration tx:", expirationTx.hash);
    await expirationTx.wait();
  }

  const newAdminRole = await nft.DEFAULT_ADMIN_ROLE();
  const newMinterRole = await nft.MINTER_ROLE();
  for (const account of legacyAdmins) {
    if (!(await nft.hasRole(newAdminRole, account))) {
      const tx = await nft.grantRole(newAdminRole, account);
      console.log(`Copy admin role ${account} tx:`, tx.hash);
      await tx.wait();
    }
  }
  for (const account of legacyMinters) {
    if (!(await nft.hasRole(newMinterRole, account))) {
      const tx = await nft.grantRole(newMinterRole, account);
      console.log(`Copy minter role ${account} tx:`, tx.hash);
      await tx.wait();
    }
  }

  const pointsMinterRole = await points.MINTER_ROLE();
  const grantTx = await points.grantRole(pointsMinterRole, proxyAddress);
  console.log("Grant points MINTER_ROLE tx:", grantTx.hash);
  await grantTx.wait();

  for (const [index, voucherType] of snapshot.voucherTypes.entries()) {
    const tx = await nft.createVoucherType(
      voucherType.amount,
      voucherType.maxPerUser,
      voucherType.tokenURI
    );
    console.log(`Copy voucher type ${index} tx:`, tx.hash);
    await tx.wait();
  }

  for (const token of snapshot.tokens) {
    let tx;
    if (token.membership) {
      const info = await legacy.userInfo(token.owner);
      if (info.membershipNFT !== token.tokenId) {
        throw new Error(
          `Legacy membership mismatch for ${token.owner}: token ${token.tokenId}`
        );
      }
      tx = await nft.migrateLegacyMembership(
        token.owner,
        token.tokenId,
        info.totalRedeemed,
        info.currentRoundRedeemed,
        info.membershipLevel,
        info.lastActiveTimestamp
      );
    } else {
      tx = await nft.migrateLegacyVoucher(
        token.owner,
        token.tokenId,
        token.voucherTypeId
      );
    }
    console.log(`Migrate token ${token.tokenId} tx:`, tx.hash);
    await tx.wait();
  }

  if ((await nft.totalSupply()) !== BigInt(snapshot.tokens.length)) {
    throw new Error("Post-migration totalSupply mismatch");
  }
  for (const token of snapshot.tokens) {
    if ((await nft.ownerOf(token.tokenId)) !== token.owner) {
      throw new Error(`Post-migration owner mismatch for token ${token.tokenId}`);
    }
  }

  const migratorRole = await nft.MIGRATOR_ROLE();
  const revokeTx = await nft.revokeRole(migratorRole, deployerAddress);
  console.log("Revoke deployer MIGRATOR_ROLE tx:", revokeTx.hash);
  await revokeTx.wait();

  console.log("Migration verified.");
  console.log("New DOUDOCOINNFT UUPS proxy:", proxyAddress);
  console.log(
    "Next: update frontend, backend, The Graph address/start block only after consumer cutover approval."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
