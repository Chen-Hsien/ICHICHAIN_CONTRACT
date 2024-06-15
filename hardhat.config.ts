import { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true 
    },
  },
  networks: {
    sepolia: {
      chainId: 11155111,
      url: process.env.MAINNET_URL,
      accounts: [process.env.PRIVATE_KEY as string],
    },
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      gasPrice: 5e9, // adjust gas price if needed
      accounts: [process.env.PRIVATE_KEY as string],
    },
    polygon: {
      url: "https://polygon.drpc.org",
      chainId: 137,
      accounts: [process.env.PRIVATE_KEY as string],
    },
  },

  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY,
},
};

export default config;
