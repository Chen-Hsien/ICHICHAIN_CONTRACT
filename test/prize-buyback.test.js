const { expect } = require("chai");
const { ethers, upgrades, artifacts } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const authorizationTypes = {
  BuybackAuthorization: [
    { name: "batchId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "coreAddress", type: "address" },
    { name: "itemsHash", type: "bytes32" },
    { name: "quoteHash", type: "bytes32" },
    { name: "totalPoints", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

async function fixture() {
  const [admin, buyer, other] = await ethers.getSigners();
  const libraries = {};
  for (const name of ["DoudoPrizeDrawLib", "DoudoTokenURILib"]) {
    const library = await (await ethers.getContractFactory(name)).deploy();
    libraries[name] = await library.getAddress();
  }
  const Core = await ethers.getContractFactory("DOUDOCHAINV2CoreUpgradeable", { libraries });
  const core = await upgrades.deployProxy(Core, [admin.address, admin.address], {
    kind: "uups", unsafeAllowLinkedLibraries: true,
  });
  const ops = await upgrades.deployProxy(
    await ethers.getContractFactory("DoudoSeriesOpsModuleUpgradeable"),
    [await core.getAddress()], { kind: "uups" },
  );
  await core.setSeriesOpsModule(await ops.getAddress());
  await core.createSeriesWithSubPrizes({
    seriesName: "Buyback", totalTicketNumbers: 60, priceInPoints: 100,
    priceInTWD: 100, estimateDeliverTime: (await time.latest()) + 86400,
    exchangeTokenURI: "ipfs://exchange/", unrevealTokenURI: "ipfs://unrevealed/",
    revealTokenURI: "ipfs://revealed/", seriesMetaDataURI: "ipfs://series",
    isPreOrder: true, useLuckyNumber: false, maxPerWallet: 0, packingType: 0, sourceType: 0,
  }, [{ subPrizeID: 1, prizeGroup: "C", subPrizeName: "Small prize", subPrizeRemainingQuantity: 60 }], false);
  await core.grantRole(await core.MODULE_ROLE(), admin.address);
  await core.setSeriesMetadata(0, "ipfs://exchange/", "ipfs://unrevealed/", "ipfs://revealed/", "ipfs://series", (await time.latest()) + 86400 * 61);
  await ops.seedSeriesConfig(0, 0, true); // Explicit operational reveal enablement, before arrival.
  await core.moduleMintRevealed(buyer.address, 0, 1);
  const module = await upgrades.deployProxy(
    await ethers.getContractFactory("DoudoPrizeBuybackModuleUpgradeable"),
    [await core.getAddress(), admin.address], { kind: "uups" },
  );
  await core.grantRole(await core.MODULE_ROLE(), await module.getAddress());
  const tokenIds = [0n];
  const points = [ethers.parseEther("30")];
  const auth = {
    batchId: ethers.id("buyback-1"), buyer: buyer.address,
    coreAddress: await core.getAddress(),
    itemsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]", "uint256[]"], [tokenIds, points])),
    quoteHash: ethers.id("immutable quote"), totalPoints: ethers.parseEther("30"),
    deadline: (await time.latest()) + 300,
  };
  const domain = { name: "DOUDO Prize Buyback", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await module.getAddress() };
  const signature = await admin.signTypedData(domain, authorizationTypes, auth);
  return { admin, buyer, other, core, module, tokenIds, points, auth, signature, domain };
}

describe("Prize buyback", function () {
  async function signed(f, changes = {}, tokenIds = f.tokenIds, points = f.points) {
    const auth = { ...f.auth, ...changes,
      itemsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]", "uint256[]"], [tokenIds, points])),
    };
    return [auth, tokenIds, points, await f.admin.signTypedData(f.domain, authorizationTypes, auth)];
  }

  it("keeps both implementations within the EIP-170 deployment limit", async function () {
    for (const name of ["DOUDOCHAINV2CoreUpgradeable", "DoudoPrizeBuybackModuleUpgradeable"]) {
      expect(((await artifacts.readArtifact(name)).deployedBytecode.length - 2) / 2, name).to.be.at.most(24576);
    }
  });

  it("burns one revealed prize before delivery and emits the exact points entitlement without minting replacement NFTs", async function () {
    const f = await loadFixture(fixture);
    expect(await f.core.ownerOf(0)).to.equal(f.buyer.address);
    await expect(f.module.connect(f.buyer).buyback(f.auth, f.tokenIds, f.points, f.signature))
      .to.emit(f.module, "PrizeBuybackBurned")
      .withArgs(f.auth.batchId, f.buyer.address, await f.core.getAddress(), f.tokenIds, f.points, ethers.parseEther("30"), f.auth.quoteHash);
    await expect(f.core.ownerOf(0)).to.be.reverted;
    expect(await f.core.balanceOf(f.buyer.address)).to.equal(0);
    expect((await f.core.seriesMintConfig(0))[2]).to.equal(60);
    expect(await f.module.consumed(f.auth.batchId)).to.equal(true);
  });

  it("rejects a replay and a different caller", async function () {
    const f = await loadFixture(fixture);
    const args = await signed(f);
    await expect(f.module.connect(f.other).buyback(...args)).to.be.revertedWithCustomError(f.module, "InvalidAuthorization");
    await f.module.connect(f.buyer).buyback(...args);
    await expect(f.module.connect(f.buyer).buyback(...args)).to.be.revertedWithCustomError(f.module, "InvalidAuthorization");
  });

  it("rejects an expired quote, changed price and unauthorized signer", async function () {
    const f = await loadFixture(fixture);
    await expect(f.module.connect(f.buyer).buyback(...await signed(f, { deadline: (await time.latest()) - 1 }))).to.be.reverted;
    await expect(f.module.connect(f.buyer).buyback(f.auth, f.tokenIds, [31n], f.signature)).to.be.reverted;
    const forged = await f.other.signTypedData(f.domain, authorizationTypes, f.auth);
    await expect(f.module.connect(f.buyer).buyback(f.auth, f.tokenIds, f.points, forged)).to.be.reverted;
    expect(await f.core.ownerOf(0)).to.equal(f.buyer.address);
  });

  it("rejects duplicate tokens, zero credit and empty batches", async function () {
    const f = await loadFixture(fixture);
    for (const [ids, points] of [[[0n, 0n], [15n, 15n]], [[0n], [0n]], [[], []]]) {
      await expect(f.module.connect(f.buyer).buyback(...await signed(f, { totalPoints: points.reduce((a, b) => a + b, 0n) }, ids, points))).to.be.reverted;
    }
    expect(await f.module.consumed(f.auth.batchId)).to.equal(false);
  });

  it("rolls back all burns when a later token is not owned by the buyer", async function () {
    const f = await loadFixture(fixture);
    await f.core.moduleMintRevealed(f.other.address, 0, 1);
    await expect(f.module.connect(f.buyer).buyback(...await signed(f, { totalPoints: 40n }, [0n, 1n], [30n, 10n]))).to.be.reverted;
    expect(await f.core.ownerOf(0)).to.equal(f.buyer.address);
    expect(await f.module.consumed(f.auth.batchId)).to.equal(false);
  });

  it("rejects an exchanged NFT and an expired NFT even with a fresh signed quote", async function () {
    const f = await loadFixture(fixture);
    await f.core.connect(f.buyer).exchangePrize([0]);
    await expect(f.module.connect(f.buyer).buyback(...await signed(f))).to.be.reverted;
    await f.core.moduleMintRevealed(f.buyer.address, 0, 1);
    await time.increase(86400 * 62);
    await expect(f.module.connect(f.buyer).buyback(...await signed(f, { deadline: (await time.latest()) + 300 }, [1n], f.points))).to.be.reverted;
  });

  it("pauses execution and revokes signer authority", async function () {
    const f = await loadFixture(fixture);
    await f.module.pause();
    await expect(f.module.connect(f.buyer).buyback(...await signed(f))).to.be.revertedWithCustomError(f.module, "ContractPaused");
    await f.module.unpause();
    await f.module.revokeRole(await f.module.AUTHORIZER_ROLE(), f.admin.address);
    await expect(f.module.connect(f.buyer).buyback(...await signed(f))).to.be.revertedWithCustomError(f.module, "InvalidAuthorization");
  });

  it("burns a full 50-token batch within a bounded gas budget", async function () {
    const f = await loadFixture(fixture);
    for (let i = 1; i < 50; i++) await f.core.moduleMintRevealed(f.buyer.address, 0, 1);
    const ids = Array.from({ length: 50 }, (_, i) => BigInt(i));
    const points = ids.map(() => 30n);
    const tx = await f.module.connect(f.buyer).buyback(...await signed(f, { totalPoints: 1500n }, ids, points));
    expect((await tx.wait()).gasUsed).to.be.lessThan(5000000n);
    expect(await f.core.balanceOf(f.buyer.address)).to.equal(0);
    expect((await f.core.seriesMintConfig(0))[2]).to.equal(60);
  });
});
