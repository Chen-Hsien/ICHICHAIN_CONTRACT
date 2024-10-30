// deploy fakeUSDT contract
import { ethers } from "hardhat";

const voucherData = [
  {
    amount: 100,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/100.json",
  },
  {
    amount: 150,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/150.json",
  },
  {
    amount: 300,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/300.json",
  },
  {
    amount: 500,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/500.json",
  },
  {
    amount: 1000,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/1000.json",
  },
  {
    amount: 2000,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/2000.json",
  },
  {
    amount: 3000,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/3000.json",
  },
  {
    amount: 5000,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/5000.json",
  },
  {
    amount: 10000,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/10000.json",
  },
  {
    amount: 12500,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/12500.json",
  },
  {
    amount: 15000,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/15000.json",
  },
  {
    amount: 20000,
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmYaCRpRprrGzvoYC9cQit8dc6tQGFwbytgj5JhvnUoqGq/20000.json",
  },
  
]

async function main() {
  const doudoCoinNFTFactory = await ethers.getContractFactory("DOUDOCOINNFT");
  const doudoCoinNFTContract = await doudoCoinNFTFactory.deploy('0x022CB0f165dC491878839AC9DE9D9292E2318eC6', '0x2f758DE9c4B83ed1a3B777b5f905d46Fa1c2C725', '0x2f758DE9c4B83ed1a3B777b5f905d46Fa1c2C725');
  await doudoCoinNFTContract.waitForDeployment();
  console.log("Contract deployed to:", doudoCoinNFTContract.target);
  // create voucher types
  for (let i = 0; i < voucherData.length; i++) {
    console.log("Creating voucher type:", i + 1);
    await doudoCoinNFTContract.createVoucherType(voucherData[i].amount, voucherData[i].maxPerUser, voucherData[i].tokenURI);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }



}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
