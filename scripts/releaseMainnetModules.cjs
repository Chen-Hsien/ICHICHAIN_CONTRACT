const fs = require("fs");
const { ethers, upgrades, network, artifacts } = require("hardhat");
const cpPath = "deployments/arbitrum-one.json";
const fork = network.name === "hardhat";
const reportPath = `deployments/mainnet-release-20260915${fork ? "-fork" : ""}.json`;
const targets = [
  ["DOUDO_CORE", "DOUDOCHAINV2CoreUpgradeable"],
  ["DOUDO_BUNDLE_MODULE", "DoudoBundleModuleUpgradeable"],
  ["DOUDO_REDRAW_MODULE", "DoudoRedrawModuleUpgradeable"],
];
const stringify = (x) =>
  JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
async function main() {
  const cp = JSON.parse(fs.readFileSync(cpPath));
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if ((fork && chainId !== 31337n) || (!fork && chainId !== 42161n))
    throw Error("Wrong chain");
  if (!fork && process.env.EXECUTE_MAINNET_MODULE_RELEASE !== "42161")
    throw Error("Execution flag absent");
  if (!fork) {
    const check = JSON.parse(
      fs.readFileSync("deployments/mainnet-release-20260915-fork.json"),
    );
    const head = require("child_process")
      .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
      .trim();
    if (!check.verifiedAt || check.sourceCommit !== head)
      throw Error("Verified fork for current source required");
  }
  let signer;
  if (fork) {
    await network.provider.send("hardhat_impersonateAccount", [cp.admin]);
    await network.provider.send("hardhat_setBalance", [
      cp.admin,
      "0x56BC75E2D63100000",
    ]);
    signer = await ethers.getSigner(cp.admin);
    await network.provider.send("evm_mine");
  } else {
    [signer] = await ethers.getSigners();
  }
  if ((await signer.getAddress()).toLowerCase() !== cp.admin.toLowerCase())
    throw Error("Unexpected signer");
  const report = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath))
    : {
        chainId: String(chainId),
        sourceCommit: require("child_process")
          .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
          .trim(),
        transactions: [],
        implementations: {},
      };
  const save = () => fs.writeFileSync(reportPath, stringify(report) + "\n");
  const record = async (label, tx) => {
    report.transactions.push({ label, hash: tx.hash });
    save();
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw Error("Failed " + label);
    Object.assign(report.transactions.at(-1), {
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: String(receipt.gasUsed),
    });
    save();
    console.log(label, tx.hash, receipt.blockNumber);
    return receipt;
  };
  const core = await ethers.getContractAt(
    "DOUDOCHAINV2CoreUpgradeable",
    cp.addresses.DOUDO_CORE,
    signer,
  );
  const bundle = await ethers.getContractAt(
    "DoudoBundleModuleUpgradeable",
    cp.addresses.DOUDO_BUNDLE_MODULE,
    signer,
  );
  const redraw = await ethers.getContractAt(
    "DoudoRedrawModuleUpgradeable",
    cp.addresses.DOUDO_REDRAW_MODULE,
    signer,
  );
  const snapshot = async () => ({
    points: await core.doudoPoints(),
    router: await core.vrfRouter(),
    paused: await core.paused(),
    supply: String(await core.totalSupply()),
    bundleCore: await bundle.core(),
    bundlePoints: await bundle.doudoPoints(),
    redraw: await bundle.redrawModule(),
    authorizer: await bundle.pointsAuthorizationSigner(),
    membership: await bundle.membershipV2(),
    databasePointsMode: await bundle.databasePointsModeEnabled(),
    refund: await bundle.databasePointsRefundModule(),
    redrawCore: await redraw.core(),
    redrawRouter: await redraw.router(),
    redrawBundle: await redraw.bundleModule(),
  });
  const before = await snapshot();
  if (
    before.authorizer.toLowerCase() !==
    "0x82025d74b565e3a26defc9bf01afd53c620121a5"
  )
    throw Error("Authorizer mismatch");
  report.before = report.before || before;
  save();
  for (const [key, name] of targets) {
    const proxy = cp.addresses[key];
    const old = await upgrades.erc1967.getImplementationAddress(proxy);
    const factory = await ethers.getContractFactory(name, {
      signer,
      ...(key === "DOUDO_CORE"
        ? {
            libraries: {
              DoudoPrizeDrawLib: cp.addresses.DOUDO_PRIZE_DRAW_LIB,
              DoudoTokenURILib: cp.addresses.DOUDO_TOKEN_URI_LIB,
            },
          }
        : {}),
    });
    const artifact = await artifacts.readArtifact(name);
    if ((artifact.deployedBytecode.length - 2) / 2 > 24576)
      throw Error("EIP170 " + name);
    if (!fork)
      await upgrades.validateUpgrade(proxy, factory, {
        kind: "uups",
        unsafeAllowLinkedLibraries: key === "DOUDO_CORE",
      });
    let next = report.implementations[key]?.next;
    if (!next) {
      if (fork) {
        const impl = await factory.deploy();
        const receipt = await record(
          "deployImplementation:" + key,
          impl.deploymentTransaction(),
        );
        next = receipt.contractAddress;
      } else {
        const result = await upgrades.prepareUpgrade(proxy, factory, {
          kind: "uups",
          unsafeAllowLinkedLibraries: key === "DOUDO_CORE",
          getTxResponse: true,
        });
        if (typeof result === "string") next = result;
        else {
          const receipt = await record("deployImplementation:" + key, result);
          next = receipt.contractAddress;
        }
      }
      if (!next) throw Error("Missing implementation");
      report.implementations[key] = { old, next, proxy };
      save();
    }
    if (old.toLowerCase() !== next.toLowerCase())
      await record(
        "upgrade:" + key,
        await (await ethers.getContractAt(name, proxy, signer)).upgradeTo(next),
      );
    if (
      (await upgrades.erc1967.getImplementationAddress(proxy)).toLowerCase() !==
      next.toLowerCase()
    )
      throw Error("Implementation verification " + key);
    if (!fork) {
      cp.implementations[key] = next;
      cp.transactions["upgrade:" + key + ":20260915"] =
        report.transactions.findLast((t) => t.label === "upgrade:" + key)?.hash;
      fs.writeFileSync(cpPath, stringify(cp) + "\n");
    }
  }
  const after = await snapshot();
  if (stringify(before) !== stringify(after))
    throw Error("Existing state/wiring changed");
  report.after = after;
  save();
  let buyback;
  if (report.buyback?.proxy) {
    buyback = await ethers.getContractAt(
      "DoudoPrizeBuybackModuleUpgradeable",
      report.buyback.proxy,
      signer,
    );
  } else {
    const factory = await ethers.getContractFactory(
      "DoudoPrizeBuybackModuleUpgradeable",
      signer,
    );
    buyback = await upgrades.deployProxy(
      factory,
      [cp.addresses.DOUDO_CORE, before.authorizer],
      { kind: "uups" },
    );
    report.buyback = { proxy: await buyback.getAddress() };
    save();
    await record("deploy:BUYBACK", buyback.deploymentTransaction());
    report.buyback.implementation =
      await upgrades.erc1967.getImplementationAddress(report.buyback.proxy);
    save();
  }
  const moduleAddress = await buyback.getAddress();
  if (!(await buyback.hasRole(await buyback.OPERATION_ROLE(), cp.operation)))
    await record(
      "grant:BUYBACK:OPERATION_ROLE",
      await buyback.grantRole(await buyback.OPERATION_ROLE(), cp.operation),
    );
  if (!(await core.hasRole(await core.MODULE_ROLE(), moduleAddress)))
    await record(
      "grant:CORE:BUYBACK:MODULE_ROLE",
      await core.grantRole(await core.MODULE_ROLE(), moduleAddress),
    );
  for (const [role, account] of [
    [ethers.ZeroHash, cp.admin],
    [ethers.id("UPGRADER_ROLE"), cp.admin],
    [ethers.id("OPERATION_ROLE"), cp.operation],
    [ethers.id("AUTHORIZER_ROLE"), before.authorizer],
  ])
    if (!(await buyback.hasRole(role, account)))
      throw Error("Buyback role missing");
  if (
    (await buyback.core()).toLowerCase() !==
      cp.addresses.DOUDO_CORE.toLowerCase() ||
    (await buyback.MAX_BATCH_SIZE()) !== 50n ||
    (await buyback.paused())
  )
    throw Error("Buyback wiring/capability mismatch");
  report.buyback.authorizer = before.authorizer;
  report.buyback.moduleRoleBlock = report.transactions.find(
    (t) => t.label === "grant:CORE:BUYBACK:MODULE_ROLE",
  )?.blockNumber;
  report.verifiedAt = new Date().toISOString();
  save();
  if (!fork) {
    cp.addresses.DOUDO_PRIZE_BUYBACK_MODULE = moduleAddress;
    cp.implementations.DOUDO_PRIZE_BUYBACK_MODULE =
      report.buyback.implementation;
    for (const t of report.transactions)
      cp.transactions[t.label + ":20260915"] = t.hash;
    fs.writeFileSync(cpPath, stringify(cp) + "\n");
  }
  console.log(
    stringify({
      verified: true,
      buyback: report.buyback,
      implementations: report.implementations,
    }),
  );
}
main().catch((e) => {
  console.error({
    name: e.name,
    message:
      e.shortMessage ||
      e.message?.replace(/https?:\/\/[^\s]+/g, "[redacted URL]"),
  });
  process.exitCode = 1;
});
