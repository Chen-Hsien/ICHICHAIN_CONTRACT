const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("DoudoMembershipV2Upgradeable", function () {
  async function deployFixture() {
    const [admin, recorder, operator, user, other] = await ethers.getSigners();
    const Membership = await ethers.getContractFactory("DoudoMembershipV2Upgradeable");
    const membership = await upgrades.deployProxy(
      Membership,
      [admin.address, recorder.address, operator.address],
      { initializer: "initialize", kind: "uups" }
    );
    await membership.waitForDeployment();
    return { admin, recorder, operator, user, other, membership, Membership };
  }

  it("copies the legacy thresholds and records rewards from the pre-spend level", async function () {
    const { recorder, user, membership } = await deployFixture();
    const firstAuthorization = ethers.id("membership-consumption-1");
    const secondAuthorization = ethers.id("membership-consumption-2");

    expect(await membership.levelForSpend(0)).to.equal(0);
    expect(await membership.levelForSpend(1)).to.equal(1);
    expect(await membership.levelForSpend(ethers.parseEther("9000"))).to.equal(2);
    expect(await membership.levelForSpend(ethers.parseEther("48000"))).to.equal(3);
    expect(await membership.levelForSpend(ethers.parseEther("90000"))).to.equal(4);
    expect(await membership.levelForSpend(ethers.parseEther("180000"))).to.equal(5);

    await expect(
      membership
        .connect(recorder)
        .recordConsumption(user.address, ethers.parseEther("9000"), firstAuthorization)
    )
      .to.emit(membership, "MembershipConsumptionRecorded")
      .withArgs(
        firstAuthorization,
        user.address,
        1,
        ethers.parseEther("9000"),
        0,
        0,
        2,
        ethers.parseEther("9000"),
        ethers.parseEther("9000"),
        anyValue,
        anyValue
      );

    const secondSpend = ethers.parseEther("100");
    const expectedReward = ethers.parseEther("0.25");
    await expect(
      membership
        .connect(recorder)
        .recordConsumption(user.address, secondSpend, secondAuthorization)
    )
      .to.emit(membership, "MembershipConsumptionRecorded")
      .withArgs(
        secondAuthorization,
        user.address,
        1,
        secondSpend,
        expectedReward,
        2,
        2,
        ethers.parseEther("9100"),
        ethers.parseEther("9100"),
        anyValue,
        anyValue
      );

    const member = await membership.getMember(user.address);
    expect(member.tokenId).to.equal(1);
    expect(member.level).to.equal(2);
    expect(await membership.rewardBasisPointsOf(user.address)).to.equal(25);
  });

  it("rejects replay, zero values, wrong callers, and transfers", async function () {
    const { recorder, user, other, membership } = await deployFixture();
    const authorizationId = ethers.id("single-use-consumption");
    await membership
      .connect(recorder)
      .recordConsumption(user.address, ethers.parseEther("10"), authorizationId);

    await expect(
      membership
        .connect(recorder)
        .recordConsumption(user.address, 1, authorizationId)
    )
      .to.be.revertedWithCustomError(membership, "AuthorizationAlreadyUsed")
      .withArgs(authorizationId);
    await expect(
      membership.connect(other).recordConsumption(user.address, 1, ethers.id("wrong-caller"))
    ).to.be.revertedWithCustomError(membership, "MissingRole");
    await expect(
      membership.connect(recorder).recordConsumption(user.address, 0, ethers.id("zero"))
    ).to.be.revertedWithCustomError(membership, "InvalidAmount");
    await expect(
      membership.connect(user).transferFrom(user.address, other.address, 1)
    ).to.be.revertedWithCustomError(membership, "SoulboundTransfer");
    await expect(
      membership.connect(user).approve(other.address, 1)
    ).to.be.revertedWithCustomError(membership, "SoulboundTransfer");
  });

  it("reverses refunded current and lifetime spend exactly once", async function () {
    const { recorder, user, other, membership } = await deployFixture();
    const consumed = ethers.parseEther("9000");
    const refunded = ethers.parseEther("1000");
    const reversalId = ethers.id("membership-refund-1");
    await membership
      .connect(recorder)
      .recordConsumption(user.address, consumed, ethers.id("refundable-consumption"));

    await expect(
      membership
        .connect(recorder)
        .reverseConsumption(user.address, refunded, reversalId)
    )
      .to.emit(membership, "MembershipConsumptionReversed")
      .withArgs(
        reversalId,
        user.address,
        1,
        refunded,
        2,
        1,
        ethers.parseEther("8000"),
        ethers.parseEther("8000")
      );

    await expect(
      membership
        .connect(recorder)
        .reverseConsumption(user.address, refunded, reversalId)
    )
      .to.be.revertedWithCustomError(membership, "ReversalAlreadyUsed")
      .withArgs(reversalId);
    await expect(
      membership
        .connect(other)
        .reverseConsumption(user.address, 1, ethers.id("wrong-refund-caller"))
    ).to.be.revertedWithCustomError(membership, "MissingRole");
    await expect(
      membership
        .connect(recorder)
        .reverseConsumption(
          user.address,
          ethers.parseEther("8001"),
          ethers.id("excessive-refund")
        )
    ).to.be.revertedWithCustomError(
      membership,
      "ReversalExceedsLifetimeSpend"
    );
  });

  it("resets current progress after 180 days while retaining lifetime spend", async function () {
    const { recorder, user, membership } = await deployFixture();
    await membership
      .connect(recorder)
      .recordConsumption(
        user.address,
        ethers.parseEther("9000"),
        ethers.id("before-expiry")
      );
    const before = await membership.getMember(user.address);
    await time.increase(180 * 24 * 60 * 60 + 1);

    expect(await membership.effectiveLevelOf(user.address)).to.equal(0);
    expect(await membership.rewardBasisPointsOf(user.address)).to.equal(0);

    await expect(
      membership
        .connect(recorder)
        .recordConsumption(user.address, ethers.parseEther("1"), ethers.id("after-expiry"))
    )
      .to.emit(membership, "MembershipExpired")
      .withArgs(user.address, 1, 2, before.lifetimeSpend, before.expiresAt);

    const after = await membership.getMember(user.address);
    expect(after.currentQualifyingSpend).to.equal(ethers.parseEther("1"));
    expect(after.lifetimeSpend).to.equal(ethers.parseEther("9001"));
    expect(after.level).to.equal(1);
    expect(after.tokenId).to.equal(1);
  });

  it("supports audited admin restore, explicit upgrade, and wallet migration", async function () {
    const { recorder, operator, user, other, membership } = await deployFixture();
    const now = await time.latest();
    const restoreCase = ethers.id("restore-case-1");
    const currentSpend = ethers.parseEther("48000");
    const lifetimeSpend = ethers.parseEther("60000");

    await expect(
      membership
        .connect(operator)
        .adminSetMembership(
          user.address,
          3,
          currentSpend,
          lifetimeSpend,
          now,
          restoreCase
        )
    )
      .to.emit(membership, "MembershipRestored")
      .withArgs(
        restoreCase,
        user.address,
        1,
        3,
        currentSpend,
        lifetimeSpend,
        now,
        now + 180 * 24 * 60 * 60
      );

    await expect(
      membership
        .connect(operator)
        .adminSetMembership(user.address, 3, currentSpend, lifetimeSpend, now, restoreCase)
    )
      .to.be.revertedWithCustomError(membership, "AdminCaseAlreadyUsed")
      .withArgs(restoreCase);

    const migrationCase = ethers.id("wallet-migration-case-1");
    await expect(
      membership
        .connect(operator)
        .adminMigrateMembership(
          user.address,
          other.address,
          3,
          currentSpend,
          lifetimeSpend,
          now,
          migrationCase
        )
    )
      .to.emit(membership, "MembershipMigrated")
      .withArgs(
        migrationCase,
        user.address,
        other.address,
        1,
        2,
        3,
        currentSpend,
        lifetimeSpend,
        now,
        now + 180 * 24 * 60 * 60
      );

    await expect(membership.ownerOf(1)).to.be.reverted;
    expect(await membership.ownerOf(2)).to.equal(other.address);
    expect(await membership.memberMigratedTo(user.address)).to.equal(other.address);
    await expect(
      membership
        .connect(recorder)
        .recordConsumption(user.address, 1, ethers.id("old-wallet-blocked"))
    )
      .to.be.revertedWithCustomError(membership, "MembershipAlreadyMigrated")
      .withArgs(user.address, other.address);
  });

  it("rejects inconsistent imported levels and occupied migration targets", async function () {
    const { recorder, operator, user, other, membership } = await deployFixture();
    const now = await time.latest();
    await expect(
      membership
        .connect(operator)
        .adminSetMembership(
          user.address,
          3,
          ethers.parseEther("9000"),
          ethers.parseEther("9000"),
          now,
          ethers.id("bad-level")
        )
    ).to.be.revertedWithCustomError(membership, "InvalidMemberState");

    await expect(
      membership
        .connect(operator)
        .adminSetMembership(
          user.address,
          1,
          1,
          1,
          now + 3600,
          ethers.id("future-activity")
        )
    ).to.be.revertedWithCustomError(membership, "InvalidMemberState");

    await membership
      .connect(recorder)
      .recordConsumption(other.address, 1, ethers.id("target-existing"));
    await expect(
      membership
        .connect(operator)
        .adminMigrateMembership(
          user.address,
          other.address,
          0,
          0,
          0,
          0,
          ethers.id("occupied-target")
        )
    )
      .to.be.revertedWithCustomError(membership, "MigrationTargetHasMembership")
      .withArgs(other.address);
  });
});
