import base from "./hardhat.config";
import type { HardhatUserConfig } from "hardhat/config";
const config: HardhatUserConfig = {
  ...base,
  networks: {
    ...base.networks,
    arbitrumOneFork: {
      chainId: 42161,
      url: process.env.MAINNET_FORK_RPC_URL || "http://127.0.0.1:18545",
      accounts: "remote",
    },
  },
};
export default config;
