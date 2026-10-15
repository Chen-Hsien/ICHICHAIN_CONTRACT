const { expect } = require("chai");
const { deploymentReceipt } = require("../scripts/lib/deploymentReceipt");

describe("resuming a submitted staging deployment", function () {
  it("uses the saved transaction response and waits for two confirmations", async function () {
    const calls = [];
    const receipt = { status: 1, contractAddress: "0x1234", blockNumber: 123 };
    const result = await deploymentReceipt({
      getTransaction: async (hash) => {
        calls.push(["getTransaction", hash]);
        return { wait: async (...args) => { calls.push(["wait", ...args]); return receipt; } };
      },
      waitForTransaction: () => { throw new Error("Unsupported Hardhat API must not be used"); },
    }, "saved-transaction-hash");
    expect(result).to.equal(receipt);
    expect(calls).to.deep.equal([["getTransaction", "saved-transaction-hash"], ["wait", 2, 180000]]);
  });
  for (const value of [null, { status: 0 }]) {
    it(`rejects an unsuccessful confirmation (${JSON.stringify(value)})`, async function () {
      let error;
      try { await deploymentReceipt({ getTransaction: async () => ({ wait: async () => value }) }, "hash"); }
      catch (caught) { error = caught; }
      expect(error.message).to.include("pending or failed");
    });
  }
  it("does not silently redeploy when a submitted transaction cannot be found", async function () {
    let error;
    try { await deploymentReceipt({ getTransaction: async () => null }, "hash"); }
    catch (caught) { error = caught; }
    expect(error.message).to.include("Submitted transaction unavailable");
  });
});
