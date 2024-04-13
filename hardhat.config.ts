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
    },
  },
  networks: {
    mumbai: {
      url: process.env.MUMBAI_URL,
      accounts: [process.env.PRIVATE_KEY as string],
    },
    arbitrumSepolia: {
      url: process.env.SEPOLIA_URL,
      accounts: [process.env.PRIVATE_KEY as string],
    },
  },

  etherscan: {
    apiKey: {
        arbitrumSepolia: process.env.SEPOLIASCAN_API_KEY || "",
    },
    customChains: [
        {
            network: "arbitrumSepolia",
            chainId: 421614,
            urls: {
                apiURL: "https://api-sepolia.arbiscan.io/api",
                browserURL: "https://sepolia.arbiscan.io/",
            },
        },
    ],
},
};

export default config;
