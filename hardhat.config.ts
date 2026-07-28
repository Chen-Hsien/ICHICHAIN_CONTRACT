import { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const accounts = (privateKey?: string) => {
  if (!privateKey) {
    return [];
  }

  const normalized = privateKey.startsWith("0x")
    ? privateKey
    : `0x${privateKey}`;

  return /^0x[0-9a-fA-F]{64}$/.test(normalized) ? [normalized] : [];
};

const arbitrumOneRpcUrl =
  process.env.ARB_MAINNET_RPC_URL || "https://arb1.arbitrum.io/rpc";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          metadata: {
            bytecodeHash: "none",
          },
          optimizer: {
            enabled: true,
            runs: 0,
          },
          viaIR: true,
        },
      },
      {
        version: "0.8.20",
        settings: {
          metadata: {
            bytecodeHash: "none",
          },
          optimizer: {
            enabled: true,
            runs: 0,
          },
          viaIR: true,
        },
      },
    ],
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    sepolia: {
      chainId: 11155111,
      url:
        process.env.MAINNET_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: accounts(process.env.PRIVATE_KEY),
    },
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      gasPrice: 5e9, // adjust gas price if needed
      accounts: accounts(process.env.PRIVATE_KEY),
    },
    polygon: {
      url: "https://polygon.drpc.org",
      chainId: 137,
      accounts: accounts(process.env.PRIVATE_KEY),
    },
    arbitrumSepolia: {
      url:
        process.env.ARB_SEPOLIA_RPC_URL ||
        "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: accounts(process.env.ARB_TESTNET_PK),
    },
    arbitrumOne: {
      url: arbitrumOneRpcUrl,
      chainId: 42161,
      accounts: accounts(process.env.ARB_MAINNET_PK),
    },
    arbitrumOneFork: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: "remote",
    },
  },

  etherscan: {
    apiKey:
      process.env.ETHERSCAN_API_KEY ||
      process.env.ARBISCAN_API_KEY ||
      process.env.POLYGONSCAN_API_KEY ||
      "",
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
      {
        network: "arbitrumOne",
        chainId: 42161,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://arbiscan.io",
        },
      },
    ],
  },
};

export default config;
