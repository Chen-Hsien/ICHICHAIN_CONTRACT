const { expect } = require("chai");
const { artifacts, ethers, upgrades } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("DOUDOCOINNFT UUPS membership configuration", function () {
  async function deployFixture() {
    const [admin, minter, user, other] = await ethers.getSigners();
    const RewardToken = await ethers.getContractFactory(
      "contracts/DDOUDOCOIN.sol:DOUDOCOIN"
    );
    const rewardToken = await RewardToken.deploy(admin.address, minter.address);
    await rewardToken.waitForDeployment();

    const NFT = await ethers.getContractFactory("DOUDOCOINNFT");
    const nft = await upgrades.deployProxy(
      NFT,
      [await rewardToken.getAddress(), admin.address, minter.address],
      { initializer: "initialize", kind: "uups" }
    );
    await nft.waitForDeployment();

    return { admin, minter, user, other, rewardToken, nft, NFT };
  }

  it("applies the 0.6-scaled thresholds and reduced reward gradient", async function () {
    const { nft } = await deployFixture();
    const expected = [
      ["NonMembership", 0n, 0n],
      ["Common", 1n, 0n],
      ["Silver", ethers.parseEther("9000"), 25n],
      ["Gold", ethers.parseEther("48000"), 75n],
      ["Platinum", ethers.parseEther("90000"), 150n],
      ["Emerald", ethers.parseEther("180000"), 250n],
    ];

    for (let index = 0; index < expected.length; index++) {
      const level = await nft.membershipLevels(index);
      expect([level.name, level.threshold, level.rewardBasisPoints]).to.deep.equal(
        expected[index]
      );
    }

    await expect(nft.membershipLevels(expected.length)).to.be.reverted;
  });

  it("initializes once and assigns admin, minter, and upgrader roles", async function () {
    const { admin, minter, rewardToken, nft, NFT } = await deployFixture();

    expect(await nft.hasRole(await nft.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await nft.hasRole(await nft.MINTER_ROLE(), minter.address)).to.equal(true);
    expect(await nft.hasRole(await nft.UPGRADER_ROLE(), admin.address)).to.equal(true);
    expect(await nft.supportsInterface("0x7965db0b")).to.equal(true);
    await expect(
      nft.initialize(await rewardToken.getAddress(), admin.address, minter.address)
    ).to.be.revertedWith("Initializable: contract is already initialized");

    const implementation = await NFT.deploy();
    await implementation.waitForDeployment();
    await expect(
      implementation.initialize(await rewardToken.getAddress(), admin.address, minter.address)
    ).to.be.revertedWith("Initializable: contract is already initialized");
  });

  it("keeps implementation runtime bytecode within the EIP-170 limit", async function () {
    const artifact = await artifacts.readArtifact("DOUDOCOINNFT");
    const deployedBytes = (artifact.deployedBytecode.length - 2) / 2;
    expect(deployedBytes).to.be.at.most(24_576);
  });

  it("sets threshold and reward while preserving metadata and emitting the full event", async function () {
    const { nft } = await deployFixture();
    const before = await nft.membershipLevels(2);

    await expect(nft.setMembershipLevelConfig(2, ethers.parseEther("10000"), 40))
      .to.emit(nft, "MembershipLevelUpdated")
      .withArgs(2, ethers.parseEther("10000"), before.membershipTokenURI, 40);

    const after = await nft.membershipLevels(2);
    expect(after.threshold).to.equal(ethers.parseEther("10000"));
    expect(after.membershipTokenURI).to.equal(before.membershipTokenURI);
    expect(after.rewardBasisPoints).to.equal(40);
  });

  it("mints and reports fractional membership rewards in 18-decimal token units", async function () {
    const { minter, user, rewardToken, nft } = await deployFixture();
    await rewardToken.grantRole(
      await rewardToken.MINTER_ROLE(),
      await nft.getAddress()
    );
    await nft.createVoucherType(100, 1, "ipfs://voucher-100");
    await nft.connect(minter).mintMembershipNFT(user.address, 2);
    await nft.connect(minter).mintVouchers(user.address, [0], [1]);
    const infoBefore = await nft.userInfo(user.address);

    const baseAmount = ethers.parseEther("100");
    const fractionalReward = ethers.parseEther("0.25");
    const totalAmount = baseAmount + fractionalReward;

    await expect(nft.connect(user).burnVouchersBatch([2]))
      .to.emit(nft, "VoucherTotalRedeemed")
      .withArgs([2], user.address, totalAmount, fractionalReward);

    expect(await rewardToken.balanceOf(user.address)).to.equal(totalAmount);
    const info = await nft.userInfo(user.address);
    expect(info.totalRedeemed).to.equal(infoBefore.totalRedeemed + totalAmount);
    expect(info.currentRoundRedeemed).to.equal(
      infoBefore.currentRoundRedeemed + totalAmount
    );
    expect(info.membershipLevel).to.equal(2);
  });

  it("rejects unauthorized, nonexistent, unordered, and excessive membership settings", async function () {
    const { other, nft } = await deployFixture();

    await expect(
      nft.connect(other).setMembershipLevelConfig(2, ethers.parseEther("10000"), 40)
    ).to.be.revertedWithCustomError(nft, "MissingRole");
    await expect(
      nft.setMembershipLevelConfig(6, ethers.parseEther("200000"), 300)
    ).to.be.revertedWithCustomError(nft, "InvalidMembershipLevel");
    await expect(
      nft.setMembershipLevelConfig(2, 1, 25)
    ).to.be.revertedWithCustomError(nft, "InvalidMembershipThreshold");
    await expect(
      nft.setMembershipLevelConfig(2, ethers.parseEther("48000"), 25)
    ).to.be.revertedWithCustomError(nft, "InvalidMembershipThreshold");
    await expect(
      nft.setMembershipLevelConfig(2, ethers.parseEther("10000"), 10001)
    ).to.be.revertedWithCustomError(nft, "InvalidRewardBasisPoints");
  });

  it("cancels legacy voucher and membership NFTs onchain without deleting history", async function () {
    const { minter, user, other, nft } = await deployFixture();
    await nft.createVoucherType(100, 10, "ipfs://voucher-100");
    await nft.connect(minter).mintVouchers(user.address, [0], [1]);
    await nft.connect(minter).mintMembershipNFT(other.address, 2);
    const snapshotBlock = await ethers.provider.getBlockNumber();
    const snapshotRoot = ethers.id("legacy-snapshot-root");
    const cancelledURI = "ipfs://legacy-assets-cancelled";

    await expect(
      nft.cancelLegacyCollection(snapshotBlock, snapshotRoot, cancelledURI)
    )
      .to.emit(nft, "LegacyCollectionCancelled")
      .withArgs(snapshotBlock, snapshotRoot, anyValue, cancelledURI);

    expect(await nft.legacyCollectionCancelled()).to.equal(true);
    expect(await nft.legacyCancellationSnapshotBlock()).to.equal(snapshotBlock);
    expect(await nft.legacyCancellationSnapshotRoot()).to.equal(snapshotRoot);
    expect(await nft.tokenURI(1)).to.equal(cancelledURI);
    expect(await nft.tokenURI(2)).to.equal(cancelledURI);
    expect(await nft.ownerOf(1)).to.equal(user.address);
    expect(await nft.ownerOf(2)).to.equal(other.address);

    await expect(
      nft.connect(minter).mintVouchers(user.address, [0], [1])
    ).to.be.revertedWithCustomError(nft, "LegacyCollectionCancelledOperation");
    await expect(
      nft.connect(user).burnVouchersBatch([1])
    ).to.be.revertedWithCustomError(nft, "LegacyCollectionCancelledOperation");
    await expect(
      nft.connect(other).transferFrom(other.address, user.address, 2)
    ).to.be.revertedWithCustomError(nft, "LegacyCollectionCancelledOperation");
    await expect(
      nft.connect(user).approve(other.address, 1)
    ).to.be.revertedWithCustomError(nft, "LegacyCollectionCancelledOperation");
    await expect(
      nft.connect(user).burn(1)
    ).to.be.revertedWithCustomError(nft, "LegacyCollectionCancelledOperation");
    await expect(
      nft.updateVoucherType(0, 200, 10, "ipfs://changed")
    ).to.be.revertedWithCustomError(nft, "LegacyCollectionCancelledOperation");
    await expect(
      nft.cancelLegacyCollection(snapshotBlock, snapshotRoot, cancelledURI)
    ).to.be.revertedWithCustomError(nft, "LegacyCollectionAlreadyCancelled");
  });

  it("requires an authorized, finalized snapshot to cancel the legacy collection", async function () {
    const { other, nft } = await deployFixture();
    const currentBlock = await ethers.provider.getBlockNumber();
    await expect(
      nft.connect(other).cancelLegacyCollection(
        currentBlock,
        ethers.id("unauthorized-root"),
        "ipfs://cancelled"
      )
    ).to.be.revertedWithCustomError(nft, "MissingRole");
    await expect(
      nft.cancelLegacyCollection(0, ethers.ZeroHash, "")
    ).to.be.revertedWithCustomError(nft, "InvalidLegacyCancellationSnapshot");
    await expect(
      nft.cancelLegacyCollection(
        currentBlock + 100,
        ethers.id("future-root"),
        "ipfs://cancelled"
      )
    ).to.be.revertedWithCustomError(nft, "InvalidLegacyCancellationSnapshot");
  });

  it("preserves roles, membership settings, voucher data, and user NFT state across upgrades", async function () {
    const { admin, minter, user, other, nft } = await deployFixture();
    await nft.createVoucherType(10, 99, "ipfs://voucher-10");
    await nft.connect(minter).mintMembershipNFT(user.address, 2);
    await nft.setMembershipLevelConfig(2, ethers.parseEther("10000"), 40);
    const userBefore = await nft.userInfo(user.address);

    const UpgradeAsOther = await ethers.getContractFactory(
      "contracts/test/DOUDOCOINNFTV2Mock.sol:DOUDOCOINNFTV2Mock",
      other
    );
    await expect(
      upgrades.upgradeProxy(await nft.getAddress(), UpgradeAsOther)
    ).to.be.reverted;

    const UpgradeAsAdmin = await ethers.getContractFactory(
      "contracts/test/DOUDOCOINNFTV2Mock.sol:DOUDOCOINNFTV2Mock",
      admin
    );
    const upgraded = await upgrades.upgradeProxy(
      await nft.getAddress(),
      UpgradeAsAdmin
    );

    expect(await upgraded.version()).to.equal("doudocoin-nft-v2-mock");
    expect(await upgraded.hasRole(await upgraded.MINTER_ROLE(), minter.address)).to.equal(true);
    const level = await upgraded.membershipLevels(2);
    expect(level.threshold).to.equal(ethers.parseEther("10000"));
    expect(level.rewardBasisPoints).to.equal(40);
    const voucher = await upgraded.voucherTypes(0);
    expect([voucher.amount, voucher.maxPerUser, voucher.tokenURI]).to.deep.equal([
      10n,
      99n,
      "ipfs://voucher-10",
    ]);
    const userAfter = await upgraded.userInfo(user.address);
    expect(userAfter).to.deep.equal(userBefore);
    expect(await upgraded.ownerOf(userAfter.membershipNFT)).to.equal(user.address);
  });

  it("migrates legacy token IDs and exact membership state, then supports closing migration", async function () {
    const { admin, user, other, nft } = await deployFixture();
    await nft.createVoucherType(10, 99, "ipfs://voucher-10");

    await expect(nft.migrateLegacyVoucher(user.address, 2, 0))
      .to.emit(nft, "LegacyVoucherMigrated")
      .withArgs(2, user.address, 0);
    await expect(
      nft.migrateLegacyMembership(
        other.address,
        5,
        ethers.parseEther("60000"),
        ethers.parseEther("55000"),
        3,
        123456
      )
    )
      .to.emit(nft, "LegacyMembershipMigrated")
      .withArgs(
        5,
        other.address,
        3,
        ethers.parseEther("60000"),
        ethers.parseEther("55000"),
        123456
      );

    expect(await nft.ownerOf(2)).to.equal(user.address);
    expect(await nft.voucherTypeIds(2)).to.equal(0);
    const info = await nft.userInfo(other.address);
    expect([
      info.totalRedeemed,
      info.currentRoundRedeemed,
      info.membershipLevel,
      info.membershipNFT,
      info.lastActiveTimestamp,
    ]).to.deep.equal([
      ethers.parseEther("60000"),
      ethers.parseEther("55000"),
      3n,
      5n,
      123456n,
    ]);

    const migratorRole = await nft.MIGRATOR_ROLE();
    await nft.revokeRole(migratorRole, admin.address);
    await expect(
      nft.migrateLegacyVoucher(user.address, 6, 0)
    ).to.be.revertedWithCustomError(nft, "MissingRole");
  });
});
