import { promises as fs } from "fs";
import path from "path";
import { ethers, network, upgrades } from "hardhat";

const CHAIN_ID = 42161n;
const ADMIN = "0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2";
const OPERATION = "0x75dbC2b4afbf720731EC02425fFa1D2b69D103B5";
const VRF_COORDINATOR = "0x3C0Ca683b403E37668AE3DC4FB62F4B29B6f7a3e";
const VRF_KEY_HASH =
  "0xe9f223d7d83ec85c4f78042a4845af3a1c8df7757b4997b815ce4b8d07aca68c";
const VRF_SUBSCRIPTION_ID =
  27936069443540835983435969420798932866399708136088158844406747071392279608941n;
const VRF_REQUEST_CONFIRMATIONS = 1;
const VRF_CALLBACK_GAS_LIMIT = 2_500_000;

const CORE_FQN =
  "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";
const POINTS_FQN = "contracts/DDOUDOCOIN.sol:DOUDOCOIN";
const ROUTER_FQN = "contracts/DoudoVRFRouter.sol:DoudoVRFRouter";
const SERIES_OPS_FQN =
  "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable";
const BUNDLE_FQN =
  "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";
const REFUND_FQN =
  "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable";
const REDRAW_FQN =
  "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable";
const REWARD_FQN =
  "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable";
const BOOK_FQN =
  "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable";
const NFT_FQN = "contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT";
const REGISTRY_FQN =
  "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry";
const PUBLISHER_FQN =
  "contracts/MerchantSeriesPublisher.sol:MerchantSeriesPublisher";

const VOUCHER_URI_BASE =
  "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmWeK1VEwLbLJPgzPLzTjVgqK8ikrtg2FR2xf4xvdqKFV9/";
const VOUCHER_AMOUNTS = [
  10, 50, 100, 250, 500, 1000, 1500, 2000, 2500, 5000, 10000, 15000, 25000,
  30000,
];
const VOUCHER_MAX_PER_USER = 99_999;

const VRF_COORDINATOR_ABI = [
  "function addConsumer(uint256 subId, address consumer) external",
  "function getSubscription(uint256 subId) external view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
];

type DeploymentCheckpoint = {
  chainId: string;
  admin: string;
  operation: string;
  startBlock?: number;
  vrf?: {
    coordinator: string;
    keyHash: string;
    maxGasPriceLane: string;
    subscriptionId: string;
    requestConfirmations: number;
    callbackGasLimit: number;
    payment: string;
  };
  addresses: Record<string, string>;
  implementations: Record<string, string>;
  transactions: Record<string, string>;
  completed: string[];
};

const isFork = network.name === "arbitrumOneFork";
const execute =
  process.env.EXECUTE_ARBITRUM_ONE_DEPLOY === "1" ||
  (isFork && process.env.FORK_DRY_RUN === "1");
const checkpointPath = path.join(
  process.cwd(),
  "deployments",
  "arbitrum-one.json"
);

let checkpoint: DeploymentCheckpoint = {
  chainId: CHAIN_ID.toString(),
  admin: ADMIN,
  operation: OPERATION,
  addresses: {},
  implementations: {},
  transactions: {},
  completed: [],
};

async function saveCheckpoint() {
  if (isFork) return;
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  await fs.writeFile(
    checkpointPath,
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8"
  );
}

async function loadCheckpoint() {
  if (isFork) return;
  try {
    const parsed = JSON.parse(
      await fs.readFile(checkpointPath, "utf8")
    ) as DeploymentCheckpoint;
    if (
      parsed.chainId !== CHAIN_ID.toString() ||
      parsed.admin.toLowerCase() !== ADMIN.toLowerCase() ||
      parsed.operation.toLowerCase() !== OPERATION.toLowerCase()
    ) {
      throw new Error(`Checkpoint identity mismatch: ${checkpointPath}`);
    }
    checkpoint = parsed;
    console.log("Resuming checkpoint:", checkpointPath);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function requireCode(label: string, address: string) {
  if ((await ethers.provider.getCode(address)) === "0x") {
    throw new Error(`${label} has no contract code: ${address}`);
  }
}

async function preflight() {
  const activeNetwork = await ethers.provider.getNetwork();
  if (
    activeNetwork.chainId !== CHAIN_ID &&
    !(isFork && activeNetwork.chainId === 31337n)
  ) {
    throw new Error(
      `Expected Arbitrum One (${CHAIN_ID}), got ${activeNetwork.chainId}`
    );
  }

  const [adminCode, operationCode, coordinatorCode, adminBalance] =
    await Promise.all([
      ethers.provider.getCode(ADMIN),
      ethers.provider.getCode(OPERATION),
      ethers.provider.getCode(VRF_COORDINATOR),
      ethers.provider.getBalance(ADMIN),
    ]);
  if (adminCode !== "0x")
    throw new Error("ADMIN must be an EOA for this deploy");
  if (operationCode !== "0x") {
    throw new Error("OPERATION must be the configured backend signer EOA");
  }
  if (coordinatorCode === "0x") {
    throw new Error("VRF coordinator has no contract code");
  }

  const coordinator = await ethers.getContractAt(
    VRF_COORDINATOR_ABI,
    VRF_COORDINATOR
  );
  const subscription = await coordinator.getSubscription(VRF_SUBSCRIPTION_ID);
  if (subscription[3].toLowerCase() !== ADMIN.toLowerCase()) {
    throw new Error(
      `VRF subscription owner ${subscription[3]} does not match ADMIN ${ADMIN}`
    );
  }

  console.log("Arbitrum One deployment preflight");
  console.log("Chain ID:", activeNetwork.chainId.toString());
  console.log("Admin / deployer:", ADMIN);
  console.log("Backend operation signer:", OPERATION);
  console.log("Admin balance:", ethers.formatEther(adminBalance), "ETH");
  console.log("VRF coordinator:", VRF_COORDINATOR);
  console.log("VRF key hash (150 Gwei lane):", VRF_KEY_HASH);
  console.log("VRF subscription:", VRF_SUBSCRIPTION_ID.toString());
  console.log("VRF LINK balance:", ethers.formatUnits(subscription[0], 18));
  console.log("VRF native balance:", ethers.formatEther(subscription[1]));
  console.log("VRF existing consumers:", subscription[4].length);
  console.log("VRF request confirmations:", VRF_REQUEST_CONFIRMATIONS);
  console.log("VRF callback gas limit:", VRF_CALLBACK_GAS_LIMIT);
  console.log("Voucher types to initialize:", VOUCHER_AMOUNTS.length);

  if (!execute) {
    const missing = [
      !process.env.ARB_MAINNET_RPC_URL && "ARB_MAINNET_RPC_URL",
      !process.env.ARB_MAINNET_PK && "ARB_MAINNET_PK",
    ].filter(Boolean);
    console.log("Read-only preflight complete; no transaction was sent.");
    if (missing.length) {
      console.log("Missing execution-only environment:", missing.join(", "));
    }
    console.log(
      "Set EXECUTE_ARBITRUM_ONE_DEPLOY=1 only after the execution environment is ready."
    );
  }
}

async function deploymentSigner() {
  if (isFork) {
    await network.provider.request({
      method: "anvil_impersonateAccount",
      params: [ADMIN],
    });
    await network.provider.send("anvil_setBalance", [
      ADMIN,
      "0x3635C9ADC5DEA00000",
    ]);
    return ethers.getSigner(ADMIN);
  }

  if (!process.env.ARB_MAINNET_RPC_URL) {
    throw new Error("ARB_MAINNET_RPC_URL is required for execution");
  }
  if (!process.env.ARB_MAINNET_PK) {
    throw new Error("ARB_MAINNET_PK is required for execution");
  }
  const signers = await ethers.getSigners();
  if (signers.length !== 1) {
    throw new Error(
      `Expected exactly one configured signer, got ${signers.length}`
    );
  }
  const signerAddress = await signers[0].getAddress();
  if (signerAddress.toLowerCase() !== ADMIN.toLowerCase()) {
    throw new Error(
      `Configured signer ${signerAddress} does not match ADMIN ${ADMIN}`
    );
  }
  return signers[0];
}

async function recordTransaction(label: string, tx: any) {
  console.log(`${label} tx:`, tx.hash);
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`${label} transaction has no receipt`);
  checkpoint.transactions[label] = tx.hash;
  if (checkpoint.startBlock === undefined) {
    checkpoint.startBlock = receipt.blockNumber;
  }
  await saveCheckpoint();
  return receipt;
}

async function deployContract(
  key: string,
  fqn: string,
  args: unknown[],
  signer: any
): Promise<any> {
  const saved = checkpoint.addresses[key];
  if (saved) {
    await requireCode(key, saved);
    console.log(`${key} reused:`, saved);
    return ethers.getContractAt(fqn, saved, signer);
  }

  const Factory = await ethers.getContractFactory(fqn, signer);
  const contract: any = await Factory.deploy(...args);
  const deploymentTx = contract.deploymentTransaction();
  if (!deploymentTx) throw new Error(`${key} has no deployment transaction`);
  await recordTransaction(`deploy:${key}`, deploymentTx);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  checkpoint.addresses[key] = address;
  await saveCheckpoint();
  console.log(`${key}:`, address);
  return contract;
}

async function deployProxy(
  key: string,
  fqn: string,
  args: unknown[],
  signer: any,
  factory?: any
): Promise<any> {
  const saved = checkpoint.addresses[key];
  if (saved) {
    await requireCode(key, saved);
    const implementation = await upgrades.erc1967.getImplementationAddress(
      saved
    );
    checkpoint.implementations[key] = implementation;
    console.log(`${key} proxy reused:`, saved);
    return ethers.getContractAt(fqn, saved, signer);
  }

  const Factory = factory || (await ethers.getContractFactory(fqn, signer));
  const contract: any = await upgrades.deployProxy(Factory, args, {
    initializer: "initialize",
    kind: "uups",
    unsafeAllowLinkedLibraries: fqn === CORE_FQN,
  });
  const deploymentTx = contract.deploymentTransaction();
  if (!deploymentTx)
    throw new Error(`${key} proxy has no deployment transaction`);
  await recordTransaction(`deploy:${key}`, deploymentTx);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const implementation = await upgrades.erc1967.getImplementationAddress(
    address
  );
  checkpoint.addresses[key] = address;
  checkpoint.implementations[key] = implementation;
  await saveCheckpoint();
  console.log(`${key} proxy:`, address);
  console.log(`${key} implementation:`, implementation);
  return contract;
}

async function grantIfNeeded(
  contract: any,
  roleName: string,
  account: string,
  label: string
) {
  const role = await contract[roleName]();
  if (await contract.hasRole(role, account)) return;
  await recordTransaction(
    `grant:${label}:${roleName}:${account}`,
    await contract.grantRole(role, account)
  );
}

async function callOnce(
  key: string,
  check: () => Promise<boolean>,
  send: () => Promise<any>
) {
  if (await check()) {
    if (!checkpoint.completed.includes(key)) {
      checkpoint.completed.push(key);
      await saveCheckpoint();
    }
    return;
  }
  await recordTransaction(key, await send());
  checkpoint.completed.push(key);
  await saveCheckpoint();
}

async function deploySuite() {
  await loadCheckpoint();
  const signer = await deploymentSigner();

  const points = await deployContract(
    "DOUDOCOIN",
    POINTS_FQN,
    [ADMIN, ADMIN],
    signer
  );
  const router = await deployContract(
    "DOUDO_VRF_ROUTER",
    ROUTER_FQN,
    [
      VRF_COORDINATOR,
      VRF_SUBSCRIPTION_ID,
      VRF_KEY_HASH,
      VRF_REQUEST_CONFIRMATIONS,
      VRF_CALLBACK_GAS_LIMIT,
    ],
    signer
  );

  const prizeDrawLib = await deployContract(
    "DOUDO_PRIZE_DRAW_LIB",
    "contracts/helpers/DoudoPrizeDrawLib.sol:DoudoPrizeDrawLib",
    [],
    signer
  );
  const tokenUriLib = await deployContract(
    "DOUDO_TOKEN_URI_LIB",
    "contracts/helpers/DoudoTokenURILib.sol:DoudoTokenURILib",
    [],
    signer
  );
  const coreFactory = (
    await ethers.getContractFactory(CORE_FQN, {
      libraries: {
        DoudoPrizeDrawLib: await prizeDrawLib.getAddress(),
        DoudoTokenURILib: await tokenUriLib.getAddress(),
      },
    })
  ).connect(signer);

  const core = await deployProxy(
    "DOUDO_CORE",
    CORE_FQN,
    [await points.getAddress(), await router.getAddress()],
    signer,
    coreFactory
  );
  const seriesOps = await deployProxy(
    "DOUDO_SERIES_OPS_MODULE",
    SERIES_OPS_FQN,
    [await core.getAddress()],
    signer
  );
  const bundle = await deployProxy(
    "DOUDO_BUNDLE_MODULE",
    BUNDLE_FQN,
    [await core.getAddress(), await points.getAddress()],
    signer
  );
  const refund = await deployProxy(
    "DOUDO_REFUND_MODULE",
    REFUND_FQN,
    [await core.getAddress(), await points.getAddress()],
    signer
  );
  const redraw = await deployProxy(
    "DOUDO_REDRAW_MODULE",
    REDRAW_FQN,
    [await core.getAddress(), await router.getAddress()],
    signer
  );
  const reward = await deployProxy(
    "DOUDO_COLLECTION_REWARD_MODULE",
    REWARD_FQN,
    [await core.getAddress(), await points.getAddress()],
    signer
  );
  const book = await deployProxy(
    "DOUDO_COLLECTION_BOOK",
    BOOK_FQN,
    [await points.getAddress()],
    signer
  );
  const nft = await deployProxy(
    "DOUDO_COIN_NFT",
    NFT_FQN,
    [await points.getAddress(), ADMIN, OPERATION],
    signer
  );
  const registry = await deployProxy(
    "DOUDO_MERCHANT_REGISTRY",
    REGISTRY_FQN,
    [ADMIN],
    signer
  );
  const publisher = await deployProxy(
    "DOUDO_MERCHANT_PUBLISHER",
    PUBLISHER_FQN,
    [ADMIN, await registry.getAddress()],
    signer
  );

  await callOnce(
    "wire:core:seriesOps",
    async () => checkpoint.completed.includes("wire:core:seriesOps"),
    () => core.setSeriesOpsModule(seriesOps.getAddress())
  );
  for (const [label, module] of [
    ["bundle", bundle],
    ["refund", refund],
    ["redraw", redraw],
    ["reward", reward],
  ] as const) {
    await grantIfNeeded(
      core,
      "MODULE_ROLE",
      await module.getAddress(),
      `core:${label}`
    );
  }

  await callOnce(
    "wire:router:core",
    () => router.isRequester(core.getAddress()),
    () => router.setRequester(core.getAddress(), true)
  );
  await callOnce(
    "wire:router:redraw",
    () => router.isRequester(redraw.getAddress()),
    () => router.setRequester(redraw.getAddress(), true)
  );

  for (const [roleName, target, label] of [
    ["BURNER_ROLE", await core.getAddress(), "core"],
    ["BURNER_ROLE", await bundle.getAddress(), "bundle"],
    ["MINTER_ROLE", await bundle.getAddress(), "bundle"],
    ["MINTER_ROLE", await refund.getAddress(), "refund"],
    ["MINTER_ROLE", await reward.getAddress(), "reward"],
    ["MINTER_ROLE", await book.getAddress(), "book"],
    ["MINTER_ROLE", await nft.getAddress(), "nft"],
  ] as const) {
    await grantIfNeeded(points, roleName, target, `points:${label}`);
  }

  await callOnce(
    "wire:bundle:redraw",
    async () =>
      (await bundle.redrawModule()).toLowerCase() ===
      (await redraw.getAddress()).toLowerCase(),
    () => bundle.setRedrawModule(redraw.getAddress())
  );
  await callOnce(
    "wire:redraw:bundle",
    async () =>
      (await redraw.bundleModule()).toLowerCase() ===
      (await bundle.getAddress()).toLowerCase(),
    () => redraw.setBundleModule(bundle.getAddress())
  );
  await callOnce(
    "wire:reward:book",
    async () =>
      (await reward.collectionBook()).toLowerCase() ===
      (await book.getAddress()).toLowerCase(),
    () => reward.setCollectionBook(book.getAddress())
  );
  await callOnce(
    "wire:book:reward",
    async () =>
      (await book.doudochainV2RewardTarget()).toLowerCase() ===
      (await reward.getAddress()).toLowerCase(),
    () => book.setDoudochainV2RewardTarget(reward.getAddress())
  );

  await grantIfNeeded(core, "OPERATION_ROLE", OPERATION, "core");
  await grantIfNeeded(core, "ADMINMINT_ROLE", OPERATION, "core");
  for (const [label, contract] of [
    ["seriesOps", seriesOps],
    ["bundle", bundle],
    ["refund", refund],
    ["redraw", redraw],
    ["reward", reward],
    ["book", book],
  ] as const) {
    await grantIfNeeded(contract, "OPERATION_ROLE", OPERATION, label);
  }

  await grantIfNeeded(
    core,
    "OPERATION_ROLE",
    await publisher.getAddress(),
    "core:publisher"
  );
  await grantIfNeeded(
    registry,
    "LINKER_ROLE",
    await publisher.getAddress(),
    "registry:publisher"
  );
  await grantIfNeeded(
    publisher,
    "PUBLISHER_OPERATION_ROLE",
    OPERATION,
    "publisher"
  );

  for (const [index, amount] of VOUCHER_AMOUNTS.entries()) {
    await callOnce(
      `voucher:${index}`,
      async () => (await nft.nextVoucherTypeId()) > BigInt(index),
      () =>
        nft.createVoucherType(
          amount,
          VOUCHER_MAX_PER_USER,
          `${VOUCHER_URI_BASE}${amount}.json`
        )
    );
  }

  const coordinator = await ethers.getContractAt(
    VRF_COORDINATOR_ABI,
    VRF_COORDINATOR,
    signer
  );
  const routerAddress = await router.getAddress();
  await callOnce(
    "vrf:addConsumer",
    async () => {
      const subscription = await coordinator.getSubscription(
        VRF_SUBSCRIPTION_ID
      );
      return (subscription[4] as string[]).some(
        (consumer) => consumer.toLowerCase() === routerAddress.toLowerCase()
      );
    },
    () => coordinator.addConsumer(VRF_SUBSCRIPTION_ID, routerAddress)
  );
  await callOnce(
    `vrf:config:confirmations:${VRF_REQUEST_CONFIRMATIONS}`,
    async () =>
      (await router.s_vrfCoordinator()).toLowerCase() ===
        VRF_COORDINATOR.toLowerCase() &&
      (await router.subscriptionId()) === VRF_SUBSCRIPTION_ID &&
      (await router.keyHash()) === VRF_KEY_HASH &&
      (await router.callbackGasLimit()) === BigInt(VRF_CALLBACK_GAS_LIMIT) &&
      (await router.requestConfirmations()) ===
        BigInt(VRF_REQUEST_CONFIRMATIONS),
    () =>
      router.setVrfConfig(
        VRF_COORDINATOR,
        VRF_SUBSCRIPTION_ID,
        VRF_KEY_HASH,
        VRF_CALLBACK_GAS_LIMIT,
        VRF_REQUEST_CONFIRMATIONS
      )
  );

  const assertions: Array<[string, boolean]> = [
    [
      "router owner is admin",
      (await router.owner()).toLowerCase() === ADMIN.toLowerCase(),
    ],
    [
      "router coordinator",
      (await router.s_vrfCoordinator()).toLowerCase() ===
        VRF_COORDINATOR.toLowerCase(),
    ],
    [
      "router subscription",
      (await router.subscriptionId()) === VRF_SUBSCRIPTION_ID,
    ],
    ["router key hash", (await router.keyHash()) === VRF_KEY_HASH],
    [
      "router confirmations",
      (await router.requestConfirmations()) ===
        BigInt(VRF_REQUEST_CONFIRMATIONS),
    ],
    [
      "router callback gas",
      (await router.callbackGasLimit()) === BigInt(VRF_CALLBACK_GAS_LIMIT),
    ],
    [
      "router core requester",
      await router.isRequester(await core.getAddress()),
    ],
    [
      "router redraw requester",
      await router.isRequester(await redraw.getAddress()),
    ],
    [
      "operation has core OPERATION_ROLE",
      await core.hasRole(await core.OPERATION_ROLE(), OPERATION),
    ],
    [
      "operation has core ADMINMINT_ROLE",
      await core.hasRole(await core.ADMINMINT_ROLE(), OPERATION),
    ],
    [
      "operation has NFT MINTER_ROLE",
      await nft.hasRole(await nft.MINTER_ROLE(), OPERATION),
    ],
    [
      "operation has publisher role",
      await publisher.hasRole(
        await publisher.PUBLISHER_OPERATION_ROLE(),
        OPERATION
      ),
    ],
    [
      "publisher has core OPERATION_ROLE",
      await core.hasRole(
        await core.OPERATION_ROLE(),
        await publisher.getAddress()
      ),
    ],
    [
      "publisher has registry LINKER_ROLE",
      await registry.hasRole(
        await registry.LINKER_ROLE(),
        await publisher.getAddress()
      ),
    ],
    ["voucher types initialized", (await nft.nextVoucherTypeId()) === 14n],
  ];
  for (const [label, contract] of [
    ["seriesOps", seriesOps],
    ["bundle", bundle],
    ["refund", refund],
    ["redraw", redraw],
    ["reward", reward],
    ["book", book],
  ] as const) {
    assertions.push([
      `operation has ${label} OPERATION_ROLE`,
      await contract.hasRole(await contract.OPERATION_ROLE(), OPERATION),
    ]);
  }
  for (const [roleName, target, label] of [
    ["BURNER_ROLE", await core.getAddress(), "core"],
    ["BURNER_ROLE", await bundle.getAddress(), "bundle"],
    ["MINTER_ROLE", await bundle.getAddress(), "bundle"],
    ["MINTER_ROLE", await refund.getAddress(), "refund"],
    ["MINTER_ROLE", await reward.getAddress(), "reward"],
    ["MINTER_ROLE", await book.getAddress(), "book"],
    ["MINTER_ROLE", await nft.getAddress(), "nft"],
  ] as const) {
    assertions.push([
      `points ${roleName} wired to ${label}`,
      await points.hasRole(await points[roleName](), target),
    ]);
  }
  for (const [index, amount] of VOUCHER_AMOUNTS.entries()) {
    const voucher = await nft.voucherTypes(index);
    assertions.push([
      `voucher ${index} matches committed config`,
      voucher.amount === BigInt(amount) &&
        voucher.maxPerUser === BigInt(VOUCHER_MAX_PER_USER) &&
        voucher.tokenURI === `${VOUCHER_URI_BASE}${amount}.json`,
    ]);
  }
  for (const [label, ok] of assertions) {
    console.log(`${ok ? "OK" : "FAIL"} - ${label}`);
    if (!ok) throw new Error(`Post-deploy assertion failed: ${label}`);
  }

  const subscription = await coordinator.getSubscription(VRF_SUBSCRIPTION_ID);
  const routerIsConsumer = (subscription[4] as string[]).some(
    (consumer) => consumer.toLowerCase() === routerAddress.toLowerCase()
  );
  if (!routerIsConsumer) {
    throw new Error("VRF router is not registered as subscription consumer");
  }

  if (!checkpoint.completed.includes("POST_DEPLOY_VERIFIED")) {
    checkpoint.completed.push("POST_DEPLOY_VERIFIED");
  }
  checkpoint.vrf = {
    coordinator: VRF_COORDINATOR,
    keyHash: VRF_KEY_HASH,
    maxGasPriceLane: "150 Gwei",
    subscriptionId: VRF_SUBSCRIPTION_ID.toString(),
    requestConfirmations: VRF_REQUEST_CONFIRMATIONS,
    callbackGasLimit: VRF_CALLBACK_GAS_LIMIT,
    payment: "LINK",
  };
  await saveCheckpoint();

  console.log("ARBITRUM_ONE_DEPLOYMENT_JSON_START");
  console.log(JSON.stringify(checkpoint, null, 2));
  console.log("ARBITRUM_ONE_DEPLOYMENT_JSON_END");
}

async function main() {
  await preflight();
  if (!execute) return;
  await deploySuite();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
