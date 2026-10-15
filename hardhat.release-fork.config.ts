import base from "./hardhat.config";
export default {
  ...base,
  networks: {
    ...base.networks,
    hardhat: {
      ...base.networks?.hardhat,
      allowUnlimitedContractSize: false,
      hardfork: "cancun",
      chains: { 42161: { hardforkHistory: { cancun: 0 } } },
      forking: {
        url: process.env.ARB_MAINNET_RPC_URL || "https://arb1.arbitrum.io/rpc",
      },
    },
  },
};
