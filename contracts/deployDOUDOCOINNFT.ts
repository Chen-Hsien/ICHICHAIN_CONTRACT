// deploy fakeUSDT contract
import { ethers } from "hardhat";

const voucherData = [
  {
    amount: 10,      // 10 token = 6 TWD = 0.2 USDT
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/10.json",
  },
  {
    amount: 50,      // 50 token = 30 TWD = 1 USDT
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/50.json",
  },
  {
    amount: 100,     // 100 token = 60 TWD = 2 USDT
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/100.json",
  },
  {
    amount: 250,     // 250 token = 150 TWD = 5 USDT
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/250.json",
  },
  {
    amount: 500,     // 500 token = 300 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/500.json",
  },
  {
    amount: 1000,    // 1000 token = 600 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/1000.json",
  },
  {
    amount: 1500,    // 1500 token = 900 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/1500.json",
  },
  {
    amount: 2000,    // 2000 token = 1200 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/2000.json",
  },
  {
    amount: 2500,    // 2500 token = 1500 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/2500.json",
  },
  {
    amount: 5000,    // 5000 token = 3000 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/5000.json",
  },
  {
    amount: 10000,   // 10000 token = 6000 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/10000.json",
  },
  {
    amount: 15000,   // 15000 token = 9000 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/15000.json",
  },
  {
    amount: 25000,   // 25000 token = 15000 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/25000.json",
  },
  {
    amount: 30000,   // 30000 token = 18000 TWD
    maxPerUser: 99999,
    tokenURI: "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/30000.json",
  }
]

async function main() {
  const doudoCoinNFTFactory = await ethers.getContractFactory("DOUDOCOINNFT");
  const doudoCoinNFTContract = await doudoCoinNFTFactory.deploy('0xc156b5a299FBf556d5652F7FddeBAb27815F1342', '0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2', '0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2');
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
