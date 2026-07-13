import { ethers, upgrades, run } from "hardhat";
import { CORE_FQN } from "./linkedCoreFactory";

const BOOK_FQN =
  "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable";

const DEFAULTS = {
  chainId: 421614n,
  officialOps: "0x226f0197D502e7AC87d1A76D6526945DFa9E4209",
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  book: "0x4284be399cA9591fBd98248969fCcb969E21B2C6",
};

async function coreFactory(linkedLibraries?: {
  DoudoPrizeDrawLib: string;
  DoudoTokenURILib: string;
}) {
  if (linkedLibraries) {
    return ethers.getContractFactory(CORE_FQN, {
      libraries: linkedLibraries,
    });
  }

  const PrizeDrawLib = await ethers.getContractFactory(
    "contracts/helpers/DoudoPrizeDrawLib.sol:DoudoPrizeDrawLib"
  );
  const prizeDrawLib = await PrizeDrawLib.deploy();
  await prizeDrawLib.waitForDeployment();

  const TokenURILib = await ethers.getContractFactory(
    "contracts/helpers/DoudoTokenURILib.sol:DoudoTokenURILib"
  );
  const tokenURILib = await TokenURILib.deploy();
  await tokenURILib.waitForDeployment();

  const libraries = {
    DoudoPrizeDrawLib: await prizeDrawLib.getAddress(),
    DoudoTokenURILib: await tokenURILib.getAddress(),
  };
  console.log("DoudoPrizeDrawLib:", libraries.DoudoPrizeDrawLib);
  console.log("DoudoTokenURILib:", libraries.DoudoTokenURILib);
  return ethers.getContractFactory(CORE_FQN, { libraries });
}

async function verify(address: string, contract: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract,
    });
    console.log("Verified:", address, contract);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address, contract);
      return;
    }
    console.warn("Verification failed (upgrade remains valid):", address, message);
  }
}

async function main() {
  const dryRun = (process.env.DRY_RUN || "false").toLowerCase() === "true";
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const bookProxy = process.env.COLLECTION_BOOK_PROXY_ADDRESS || DEFAULTS.book;
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log("Network chainId:", network.chainId.toString());
  console.log("Dry run:", dryRun);
  console.log("Upgrader:", deployerAddress);
  console.log("Balance:", ethers.formatEther(balance));
  console.log("Core proxy:", coreProxy);
  console.log("CollectionBook proxy:", bookProxy);

  if (network.chainId !== DEFAULTS.chainId) {
    throw new Error(`Expected chainId ${DEFAULTS.chainId}, got ${network.chainId}`);
  }
  if (deployerAddress.toLowerCase() !== DEFAULTS.officialOps.toLowerCase()) {
    throw new Error(`Unexpected upgrader wallet: ${deployerAddress}`);
  }
  if (balance === 0n) throw new Error("Upgrader wallet has no native gas balance");

  const oldCoreImplementation =
    await upgrades.erc1967.getImplementationAddress(coreProxy);
  const oldBookImplementation =
    await upgrades.erc1967.getImplementationAddress(bookProxy);
  console.log("Old Core implementation:", oldCoreImplementation);
  console.log("Old CollectionBook implementation:", oldBookImplementation);

  const core: any = await ethers.getContractAt(CORE_FQN, coreProxy);
  const book: any = await ethers.getContractAt(BOOK_FQN, bookProxy);
  const before = {
    paused: await core.paused(),
    router: await core.vrfRouter(),
    points: await core.doudoPoints(),
    bookPoints: await book.doudoPoints(),
    rewardTarget: await book.doudochainV2RewardTarget(),
  };

  const dryRunLibraries = {
    DoudoPrizeDrawLib: DEFAULTS.officialOps,
    DoudoTokenURILib: DEFAULTS.officialOps,
  };
  const validationCoreFactory = await coreFactory(dryRunLibraries);
  const Book = await ethers.getContractFactory(BOOK_FQN);
  await upgrades.validateUpgrade(coreProxy, validationCoreFactory, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await upgrades.validateUpgrade(bookProxy, Book, { kind: "uups" });
  console.log("Storage-layout validation: OK");

  if (dryRun) {
    console.log("Preflight complete. No transaction sent.");
    return;
  }

  let pausedByScript = false;
  try {
    if (!before.paused) {
      const pauseTx = await core.pause();
      console.log("Core pause tx:", pauseTx.hash);
      await pauseTx.wait();
      pausedByScript = true;
    }

    const Core = await coreFactory();
    const upgradedCore: any = await upgrades.upgradeProxy(coreProxy, Core, {
      kind: "uups",
      unsafeAllowLinkedLibraries: true,
    });
    await upgradedCore.waitForDeployment();
    const newCoreImplementation =
      await upgrades.erc1967.getImplementationAddress(coreProxy);
    console.log("New Core implementation:", newCoreImplementation);

    const upgradedBook: any = await upgrades.upgradeProxy(bookProxy, Book, {
      kind: "uups",
    });
    await upgradedBook.waitForDeployment();
    const newBookImplementation =
      await upgrades.erc1967.getImplementationAddress(bookProxy);
    console.log("New CollectionBook implementation:", newBookImplementation);

    if (newCoreImplementation.toLowerCase() === oldCoreImplementation.toLowerCase()) {
      throw new Error("Core implementation did not change");
    }
    if (newBookImplementation.toLowerCase() === oldBookImplementation.toLowerCase()) {
      throw new Error("CollectionBook implementation did not change");
    }
    if ((await upgradedCore.vrfRouter()).toLowerCase() !== before.router.toLowerCase()) {
      throw new Error("Core router changed unexpectedly");
    }
    if ((await upgradedCore.doudoPoints()).toLowerCase() !== before.points.toLowerCase()) {
      throw new Error("Core points address changed unexpectedly");
    }
    if ((await upgradedBook.doudoPoints()).toLowerCase() !== before.bookPoints.toLowerCase()) {
      throw new Error("CollectionBook points address changed unexpectedly");
    }
    if (
      (await upgradedBook.doudochainV2RewardTarget()).toLowerCase() !==
      before.rewardTarget.toLowerCase()
    ) {
      throw new Error("CollectionBook reward target changed unexpectedly");
    }
    console.log("Post-upgrade wiring assertions: OK");

    await verify(newCoreImplementation, CORE_FQN);
    await verify(newBookImplementation, BOOK_FQN);
  } finally {
    if (pausedByScript && (await core.paused())) {
      const unpauseTx = await core.unpause();
      console.log("Core unpause tx:", unpauseTx.hash);
      await unpauseTx.wait();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
