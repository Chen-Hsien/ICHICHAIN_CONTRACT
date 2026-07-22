const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DOUDOCOIN soulbound points", function () {
  async function deployToken() {
    const [admin, minter, burner, user, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const token = await Token.deploy(admin.address, minter.address);
    await token.waitForDeployment();
    const burnerRole = await token.BURNER_ROLE();
    await token.connect(admin).grantRole(burnerRole, burner.address);
    return { token, admin, minter, burner, user, other };
  }

  it("allows minting but blocks wallet-to-wallet transfer", async function () {
    const { token, minter, user, other } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));

    await expect(
      token.connect(user).transfer(other.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(token, "NonTransferable");
  });

  it("blocks transferFrom even when an allowance exists", async function () {
    const { token, minter, user, other } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));
    await token.connect(user).approve(other.address, ethers.parseEther("1"));

    await expect(
      token.connect(other).transferFrom(user.address, other.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(token, "NonTransferable");
  });

  it("allows BURNER_ROLE to burn user points without allowance", async function () {
    const { token, minter, burner, user } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));

    await token.connect(burner).burnFrom(user.address, ethers.parseEther("25"));

    expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("75"));
  });

  it("rejects burnFrom from non-burners", async function () {
    const { token, minter, user, other } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));

    await expect(
      token.connect(other).burnFrom(user.address, ethers.parseEther("1"))
    ).to.be.reverted;
  });

  it("emits reason-coded mint and burn events", async function () {
    const { token, minter, burner, user } = await deployToken();
    const purchaseReason = ethers.id("PURCHASE");
    const spendReason = ethers.id("LOTTERY_MINT");

    await expect(token.connect(minter).mintWithReason(user.address, ethers.parseEther("100"), purchaseReason))
      .to.emit(token, "PointsMinted")
      .withArgs(user.address, ethers.parseEther("100"), purchaseReason, minter.address);

    await expect(token.connect(burner).burnFromWithReason(user.address, ethers.parseEther("40"), spendReason))
      .to.emit(token, "PointsBurned")
      .withArgs(user.address, ethers.parseEther("40"), spendReason, burner.address);
  });
});
