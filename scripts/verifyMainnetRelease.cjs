const { run } = require("hardhat");
const fs = require("fs");
(async () => {
  const r = JSON.parse(
    fs.readFileSync("deployments/mainnet-release-20260915.json"),
  );
  const cp = JSON.parse(fs.readFileSync("deployments/arbitrum-one.json"));
  const targets = [
    [
      "DOUDO_CORE",
      "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    ],
    [
      "DOUDO_BUNDLE_MODULE",
      "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable",
    ],
    [
      "DOUDO_REDRAW_MODULE",
      "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable",
    ],
    [
      "DOUDO_PRIZE_BUYBACK_MODULE",
      "contracts/modules/DoudoPrizeBuybackModuleUpgradeable.sol:DoudoPrizeBuybackModuleUpgradeable",
    ],
  ];
  const results = [];
  for (const [key, contract] of targets) {
    try {
      await run("verify:verify", {
        address: cp.implementations[key],
        constructorArguments: [],
        contract,
        ...(key === "DOUDO_CORE"
          ? {
              libraries: {
                DoudoPrizeDrawLib: cp.addresses.DOUDO_PRIZE_DRAW_LIB,
                DoudoTokenURILib: cp.addresses.DOUDO_TOKEN_URI_LIB,
              },
            }
          : {}),
      });
      results.push({ key, status: "verified" });
    } catch (e) {
      results.push({
        key,
        status: /already verified/i.test(e.message) ? "verified" : "failed",
        message: e.message?.replace(/https?:\/\/[^\s]+/g, "[URL]"),
      });
    }
    console.log(results.at(-1));
  }
  fs.writeFileSync(
    "deployments/mainnet-release-20260915-verification.json",
    JSON.stringify(results, null, 2) + "\n",
  );
})().catch((e) => {
  console.error({ name: e.name });
  process.exitCode = 1;
});
