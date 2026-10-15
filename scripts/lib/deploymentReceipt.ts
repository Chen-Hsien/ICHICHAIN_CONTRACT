import type { Provider } from "ethers";

/** Hardhat's provider does not implement waitForTransaction; its transaction response implements wait. */
export async function deploymentReceipt(provider: Pick<Provider, "getTransaction">, hash: string) {
  const transaction = await provider.getTransaction(hash);
  if (!transaction) throw new Error("Submitted transaction unavailable; inspect deployment journal");
  const receipt = await transaction.wait(2, 180000);
  if (!receipt || receipt.status !== 1) throw new Error("Transaction is pending or failed; inspect deployment journal");
  return receipt;
}
