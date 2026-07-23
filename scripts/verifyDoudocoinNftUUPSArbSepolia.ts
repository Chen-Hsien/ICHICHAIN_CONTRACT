import assert from "node:assert/strict";
import { ethers, upgrades } from "hardhat";

const LEGACY_NFT = "0x35d6650973B713193C9D0Ef96E4EbFB61B96B7B7";
const NEW_NFT = "0x1F1150AC2d7a8208A2743a4E74e8401Ff9F1ED53";
const DOUDO_POINTS = "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";
const DEPLOYER = "0x226f0197D502e7AC87d1A76D6526945DFa9E4209";
const LEGACY_MINTER = "0x25f7F9577A93d9708234245A50a860eA5845ff0b";
const PROXY_DEPLOY_TX =
  "0x56ede3643acc3b31a53ce01991d887176924647caa1930b021284ac2559a174c";

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
];
const POINTS_ABI = [
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
];

async function main() {
  const network = await ethers.provider.getNetwork();
  assert.equal(network.chainId, 421614n);
  const legacy = await ethers.getContractAt(LEGACY_ABI, LEGACY_NFT);
  const nft = await ethers.getContractAt("DOUDOCOINNFT", NEW_NFT);
  const points = await ethers.getContractAt(POINTS_ABI, DOUDO_POINTS);

  assert.equal(await nft.name(), "DOUDOCOINNFT");
  assert.equal(await nft.symbol(), "DOUDO");
  assert.equal((await nft.rewardToken()).toLowerCase(), DOUDO_POINTS.toLowerCase());
  assert.equal(await nft.totalSupply(), await legacy.totalSupply());
  assert.equal(await nft.nextVoucherTypeId(), await legacy.nextVoucherTypeId());
  assert.equal(
    await nft.membershipExpirationPeriod(),
    await legacy.membershipExpirationPeriod()
  );

  const expectedLevels = [
    ["NonMembership", 0n, 0n],
    ["Common", 1n, 0n],
    ["Silver", ethers.parseEther("9000"), 25n],
    ["Gold", ethers.parseEther("48000"), 75n],
    ["Platinum", ethers.parseEther("90000"), 150n],
    ["Emerald", ethers.parseEther("180000"), 250n],
  ] as const;
  for (const [index, expected] of expectedLevels.entries()) {
    const level = await nft.membershipLevels(index);
    assert.equal(level.name, expected[0]);
    assert.equal(level.threshold, expected[1]);
    assert.equal(level.rewardBasisPoints, expected[2]);
  }

  for (let index = 0n; index < (await legacy.nextVoucherTypeId()); index++) {
    const oldType = await legacy.voucherTypes(index);
    const newType = await nft.voucherTypes(index);
    assert.deepEqual(
      [newType.amount, newType.maxPerUser, newType.tokenURI],
      [oldType.amount, oldType.maxPerUser, oldType.tokenURI]
    );
  }

  const supply = await legacy.totalSupply();
  let memberships = 0;
  for (let index = 0n; index < supply; index++) {
    const tokenId = await legacy.tokenByIndex(index);
    const owner = await legacy.ownerOf(tokenId);
    const membership = await legacy.isMembershipNFT(tokenId);
    assert.equal((await nft.ownerOf(tokenId)).toLowerCase(), owner.toLowerCase());
    assert.equal(await nft.isMembershipNFT(tokenId), membership);
    assert.equal(await nft.voucherTypeIds(tokenId), await legacy.voucherTypeIds(tokenId));
    if (membership) {
      memberships++;
      const oldInfo = await legacy.userInfo(owner);
      const newInfo = await nft.userInfo(owner);
      assert.deepEqual(Array.from(newInfo), Array.from(oldInfo));
    }
  }

  const adminRole = await nft.DEFAULT_ADMIN_ROLE();
  const minterRole = await nft.MINTER_ROLE();
  const upgraderRole = await nft.UPGRADER_ROLE();
  const migratorRole = await nft.MIGRATOR_ROLE();
  assert.equal(await nft.hasRole(adminRole, DEPLOYER), true);
  assert.equal(await nft.hasRole(upgraderRole, DEPLOYER), true);
  assert.equal(await nft.hasRole(minterRole, DEPLOYER), true);
  assert.equal(await nft.hasRole(minterRole, LEGACY_MINTER), true);
  assert.equal(await nft.hasRole(migratorRole, DEPLOYER), false);
  assert.equal(await points.hasRole(await points.MINTER_ROLE(), NEW_NFT), true);

  const implementation = await upgrades.erc1967.getImplementationAddress(NEW_NFT);
  const deployReceipt = await ethers.provider.getTransactionReceipt(PROXY_DEPLOY_TX);
  assert.ok(deployReceipt);

  console.log("verification: PASS");
  console.log("proxy:", NEW_NFT);
  console.log("implementation:", implementation);
  console.log("startBlock:", deployReceipt.blockNumber);
  console.log("supply:", supply.toString());
  console.log("memberships:", memberships);
  console.log("voucherTypes:", (await nft.nextVoucherTypeId()).toString());
  console.log("migratorRevoked: true");
  console.log("pointsMinterGranted: true");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
