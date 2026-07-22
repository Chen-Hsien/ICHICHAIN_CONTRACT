const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DoudoPointsBudgetIssuer", function () {
  async function deployFixture() {
    const [admin, operator, user] = await ethers.getSigners();
    const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const points = await Points.deploy(admin.address, admin.address);
    await points.waitForDeployment();

    const Issuer = await ethers.getContractFactory("contracts/DoudoPointsBudgetIssuer.sol:DoudoPointsBudgetIssuer");
    const issuer = await Issuer.deploy(await points.getAddress(), admin.address);
    await issuer.waitForDeployment();
    await points.grantRole(await points.MINTER_ROLE(), await issuer.getAddress());
    await issuer.grantRole(await issuer.OPERATOR_ROLE(), operator.address);
    return { admin, operator, user, points, issuer };
  }

  it("issues rewards within a source budget and rejects over-issuance", async function () {
    const { operator, user, points, issuer } = await deployFixture();
    const source = ethers.id("REFERRAL_REWARD");
    await issuer.setBudget(source, ethers.parseEther("1000"));

    await expect(issuer.connect(operator).issue(user.address, ethers.parseEther("100"), source))
      .to.emit(issuer, "BudgetedPointsIssued")
      .withArgs(user.address, ethers.parseEther("100"), source, operator.address);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
    expect(await issuer.issued(source)).to.equal(ethers.parseEther("100"));
    await expect(
      issuer.connect(operator).issue(user.address, ethers.parseEther("1001"), source)
    ).to.be.revertedWithCustomError(issuer, "BudgetExceeded");
  });
});
