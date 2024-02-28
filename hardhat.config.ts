import { HardhatUserConfig } from "hardhat/config";
import 'dotenv/config'
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    mumbai: {
      url: process.env.MUMBAI_URL,
      accounts: [process.env.PRIVATE_KEY as string],
    },
  },
  
  etherscan: {
    // apiKey: process.env.ETHERSCAN_API_KEY,
    apiKey: process.env.POLYGONSCAN_API_KEY,
  },
};

export default config;
