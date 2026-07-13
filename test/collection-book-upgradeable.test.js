const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

async function deployFixture() {
  const [admin, user, other] = await ethers.getSigners();

  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();

  const PrizeSource = await ethers.getContractFactory("contracts/test/MockPrizeSource.sol:MockPrizeSource");
  const source = await PrizeSource.deploy();
  await source.waitForDeployment();

  const Book = await ethers.getContractFactory(
    "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable"
  );
  const book = await upgrades.deployProxy(
    Book,
    [await points.getAddress()],
    { initializer: "initialize", kind: "uups" }
  );
  await book.waitForDeployment();

  return { admin, user, other, points, source, book };
}

async function createOneSlotBook(book, source, rewardKind = 1, rewardData = ethers.parseEther("10")) {
  await book.createBook(
    "A Book",
    [{ sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 1 }],
    rewardKind,
    rewardData,
    true
  );
}

async function mintAndApprove(source, book, user, prizeId = 1) {
  const tokenId = await source.nextTokenId();
  await source.mintRevealed(user.address, 0, prizeId, false);
  await source.connect(user).approve(await book.getAddress(), tokenId);
  return tokenId;
}

describe("CollectionBookUpgradeable proxy", function () {
  it("deploys through a UUPS proxy and initializes official ops roles", async function () {
    const { admin, points, book } = await deployFixture();

    expect(await book.doudoPoints()).to.equal(await points.getAddress());
    expect(await book.hasRole(await book.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await book.hasRole(await book.UPGRADER_ROLE(), admin.address)).to.equal(true);
    expect(await book.hasRole(await book.OPERATION_ROLE(), admin.address)).to.equal(true);
  });

  it("rejects re-initialization and requires UPGRADER_ROLE for upgrades", async function () {
    const { user, points, book } = await deployFixture();
    await expect(book.initialize(await points.getAddress())).to.be.reverted;

    const proxyAddress = await book.getAddress();
    const UpgradeAsUser = await ethers.getContractFactory(
      "contracts/test/CollectionBookUpgradeableV2Mock.sol:CollectionBookUpgradeableV2Mock",
      user
    );
    await expect(upgrades.upgradeProxy(proxyAddress, UpgradeAsUser)).to.be.reverted;

    const UpgradeAsAdmin = await ethers.getContractFactory(
      "contracts/test/CollectionBookUpgradeableV2Mock.sol:CollectionBookUpgradeableV2Mock"
    );
    const upgraded = await upgrades.upgradeProxy(proxyAddress, UpgradeAsAdmin);
    expect(await upgraded.version()).to.equal("collection-book-v2-mock");
  });
});

describe("CollectionBookUpgradeable events and flows", function () {
  it("creates books and emits subgraph-specific definition events", async function () {
    const { source, book } = await deployFixture();
    const slots = [
      { sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 2 },
      { sourceContract: await source.getAddress(), seriesID: 1, prizeId: 5, quantity: 1 },
    ];

    await expect(book.createBook("Dragon Set", slots, 1, ethers.parseEther("100"), true))
      .to.emit(book, "CollectionBookSlotDefined")
      .withArgs(0, 0, await source.getAddress(), 0, 1, 2)
      .and.to.emit(book, "CollectionBookCreated")
      .withArgs(0, "Dragon Set", 1, ethers.parseEther("100"), true);

    const firstSlot = await book.bookSlots(0, 0);
    expect(firstSlot.seriesID).to.equal(0);
    expect(firstSlot.prizeId).to.equal(1);
    expect(await book.totalRequired(0)).to.equal(3);
  });

  it("updates book active status with a subgraph-specific event", async function () {
    const { source, book } = await deployFixture();
    await createOneSlotBook(book, source);

    await expect(book.setBookActive(0, false))
      .to.emit(book, "CollectionBookStatusUpdated")
      .withArgs(0, false);

    const stored = await book.books(0);
    expect(stored.active).to.equal(false);
  });

  it("fills and empties collection slots with indexed events", async function () {
    const { user, other, source, book } = await deployFixture();
    await createOneSlotBook(book, source);
    const tokenId = await mintAndApprove(source, book, user);

    await expect(book.connect(user).depositToBook(0, [tokenId]))
      .to.emit(book, "CollectionBookSlotFilled")
      .withArgs(user.address, 0, 0, await source.getAddress(), tokenId, 1);

    expect(await book.filledCount(user.address, 0)).to.equal(1);
    expect(await source.ownerOf(tokenId)).to.equal(await book.getAddress());

    await expect(
      book.recoverUntrackedERC721(await source.getAddress(), tokenId, other.address)
    ).to.be.revertedWithCustomError(book, "TrackedERC721");
    await expect(book.connect(other).withdrawDeposited(0, await source.getAddress(), [tokenId]))
      .to.be.revertedWithCustomError(book, "TokenDepositedByAnotherUser");

    await expect(book.connect(user).withdrawDeposited(0, await source.getAddress(), [tokenId]))
      .to.emit(book, "CollectionBookSlotEmptied")
      .withArgs(user.address, 0, 0, await source.getAddress(), tokenId, 0);

    expect(await book.filledCount(user.address, 0)).to.equal(0);
    expect(await source.ownerOf(tokenId)).to.equal(user.address);
  });

  it("rejects ERC721 transfers that do not come through depositToBook", async function () {
    const { user, source, book } = await deployFixture();
    const tokenId = await source.nextTokenId();
    await source.mintRevealed(user.address, 0, 1, false);

    await expect(
      source
        .connect(user)
        ["safeTransferFrom(address,address,uint256)"](
          user.address,
          await book.getAddress(),
          tokenId
        )
    ).to.be.revertedWithCustomError(book, "UnexpectedERC721Transfer");
    expect(await source.ownerOf(tokenId)).to.equal(user.address);
  });

  it("recovers untracked NFTs sent with unsafe transferFrom without touching deposits", async function () {
    const { user, source, book } = await deployFixture();
    const tokenId = await source.nextTokenId();
    await source.mintRevealed(user.address, 0, 1, false);
    await source.connect(user).transferFrom(user.address, await book.getAddress(), tokenId);

    await expect(
      book.recoverUntrackedERC721(await source.getAddress(), tokenId, user.address)
    )
      .to.emit(book, "UntrackedERC721Recovered")
      .withArgs(await source.getAddress(), tokenId, user.address);
    expect(await source.ownerOf(tokenId)).to.equal(user.address);
  });

  it("claims point rewards once and emits CollectionBookClaimed", async function () {
    const { user, points, source, book } = await deployFixture();
    await points.grantRole(await points.MINTER_ROLE(), await book.getAddress());
    await createOneSlotBook(book, source, 1, ethers.parseEther("50"));
    const tokenId = await mintAndApprove(source, book, user);
    await book.connect(user).depositToBook(0, [tokenId]);

    await expect(book.connect(user).claimBook(0))
      .to.emit(book, "CollectionBookClaimed")
      .withArgs(user.address, 0, 1, ethers.parseEther("50"));

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("50"));
    await expect(book.connect(user).claimBook(0)).to.be.revertedWithCustomError(book, "BookAlreadyClaimed");
  });

  it("rejects claims for book IDs that were never created", async function () {
    const { user, book } = await deployFixture();

    await expect(book.connect(user).claimBook(0))
      .to.be.revertedWithCustomError(book, "BookDoesNotExist");
    await expect(book.connect(user).claimBook(999))
      .to.be.revertedWithCustomError(book, "BookDoesNotExist");
  });

  it("updates reward target and routes NFT/unlock rewards", async function () {
    const { user, source, book } = await deployFixture();
    const RewardTarget = await ethers.getContractFactory("contracts/test/MockCollectionRewardMinter.sol:MockCollectionRewardMinter");
    const rewardTarget = await RewardTarget.deploy();
    await rewardTarget.waitForDeployment();

    await expect(book.setDoudochainV2RewardTarget(await rewardTarget.getAddress()))
      .to.emit(book, "CollectionBookRewardTargetUpdated")
      .withArgs(await rewardTarget.getAddress());

    await createOneSlotBook(book, source, 0, 9001);
    const nftTokenId = await mintAndApprove(source, book, user);
    await book.connect(user).depositToBook(0, [nftTokenId]);
    await expect(book.connect(user).claimBook(0))
      .to.emit(rewardTarget, "MockCollectionRewardMinted")
      .withArgs(user.address, 9001);

    await book.createBook(
      "Unlock Book",
      [{ sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 1 }],
      2,
      7,
      true
    );
    const unlockTokenId = await mintAndApprove(source, book, user);
    await book.connect(user).depositToBook(1, [unlockTokenId]);
    await expect(book.connect(user).claimBook(1))
      .to.emit(rewardTarget, "MockSeriesUnlocked")
      .withArgs(user.address, 7);
  });
});
