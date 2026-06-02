import { ethers } from "hardhat";

const DOUDOCOINNFT = "0xaABDFbC1E36ed77B0EA0788234276a1348832eEb";

const voucherData = [
  {
    amount: 10,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/10.json",
  },
  {
    amount: 50,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/50.json",
  },
  {
    amount: 100,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/100.json",
  },
  {
    amount: 250,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/250.json",
  },
  {
    amount: 500,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/500.json",
  },
  {
    amount: 1000,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/1000.json",
  },
  {
    amount: 1500,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/1500.json",
  },
  {
    amount: 2000,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/2000.json",
  },
  {
    amount: 2500,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/2500.json",
  },
  {
    amount: 5000,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/5000.json",
  },
  {
    amount: 10000,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/10000.json",
  },
  {
    amount: 15000,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/15000.json",
  },
  {
    amount: 25000,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/25000.json",
  },
  {
    amount: 30000,
    maxPerUser: 99999,
    tokenURI:
      "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/30000.json",
  },
];

const DOUDOCOINNFT_ABI = [
  "function createVoucherType(uint256 amount, uint256 maxPerUser, string _tokenURI) external",
  "function nextVoucherTypeId() external view returns (uint256)",
  "function voucherTypes(uint256 voucherTypeId) external view returns (uint256 amount, uint256 maxPerUser, string tokenURI)",
];

async function main() {
  const nft = await ethers.getContractAt(DOUDOCOINNFT_ABI, DOUDOCOINNFT);
  const beforeNextVoucherTypeId = await nft.nextVoucherTypeId();

  console.log("DOUDOCOINNFT:", DOUDOCOINNFT);
  console.log("nextVoucherTypeId before:", beforeNextVoucherTypeId.toString());

  if (beforeNextVoucherTypeId !== 0n) {
    throw new Error("Voucher types already exist; refusing to duplicate init.");
  }

  for (const [index, voucher] of voucherData.entries()) {
    const tx = await nft.createVoucherType(
      voucher.amount,
      voucher.maxPerUser,
      voucher.tokenURI
    );
    console.log(`createVoucherType[${index}] tx:`, tx.hash);
    await tx.wait();
  }

  const afterNextVoucherTypeId = await nft.nextVoucherTypeId();
  console.log("nextVoucherTypeId after:", afterNextVoucherTypeId.toString());

  for (let index = 0; index < voucherData.length; index++) {
    const voucher = await nft.voucherTypes(index);
    console.log(
      `voucherTypes[${index}]: amount=${voucher.amount.toString()} maxPerUser=${voucher.maxPerUser.toString()} tokenURI=${voucher.tokenURI}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
