const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DOUDOCOINNFT callback safety", function () {
  async function deployFixture() {
    const [admin, user, other] = await ethers.getSigners();

    const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const points = await Points.deploy(admin.address, admin.address);
    await points.waitForDeployment();

    const NFT = await ethers.getContractFactory("contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT");
    const nft = await NFT.deploy(await points.getAddress(), admin.address, admin.address);
    await nft.waitForDeployment();

    const Receiver = await ethers.getContractFactory(
      "contracts/test/ReentrantDOUDOCOINNFTReceiver.sol:ReentrantDOUDOCOINNFTReceiver"
    );
    const receiver = await Receiver.deploy(await nft.getAddress());
    await receiver.waitForDeployment();

    return { admin, user, other, nft, receiver };
  }

  it("initializes membership state before the mint callback and blocks reentrant minting", async function () {
    const { nft, receiver } = await deployFixture();
    const receiverAddress = await receiver.getAddress();
    await nft.grantRole(await nft.MINTER_ROLE(), receiverAddress);
    await receiver.configure(1, ethers.ZeroAddress);

    await nft.mintMembershipNFT(receiverAddress, 2);

    const info = await nft.userInfo(receiverAddress);
    expect(await receiver.callbackCount()).to.equal(1);
    expect(await receiver.membershipFlagDuringCallback()).to.equal(true);
    expect(await receiver.membershipNFTDuringCallback()).to.equal(info.membershipNFT);
    expect(await receiver.membershipLevelDuringCallback()).to.equal(2);
    expect(await receiver.reentrySucceeded()).to.equal(false);
    expect(await nft.ownerOf(info.membershipNFT)).to.equal(receiverAddress);
  });

  it("settles transfer state before the receiver callback and blocks token forwarding", async function () {
    const { user, other, nft, receiver } = await deployFixture();
    const receiverAddress = await receiver.getAddress();
    await nft.mintMembershipNFT(user.address, 2);
    const originalInfo = await nft.userInfo(user.address);
    const tokenId = originalInfo.membershipNFT;
    await receiver.configure(2, other.address);

    await nft
      .connect(user)
      ["safeTransferFrom(address,address,uint256)"](user.address, receiverAddress, tokenId);

    const senderInfo = await nft.userInfo(user.address);
    const receiverInfo = await nft.userInfo(receiverAddress);
    expect(await receiver.callbackCount()).to.equal(1);
    expect(await receiver.membershipFlagDuringCallback()).to.equal(true);
    expect(await receiver.membershipNFTDuringCallback()).to.equal(tokenId);
    expect(await receiver.membershipLevelDuringCallback()).to.equal(2);
    expect(await receiver.reentrySucceeded()).to.equal(false);
    expect(senderInfo.membershipNFT).to.equal(0);
    expect(senderInfo.membershipLevel).to.equal(0);
    expect(senderInfo.lastActiveTimestamp).to.equal(0);
    expect(receiverInfo.membershipNFT).to.equal(tokenId);
    expect(receiverInfo.membershipLevel).to.equal(2);
    expect(await nft.ownerOf(tokenId)).to.equal(receiverAddress);
  });

  it("does not destroy membership accounting on a self-transfer", async function () {
    const { user, nft } = await deployFixture();
    await nft.mintMembershipNFT(user.address, 2);
    const before = await nft.userInfo(user.address);

    await nft.connect(user).transferFrom(user.address, user.address, before.membershipNFT);

    const after = await nft.userInfo(user.address);
    expect(after.totalRedeemed).to.equal(before.totalRedeemed);
    expect(after.currentRoundRedeemed).to.equal(before.currentRoundRedeemed);
    expect(after.membershipLevel).to.equal(before.membershipLevel);
    expect(after.membershipNFT).to.equal(before.membershipNFT);
    expect(await nft.ownerOf(after.membershipNFT)).to.equal(user.address);
  });

  it("conserves redeemed totals when membership state moves between wallets", async function () {
    const { user, other, nft } = await deployFixture();
    await nft.mintMembershipNFT(user.address, 2);
    const original = await nft.userInfo(user.address);

    await nft.connect(user).transferFrom(user.address, other.address, original.membershipNFT);
    let senderInfo = await nft.userInfo(user.address);
    let receiverInfo = await nft.userInfo(other.address);
    expect(senderInfo.totalRedeemed).to.equal(0);
    expect(receiverInfo.totalRedeemed).to.equal(original.totalRedeemed);

    await nft
      .connect(other)
      .transferFrom(other.address, user.address, receiverInfo.membershipNFT);
    senderInfo = await nft.userInfo(user.address);
    receiverInfo = await nft.userInfo(other.address);
    expect(senderInfo.totalRedeemed).to.equal(original.totalRedeemed);
    expect(receiverInfo.totalRedeemed).to.equal(0);
  });

  it("clears voucher mappings on burn and prevents membership NFTs from bypassing reconciliation", async function () {
    const { user, nft } = await deployFixture();
    await nft.createVoucherType(1, 10, "ipfs://voucher-zero");
    await nft.createVoucherType(2, 10, "ipfs://voucher-one");
    await nft.mintVouchers(user.address, [1], [1]);

    expect(await nft.voucherTypeIds(1)).to.equal(1);
    await nft.connect(user).burn(1);
    expect(await nft.voucherTypeIds(1)).to.equal(0);

    await nft.mintMembershipNFT(user.address, 1);
    const info = await nft.userInfo(user.address);
    await expect(nft.connect(user).burn(info.membershipNFT))
      .to.be.revertedWith("Cannot burn membership NFTs");
  });

  it("rejects metadata queries for nonexistent tokens and invalid reward rates", async function () {
    const { nft } = await deployFixture();

    await expect(nft.tokenURI(999)).to.be.revertedWith("ERC721: invalid token ID");
    await expect(nft.addMembershipLevel("Unsafe", 1, "ipfs://unsafe", 10001))
      .to.be.revertedWith("Invalid reward basis points");
  });
});
