const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FixedProbabilityLotteryV3", function () {
  async function fixture() {
    const [admin, signer, operator, buyer, other] = await ethers.getSigners();
    const Router = await ethers.getContractFactory(
      "FixedProbabilityV3RouterMock"
    );
    const router = await Router.deploy();
    const Membership = await ethers.getContractFactory(
      "FixedProbabilityV3MembershipMock"
    );
    const membership = await Membership.deploy();
    const Lottery = await ethers.getContractFactory(
      "FixedProbabilityLotteryV3"
    );
    const lottery = await Lottery.deploy(
      await router.getAddress(),
      signer.address,
      operator.address,
      await membership.getAddress()
    );
    await Promise.all([
      router.waitForDeployment(),
      membership.waitForDeployment(),
      lottery.waitForDeployment(),
    ]);

    const config = {
      pricePoints: ethers.parseEther("100"),
      drawCap: 0,
      maxBatchSize: 10,
      prizeIds: [1, 2, 3],
      weights: [2000, 3000, 5000],
      discountQuantities: [5, 10],
      discountPoints: [ethers.parseEther("50"), ethers.parseEther("100")],
      freeOrderMode: 2,
      freeOrderFirstDraws: 0,
      freeOrderPrizeIds: [1],
      gateMode: 1,
      minMemberLevel: 2,
      eligibilityPolicyId: ethers.ZeroHash,
      eligibilityScope: ethers.ZeroHash,
      maxEligibleDraws: 0,
      contentHash: ethers.keccak256(ethers.toUtf8Bytes("series manifest")),
      contentURI: "ipfs://series-v3.json",
    };
    await lottery.connect(operator).createSeries(config);
    await lottery.connect(operator).setSeriesStatus(1, 2);
    return {
      admin,
      signer,
      operator,
      buyer,
      other,
      router,
      membership,
      lottery,
    };
  }

  async function authorizationFor(f, overrides = {}) {
    const quantity = overrides.quantity ?? 5;
    const [grossPoints, rebatePoints, netPoints] = await f.lottery.quoteOrder(
      1,
      quantity
    );
    const authorization = {
      authorizationId:
        overrides.authorizationId ?? ethers.keccak256(ethers.randomBytes(32)),
      buyer: f.buyer.address,
      seriesId: 1,
      configHash: (await f.lottery.getSeries(1)).configHash,
      quantity,
      grossPoints,
      rebatePoints,
      netPoints,
      freeOrderChallenge: overrides.freeOrderChallenge ?? false,
      eligibilityKey: ethers.ZeroHash,
      deadline: await time.latest().then((now) => now + 3600),
    };
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const signature = await f.signer.signTypedData(
      {
        name: "FixedProbabilityLottery",
        version: "3",
        chainId,
        verifyingContract: await f.lottery.getAddress(),
      },
      {
        DrawAuthorization: [
          { name: "authorizationId", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "seriesId", type: "uint256" },
          { name: "configHash", type: "bytes32" },
          { name: "quantity", type: "uint16" },
          { name: "grossPoints", type: "uint256" },
          { name: "rebatePoints", type: "uint256" },
          { name: "netPoints", type: "uint256" },
          { name: "freeOrderChallenge", type: "bool" },
          { name: "eligibilityKey", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      authorization
    );
    return { authorization, signature };
  }

  it("mints one NFT per draw at checkout and reveals those NFTs in the VRF callback", async function () {
    const f = await fixture();
    const { authorization, signature } = await authorizationFor(f);

    await expect(
      f.lottery.connect(f.buyer).requestDraws(authorization, signature)
    )
      .to.emit(f.lottery, "TicketPurchaseMinted")
      .withArgs(1, f.buyer.address, 5, ethers.parseEther("500"), false, 1)
      .and.to.emit(f.lottery, "DatabasePointsRebateEntitled")
      .withArgs(
        authorization.authorizationId,
        1,
        f.buyer.address,
        ethers.parseEther("50")
      );

    expect(await f.lottery.balanceOf(f.buyer.address)).to.equal(5);
    expect(await f.lottery.ownerOf(1)).to.equal(f.buyer.address);
    expect(await f.membership.recordedPoints()).to.equal(
      ethers.parseEther("450")
    );
    const beforeReveal = await f.lottery.getDraw(1);
    expect(beforeReveal.tokenId).to.equal(1);
    expect(beforeReveal.prizeId).to.equal(0);

    await expect(f.router.fulfill(1, [1999, 2000, 4999, 5000, 9999]))
      .to.emit(f.lottery, "OrderSettled")
      .withArgs(1, false, 65535, 0);

    expect((await f.lottery.getDraw(1)).prizeId).to.equal(1);
    expect((await f.lottery.getDraw(2)).prizeId).to.equal(2);
    expect((await f.lottery.getDraw(4)).prizeId).to.equal(3);
    expect(await f.lottery.ownerOf(1)).to.equal(f.buyer.address);
  });

  it("keeps exchange as the only buyer action after reveal", async function () {
    const f = await fixture();
    const { authorization, signature } = await authorizationFor(f, {
      quantity: 1,
    });
    await f.lottery.connect(f.buyer).requestDraws(authorization, signature);
    await expect(
      f.lottery.connect(f.buyer).exchangePrize([1])
    ).to.be.revertedWithCustomError(f.lottery, "TokenNotRevealed");
    await f.router.fulfill(1, [5000]);
    await expect(
      f.lottery.connect(f.other).exchangePrize([1])
    ).to.be.revertedWithCustomError(f.lottery, "NotTheTokenOwner");
    await expect(f.lottery.connect(f.buyer).exchangePrize([1]))
      .to.emit(f.lottery, "UpdateTicketStatus")
      .withArgs(1, 1, 3, true, true);
    expect((await f.lottery.getDraw(1)).exchanged).to.equal(true);
  });

  it("refunds the net charge once when the VRF result wins the free-order challenge", async function () {
    const f = await fixture();
    const { authorization, signature } = await authorizationFor(f, {
      quantity: 5,
      freeOrderChallenge: true,
    });
    await f.lottery.connect(f.buyer).requestDraws(authorization, signature);
    await f.router.fulfill(1, [9000, 100, 9000, 9000, 9000]);

    await expect(f.lottery.finalizeOrderAccounting(1))
      .to.emit(f.lottery, "DatabasePointsFreeOrderChallengeRefunded")
      .withArgs(1, 1, f.buyer.address, ethers.parseEther("450"));
    expect(await f.membership.reversedPoints()).to.equal(
      ethers.parseEther("450")
    );
    await expect(
      f.lottery.finalizeOrderAccounting(1)
    ).to.be.revertedWithCustomError(f.lottery, "AccountingAlreadyFinalized");
  });
});
