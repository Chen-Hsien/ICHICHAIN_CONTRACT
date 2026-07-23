import { ethers, upgrades } from "hardhat";

const DOUDOCOIN =
  process.env.DOUDO_POINTS_ADDRESS ||
  "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";

const DOUDOCOIN_ABI = [
  "function MINTER_ROLE() external view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

const DOUDOCOINNFT_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function rewardToken() external view returns (address)",
  "function membershipLevels(uint256 index) external view returns (string name, uint256 threshold, string membershipTokenURI, uint256 rewardBasisPoints)",
  "function DEFAULT_ADMIN_ROLE() external view returns (bytes32)",
  "function MINTER_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Deployer:", deployerAddress);
  console.log("Deployer ETH balance:", ethers.formatEther(balance));
  console.log("Reward token:", DOUDOCOIN);

  const factory = await ethers.getContractFactory(
    "contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT"
  );
  const doudocoinNft = await upgrades.deployProxy(
    factory,
    [DOUDOCOIN, deployerAddress, deployerAddress],
    { initializer: "initialize", kind: "uups" }
  );
  await doudocoinNft.waitForDeployment();

  const doudocoinNftAddress = await doudocoinNft.getAddress();
  console.log("DOUDOCOINNFT UUPS proxy deployed to:", doudocoinNftAddress);
  console.log(
    "Implementation:",
    await upgrades.erc1967.getImplementationAddress(doudocoinNftAddress)
  );

  const doudocoin = await ethers.getContractAt(DOUDOCOIN_ABI, DOUDOCOIN);
  const doudocoinMinterRole = await doudocoin.MINTER_ROLE();
  const alreadyRewardMinter = await doudocoin.hasRole(
    doudocoinMinterRole,
    doudocoinNftAddress
  );

  if (!alreadyRewardMinter) {
    const grantTx = await doudocoin.grantRole(
      doudocoinMinterRole,
      doudocoinNftAddress
    );
    console.log("Grant DOUDOCOIN MINTER_ROLE tx:", grantTx.hash);
    await grantTx.wait();
  } else {
    console.log("DOUDOCOINNFT already has DOUDOCOIN MINTER_ROLE");
  }

  const deployed = await ethers.getContractAt(
    DOUDOCOINNFT_ABI,
    doudocoinNftAddress
  );
  const nftAdminRole = await deployed.DEFAULT_ADMIN_ROLE();
  const nftMinterRole = await deployed.MINTER_ROLE();
  const commonLevel = await deployed.membershipLevels(1);

  console.log("name:", await deployed.name());
  console.log("symbol:", await deployed.symbol());
  console.log("rewardToken:", await deployed.rewardToken());
  console.log(
    "deployerHasDefaultAdminRole:",
    await deployed.hasRole(nftAdminRole, deployerAddress)
  );
  console.log(
    "deployerHasMinterRole:",
    await deployed.hasRole(nftMinterRole, deployerAddress)
  );
  console.log(
    "nftHasRewardTokenMinterRole:",
    await doudocoin.hasRole(doudocoinMinterRole, doudocoinNftAddress)
  );
  console.log("membershipLevel1:", commonLevel.name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
