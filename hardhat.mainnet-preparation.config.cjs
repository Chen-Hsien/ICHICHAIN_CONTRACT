// Deliberately does not load dotenv, private keys, or the production network config.
require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      metadata: { bytecodeHash: "none" },
      optimizer: { enabled: true, runs: 0 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: { allowUnlimitedContractSize: false },
    preparation: {
      url: process.env.PREPARATION_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: [],
    },
  },
};
