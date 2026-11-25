// Read-only mainnet preparation. The only write path is explicitly localhost Anvil.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ethers, artifacts, upgrades, network } = require("hardhat");
const {
  assertStorageUpgradeSafe,
  UpgradeableContract,
} = require("@openzeppelin/upgrades-core");
const deployment = require("../deployments/arbitrum-one.json");
const fixed = require("../deployments/fixed-probability-uups-arbitrum-one.json");
const manifest = require("../.openzeppelin/arbitrum-one.json");
const SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  ) + "\n";
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const requireCheck = (test, message) => {
  if (!test) throw Error(message);
};
const LIBRARIES = [
  "FixedProbabilityConfigValidation",
  "FixedProbabilitySettlement",
  "FixedProbabilityBuybackValidation",
];
const COMPONENTS = {
  Bundle: {
    name: "DoudoBundleModuleUpgradeable",
    proxy: deployment.addresses.DOUDO_BUNDLE_MODULE,
    baseline: deployment.implementations.DOUDO_BUNDLE_MODULE,
    fields: [
      "core",
      "doudoPoints",
      "redrawModule",
      "membershipV2",
      "pointsAuthorizationSigner",
      "databasePointsRefundModule",
      "databasePointsModeEnabled",
      "paused",
    ],
  },
  Fixed: {
    name: "FixedProbabilityLotteryV3Upgradeable",
    proxy: fixed.address,
    baseline: fixed.implementation.address,
    fields: [
      "router",
      "membershipV2",
      "authorizationSigner",
      "operator",
      "paused",
      "nextSeriesId",
      "nextOrderId",
      "nextDrawId",
    ],
  },
  SeriesOps: {
    name: "DoudoSeriesOpsModuleUpgradeable",
    proxy: deployment.addresses.DOUDO_SERIES_OPS_MODULE,
    baseline: deployment.implementations.DOUDO_SERIES_OPS_MODULE,
    fields: ["core", "defaultLockDuration"],
  },
};
function link(bytecode, references, libraries) {
  let result = bytecode.slice(2);
  for (const names of Object.values(references || {}))
    for (const [name, locations] of Object.entries(names)) {
      const address = libraries[name];
      requireCheck(ethers.isAddress(address), `Missing library ${name}`);
      for (const { start, length } of locations) {
        requireCheck(length === 20, "Unexpected link size");
        result =
          result.slice(0, start * 2) +
          address.slice(2).toLowerCase() +
          result.slice((start + length) * 2);
      }
    }
  return "0x" + result;
}
function expectedRuntime(candidate, address, libraries) {
  let runtime = link(
    candidate.deployedBytecode,
    candidate.deployedLinkReferences,
    libraries
  );
  for (const refs of Object.values(candidate.immutableReferences))
    for (const { start, length } of refs) {
      requireCheck(length === 32, "Unknown immutable shape");
      runtime =
        runtime.slice(0, 2 + start * 2) +
        ethers.zeroPadValue(address, 32).slice(2) +
        runtime.slice(2 + (start + length) * 2);
    }
  if (
    LIBRARIES.includes(candidate.name) &&
    runtime.startsWith("0x73" + "0".repeat(40))
  )
    runtime = "0x73" + address.slice(2).toLowerCase() + runtime.slice(44);
  return runtime;
}
async function main() {
  requireCheck(
    !process.env.MAINNET_PREPARATION_MODE ||
      process.env.MAINNET_PREPARATION_MODE === "fork",
    "Unsupported preparation mode"
  );
  const rehearsal = process.env.MAINNET_PREPARATION_MODE === "fork";
  const provider = new ethers.JsonRpcProvider(
    network.config.url,
    { chainId: 42161, name: "arbitrum-one" },
    { staticNetwork: true, cacheTimeout: -1 }
  );
  requireCheck(
    BigInt(await provider.send("eth_chainId", [])) === 42161n,
    "Arbitrum One RPC chainId required"
  );
  const localAnvil = /anvil/i.test(
    await provider.send("web3_clientVersion", [])
  );
  if (rehearsal) {
    const url = new URL(network.config.url);
    requireCheck(
      url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
      "Fork writes require HTTP localhost"
    );
    requireCheck(
      /anvil/i.test(await provider.send("web3_clientVersion", [])),
      "Fork writes require Anvil"
    );
    const info = await provider.send("anvil_nodeInfo", []);
    requireCheck(
      info.forkConfig?.forkBlockNumber > 0 &&
        info.environment?.chainId === 42161,
      "Anvil must be an Arbitrum One fork"
    );
  }
  const block = await provider.getBlock("latest");
  requireCheck(block, "Block missing");
  const at = { blockTag: block.number };
  const admin = deployment.admin;
  const latestNonce = await provider.getTransactionCount(admin, block.number);
  requireCheck(
    (await provider.getTransactionCount(admin, "pending")) === latestNonce,
    "Pending admin transaction exists"
  );
  const candidate = {};
  for (const name of [
    ...LIBRARIES,
    ...Object.values(COMPONENTS).map((c) => c.name),
  ]) {
    const a = await artifacts.readArtifact(name),
      build = await artifacts.getBuildInfo(`${a.sourceName}:${a.contractName}`);
    requireCheck(build, `Missing build-info ${name}`);
    // Cache reuse is safe only when every compiler input matches this checkout.
    for (const [source, data] of Object.entries(build.input.sources))
      requireCheck(
        fs.readFileSync(
          fs.existsSync(source) ? source : path.join("node_modules", source),
          "utf8"
        ) === data.content,
        `Stale compiled source ${source}`
      );
    const compiled = build.output.contracts[a.sourceName][a.contractName];
    const storageLayout = LIBRARIES.includes(name)
      ? compiled.storageLayout
      : new UpgradeableContract(
          `${a.sourceName}:${a.contractName}`,
          build.input,
          build.output,
          {
            kind: "uups",
            unsafeAllowLinkedLibraries: name === COMPONENTS.Fixed.name,
          },
          build.solcVersion
        ).layout;
    candidate[name] = {
      name,
      sourceName: a.sourceName,
      compiler: build.solcLongVersion,
      compilerSettings: build.input.settings,
      buildInfoSha256: sha(
        fs.readFileSync(
          (await artifacts.getBuildInfoPaths()).find((p) =>
            p.endsWith(build.id + ".json")
          )
        )
      ),
      sourceBundleSha256: sha(JSON.stringify(build.input)),
      sourceHash: ethers.keccak256(
        ethers.toUtf8Bytes(build.input.sources[a.sourceName].content)
      ),
      abi: a.abi,
      abiSha256: sha(json(a.abi)),
      storageLayout,
      storageLayoutSha256: sha(json(storageLayout)),
      buildInfoPath: await artifacts.getBuildInfoPaths().then((paths) =>
        path.relative(
          process.cwd(),
          paths.find((p) => p.endsWith(build.id + ".json"))
        )
      ),
      sourceBundle: build.input,
      bytecode: a.bytecode,
      linkReferences: a.linkReferences,
      deployedBytecode: a.deployedBytecode,
      deployedLinkReferences: a.deployedLinkReferences,
      immutableReferences:
        compiled.evm.deployedBytecode.immutableReferences || {},
      runtimeBytes: (a.deployedBytecode.length - 2) / 2,
    };
    requireCheck(
      candidate[name].runtimeBytes <= 24576,
      `${name} exceeds EIP170`
    );
  }
  const checks = {},
    components = {};
  for (const [key, c] of Object.entries(COMPONENTS)) {
    const implementation = ethers.getAddress(
      "0x" + (await provider.getStorage(c.proxy, SLOT, block.number)).slice(-40)
    );
    requireCheck(
      equal(implementation, c.baseline),
      `${key} unexpected baseline implementation`
    );
    const proxyCode = await provider.getCode(c.proxy, block.number),
      code = await provider.getCode(implementation, block.number);
    requireCheck(proxyCode !== "0x" && code !== "0x", `${key} missing code`);
    if (key === "Fixed")
      requireCheck(
        ethers.keccak256(code) === fixed.implementation.runtimeHash &&
          ethers.keccak256(proxyCode) === fixed.runtimeHash,
        "Fixed baseline runtime mismatch"
      );
    const previous = Object.values(manifest.impls).find((i) =>
      equal(i.address, implementation)
    );
    requireCheck(previous?.layout, `${key} baseline storage layout missing`);
    assertStorageUpgradeSafe(previous.layout, candidate[c.name].storageLayout, {
      unsafeAllowRenames: false,
    });
    const contract = new ethers.Contract(
      c.proxy,
      candidate[c.name].abi,
      provider
    );
    requireCheck(
      await contract.hasRole(await contract.UPGRADER_ROLE(at), admin, at),
      `${key} admin lacks UPGRADER_ROLE`
    );
    requireCheck(
      await contract.hasRole(ethers.ZeroHash, admin, at),
      `${key} admin lacks DEFAULT_ADMIN_ROLE`
    );
    const before = {};
    for (const field of c.fields)
      before[field] = String(await contract[field](at));
    const operationRole = ethers.id(
      key === "Fixed" ? "OPERATOR_ROLE" : "OPERATION_ROLE"
    );
    const operatorRolePresent = await contract.hasRole(
      operationRole,
      deployment.operation,
      at
    );
    requireCheck(operatorRolePresent, `${key} server operation role missing`);
    checks[key] = {
      storageLayoutCompatible: true,
      adminCanUpgrade: true,
      serverRole: {
        address: deployment.operation,
        role: operationRole,
        present: operatorRolePresent,
      },
    };
    components[key] = {
      ...c,
      implementation,
      implementationRuntimeHash: ethers.keccak256(code),
      proxyRuntimeHash: ethers.keccak256(proxyCode),
      baselineStorageLayoutSha256: sha(json(previous.layout)),
      before,
    };
  }
  const A = deployment.addresses;
  const checkAddress = (actual, expected, message) =>
    requireCheck(equal(actual, expected), message);
  for (const key of ["Bundle", "SeriesOps"])
    checkAddress(
      components[key].before.core,
      A.DOUDO_CORE,
      `${key} core wiring`
    );
  checkAddress(
    components.Bundle.before.membershipV2,
    A.DOUDO_MEMBERSHIP_V2,
    "Bundle membership wiring"
  );
  checkAddress(
    components.Bundle.before.redrawModule,
    A.DOUDO_REDRAW_MODULE,
    "Bundle redraw wiring"
  );
  checkAddress(
    components.Bundle.before.databasePointsRefundModule,
    A.DOUDO_REFUND_MODULE,
    "Bundle refund wiring"
  );
  requireCheck(
    components.Bundle.before.databasePointsModeEnabled === "true",
    "Database points mode disabled"
  );
  checkAddress(
    components.Fixed.before.router,
    A.DOUDO_VRF_ROUTER,
    "Fixed router wiring"
  );
  checkAddress(
    components.Fixed.before.membershipV2,
    A.DOUDO_MEMBERSHIP_V2,
    "Fixed membership wiring"
  );
  checkAddress(
    components.Fixed.before.operator,
    deployment.operation,
    "Fixed operator wiring"
  );
  checkAddress(
    components.Bundle.before.pointsAuthorizationSigner,
    fixed.initializer[1],
    "Bundle authorization signer"
  );
  checkAddress(
    components.Fixed.before.authorizationSigner,
    fixed.initializer[1],
    "Fixed authorization signer"
  );
  const core = new ethers.Contract(
    A.DOUDO_CORE,
    [
      "function MODULE_ROLE() view returns(bytes32)",
      "function hasRole(bytes32,address) view returns(bool)",
    ],
    provider
  );
  requireCheck(
    await core.hasRole(await core.MODULE_ROLE(at), A.DOUDO_BUNDLE_MODULE, at),
    "Core Bundle MODULE_ROLE missing"
  );
  const router = new ethers.Contract(
    A.DOUDO_VRF_ROUTER,
    ["function isRequester(address) view returns(bool)"],
    provider
  );
  requireCheck(
    await router.isRequester(fixed.address, at),
    "Fixed VRF requester missing"
  );
  const membership = new ethers.Contract(
    A.DOUDO_MEMBERSHIP_V2,
    ["function hasRole(bytes32,address) view returns(bool)"],
    provider
  );
  for (const address of [fixed.address, A.DOUDO_BUNDLE_MODULE])
    requireCheck(
      await membership.hasRole(
        ethers.id("CONSUMPTION_RECORDER_ROLE"),
        address,
        at
      ),
      "Membership recorder missing"
    );
  for (const lib of fixed.libraries)
    requireCheck(
      ethers.keccak256(await provider.getCode(lib.address, block.number)) ===
        lib.runtimeHash,
      `Baseline library code mismatch ${lib.name}`
    );
  const libraries = {},
    transactions = [];
  let nonce = latestNonce;
  for (const name of [
    ...LIBRARIES,
    ...Object.values(COMPONENTS).map((c) => c.name),
  ]) {
    const address = ethers.getCreateAddress({ from: admin, nonce });
    const data = link(
      candidate[name].bytecode,
      candidate[name].linkReferences,
      libraries
    );
    if (LIBRARIES.includes(name)) libraries[name] = address;
    const factory = new ethers.ContractFactory(candidate[name].abi, data);
    if (!LIBRARIES.includes(name))
      await upgrades.validateImplementation(factory, {
        kind: "uups",
        unsafeAllowLinkedLibraries: name === COMPONENTS.Fixed.name,
      });
    const runtime = expectedRuntime(candidate[name], address, libraries);
    transactions.push({
      step: `deploy:${name}`,
      chainId: 42161,
      from: admin,
      nonce: nonce++,
      to: null,
      value: "0",
      data,
      predictedAddress: address,
      expectedRuntimeHash: ethers.keccak256(runtime),
      runtimeBytes: (runtime.length - 2) / 2,
    });
  }
  for (const [key, c] of Object.entries(COMPONENTS)) {
    const target = transactions.find((t) => t.step === `deploy:${c.name}`);
    const data = new ethers.Interface(candidate[c.name].abi).encodeFunctionData(
      "upgradeTo",
      [target.predictedAddress]
    );
    transactions.push({
      step: `upgrade:${key}`,
      chainId: 42161,
      from: admin,
      nonce: nonce++,
      to: c.proxy,
      value: "0",
      data,
      implementation: target.predictedAddress,
    });
  }
  const release = {
    schemaVersion: "mainnet-series-sale-coupon-v2-preparation-v1",
    chainId: 42161,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    simulation: localAnvil,
    mainnetTransactionsSent: 0,
    preparerSha256: sha(fs.readFileSync(__filename)),
    baseline: {
      blockNumber: block.number,
      blockHash: block.hash,
      admin,
      adminNonce: latestNonce,
    },
    checks,
    components,
    candidate,
    libraries,
    transactions,
    addressWarning:
      "Predicted addresses are nonce-dependent planning values; no deployed production candidate identity is asserted.",
  };
  const releaseHash = sha(json(release));
  const out = path.resolve(
    process.env.PREPARATION_OUTPUT_ROOT ||
      "reports/mainnet-series-sale-coupon-v2",
    releaseHash
  );
  fs.mkdirSync(out, { recursive: true });
  const writeImmutable = (file, value) => {
    const content = json(value),
      location = path.join(out, file);
    if (fs.existsSync(location))
      requireCheck(
        fs.readFileSync(location, "utf8") === content,
        "Immutable report changed"
      );
    else fs.writeFileSync(location, content, { flag: "wx", mode: 0o444 });
  };
  writeImmutable("release.json", { ...release, releaseHash });
  const receipts = [],
    scheduleChecks = [],
    sentHashes = [];
  const sendLocal = async (transaction) => {
    const hash = await provider.send("eth_sendTransaction", [transaction]);
    sentHashes.push(hash);
    await provider.send("evm_mine", []);
    return hash;
  };
  const localReceipt = async (hash) => {
    for (let i = 0; i < 100; i++) {
      const r = await provider.send("eth_getTransactionReceipt", [hash]);
      if (r) {
        requireCheck(
          Number(BigInt(r.blockNumber)) > block.number,
          "Reused historical fork receipt"
        );
        const canonical = await provider.getBlock(
          Number(BigInt(r.blockNumber))
        );
        requireCheck(
          canonical.hash === r.blockHash,
          "Noncanonical local receipt"
        );
        return {
          ...r,
          status: Number(BigInt(r.status)),
          blockNumber: Number(BigInt(r.blockNumber)),
          gasUsed: BigInt(r.gasUsed),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Local mined receipt unavailable");
  };
  if (rehearsal) {
    const snapshot = await provider.send("evm_snapshot", []);
    try {
      await provider.send("anvil_impersonateAccount", [admin]);
      await provider.send("anvil_setBalance", [
        admin,
        ethers.toBeHex(10n ** 20n),
      ]);
      for (const tx of transactions) {
        const hash = await sendLocal({
          from: tx.from,
          ...(tx.to ? { to: tx.to } : {}),
          data: tx.data,
          value: "0x0",
          nonce: ethers.toQuantity(tx.nonce),
          gas: "0x1c9c380",
        });
        const receipt = await localReceipt(hash);
        requireCheck(
          receipt?.status === 1,
          `Fork transaction failed ${tx.step}`
        );
        const canonical = await provider.getBlock(receipt.blockNumber);
        requireCheck(
          canonical.hash === receipt.blockHash,
          "Noncanonical fork receipt"
        );
        if (tx.predictedAddress)
          requireCheck(
            equal(receipt.contractAddress, tx.predictedAddress) &&
              ethers.keccak256(await provider.getCode(tx.predictedAddress)) ===
                tx.expectedRuntimeHash,
            `Runtime mismatch ${tx.step}`
          );
        else {
          const implementation = ethers.getAddress(
            "0x" + (await provider.getStorage(tx.to, SLOT)).slice(-40)
          );
          requireCheck(
            equal(implementation, tx.implementation),
            "Implementation slot mismatch"
          );
          requireCheck(
            receipt.logs.some(
              (l) =>
                equal(l.address, tx.to) &&
                l.topics[0] === ethers.id("Upgraded(address)") &&
                equal(
                  ethers.getAddress("0x" + l.topics[1].slice(-40)),
                  tx.implementation
                )
            ),
            "Upgraded event mismatch"
          );
        }
        receipts.push({
          step: tx.step,
          transactionHash: hash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          gasUsed: String(receipt.gasUsed),
          status: receipt.status,
        });
      }
      for (const [key, c] of Object.entries(COMPONENTS)) {
        const contract = new ethers.Contract(
          c.proxy,
          candidate[c.name].abi,
          provider
        );
        for (const field of c.fields)
          requireCheck(
            String(await contract[field]()) === components[key].before[field],
            `${key} state changed ${field}`
          );
        requireCheck(
          await contract.hasRole(await contract.UPGRADER_ROLE(), admin),
          `${key} upgrader changed`
        );
        if (key !== "SeriesOps")
          requireCheck(
            (await contract.couponAuthorizationVersion()) === 2n,
            `${key} Coupon V2 absent`
          );
        if (key !== "Bundle") {
          const s = await contract.saleSchedules(0);
          requireCheck(
            s.revision === 0n && s.expectedDelistAt === 0n && !s.inactive,
            `${key} legacy schedule default changed`
          );
        }
      }
      await provider.send("anvil_impersonateAccount", [deployment.operation]);
      await provider.send("anvil_setBalance", [
        deployment.operation,
        ethers.toBeHex(10n ** 20n),
      ]);
      try {
        for (const [key, seriesId] of [
          ["SeriesOps", 0],
          ["Fixed", 1],
        ]) {
          const c = COMPONENTS[key],
            contract = new ethers.Contract(
              c.proxy,
              candidate[c.name].abi,
              provider
            );
          for (const [revision, inactive] of [
            [0, false],
            [1, true],
          ]) {
            const deadline = BigInt(block.timestamp) + 3600n + BigInt(revision);
            const data = contract.interface.encodeFunctionData(
              "setSeriesSaleSchedule",
              [seriesId, revision, deadline, inactive]
            );
            const hash = await sendLocal({
              from: deployment.operation,
              to: c.proxy,
              data,
              gas: "0x1e8480",
            });
            const receipt = await localReceipt(hash);
            requireCheck(
              receipt?.status === 1,
              `${key} schedule transaction failed`
            );
            const schedule = await contract.saleSchedules(seriesId);
            requireCheck(
              schedule.revision === BigInt(revision + 1) &&
                schedule.expectedDelistAt === deadline &&
                schedule.inactive === inactive,
              `${key} schedule getter mismatch`
            );
            const event = receipt.logs
              .filter((l) => equal(l.address, c.proxy))
              .map((l) => {
                try {
                  return contract.interface.parseLog(l);
                } catch {
                  return null;
                }
              })
              .find((l) => l?.name === "SeriesSaleScheduleChanged");
            requireCheck(
              event &&
                event.args.seriesId === BigInt(seriesId) &&
                event.args.revision === BigInt(revision + 1) &&
                event.args.expectedDelistAt === deadline &&
                event.args.inactive === inactive,
              `${key} schedule event mismatch`
            );
            scheduleChecks.push({
              component: key,
              seriesId,
              revision: revision + 1,
              inactive,
              expectedDelistAt: String(deadline),
              transactionHash: hash,
              blockNumber: receipt.blockNumber,
              blockHash: receipt.blockHash,
              status: receipt.status,
            });
          }
        }
      } finally {
        await provider.send("anvil_stopImpersonatingAccount", [
          deployment.operation,
        ]);
      }
      writeImmutable("fork-rehearsal.json", {
        releaseHash,
        simulation: true,
        mainnetTransactionsSent: 0,
        status: "verified",
        receipts,
        scheduleChecks,
        statePreserved: true,
        couponV2: true,
        saleSchedulesLegacyDefault: true,
      });
    } finally {
      for (const hash of sentHashes) {
        const pending = await provider.send("eth_getTransactionByHash", [hash]);
        if (pending && pending.blockNumber === null)
          await provider.send("anvil_dropTransaction", [hash]);
      }
      await provider.send("anvil_stopImpersonatingAccount", [admin]);
      requireCheck(
        await provider.send("evm_revert", [snapshot]),
        "Fork snapshot cleanup failed"
      );
      const restored = await provider.getBlock("latest");
      requireCheck(
        restored.number === block.number && restored.hash === block.hash,
        "Fork canonical head not restored"
      );
      writeImmutable("fork-cleanup.json", {
        releaseHash,
        simulation: true,
        snapshotRestored: true,
        restoredBlockNumber: restored.number,
        restoredBlockHash: restored.hash,
        onlyOwnPendingTransactionsDropped: true,
      });
    }
  }
  console.log(
    json({
      releaseHash,
      report: out,
      simulation: localAnvil,
      transactionsPrepared: transactions.length,
      forkTransactionsVerified: receipts.length,
      mainnetTransactionsSent: 0,
      checks,
    })
  );
}
main().catch((error) => {
  console.error(
    String(error.shortMessage || error.message || "Preparation failed").replace(
      /https?:\S+/g,
      "[redacted-rpc]"
    )
  );
  process.exitCode = 1;
});
