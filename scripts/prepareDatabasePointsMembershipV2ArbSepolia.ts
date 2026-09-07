import { ethers, run, upgrades } from "hardhat";

const ADDRESSES = {
  bundle: "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
  refund: "0x8ee19238DAa466B7792BE33569c6E4f6993CCf20",
  collectionReward: "0x680618a6933DD68fF84Ff9F64760120d27400B3C",
  legacyNft: "0x1F1150AC2d7a8208A2743a4E74e8401Ff9F1ED53",
} as const;

const CONTRACTS = {
  bundle:
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable",
  refund:
    "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable",
  collectionReward:
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable",
  legacyNft: "contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT",
  membership:
    "contracts/DoudoMembershipV2Upgradeable.sol:DoudoMembershipV2Upgradeable",
} as const;

const verify = async (address: string, contract: string) => {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract,
    });
    return "VERIFIED";
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (message.toLowerCase().includes("already verified")) {
      return "ALREADY_VERIFIED";
    }
    console.warn(`Verification deferred for ${address}: ${message}`);
    return "DEFERRED";
  }
};

async function main() {
  const execute =
    process.env.EXECUTE_DATABASE_POINTS_IMPLEMENTATION_PREPARE === "1";
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 421614n) {
    throw new Error(`Expected Arbitrum Sepolia, got ${network.chainId}`);
  }
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("ARB_TESTNET_PK is required");
  const signerAddress = await signer.getAddress();
  const signerBalance = await ethers.provider.getBalance(signerAddress);
  if (signerBalance === 0n) throw new Error("Deployment signer has no ETH");

  const factories = {
    bundle: await ethers.getContractFactory(CONTRACTS.bundle),
    refund: await ethers.getContractFactory(CONTRACTS.refund),
    collectionReward: await ethers.getContractFactory(
      CONTRACTS.collectionReward
    ),
    legacyNft: await ethers.getContractFactory(CONTRACTS.legacyNft),
    membership: await ethers.getContractFactory(CONTRACTS.membership),
  };
  const currentImplementations = {
    bundle: await upgrades.erc1967.getImplementationAddress(ADDRESSES.bundle),
    refund: await upgrades.erc1967.getImplementationAddress(ADDRESSES.refund),
    collectionReward: await upgrades.erc1967.getImplementationAddress(
      ADDRESSES.collectionReward
    ),
    legacyNft: await upgrades.erc1967.getImplementationAddress(
      ADDRESSES.legacyNft
    ),
  };
  await upgrades.validateUpgrade(ADDRESSES.bundle, factories.bundle, {
    kind: "uups",
  });
  await upgrades.validateUpgrade(ADDRESSES.refund, factories.refund, {
    kind: "uups",
  });
  await upgrades.validateUpgrade(
    ADDRESSES.collectionReward,
    factories.collectionReward,
    { kind: "uups" }
  );
  await upgrades.validateUpgrade(ADDRESSES.legacyNft, factories.legacyNft, {
    kind: "uups",
  });
  await upgrades.validateImplementation(factories.membership, { kind: "uups" });

  console.log(
    JSON.stringify(
      {
        execute,
        chainId: network.chainId.toString(),
        signer: signerAddress,
        signerBalanceWei: signerBalance.toString(),
        proxies: ADDRESSES,
        currentImplementations,
        validation: "PASSED",
      },
      null,
      2
    )
  );
  if (!execute) return;

  const preparedImplementations = {
    bundle: await upgrades.prepareUpgrade(ADDRESSES.bundle, factories.bundle, {
      kind: "uups",
    }),
    refund: await upgrades.prepareUpgrade(ADDRESSES.refund, factories.refund, {
      kind: "uups",
    }),
    collectionReward: await upgrades.prepareUpgrade(
      ADDRESSES.collectionReward,
      factories.collectionReward,
      { kind: "uups" }
    ),
    legacyNft: await upgrades.prepareUpgrade(
      ADDRESSES.legacyNft,
      factories.legacyNft,
      { kind: "uups" }
    ),
    membership: await upgrades.deployImplementation(factories.membership, {
      kind: "uups",
    }),
  };
  for (const [name, address] of Object.entries(preparedImplementations)) {
    if (
      !ethers.isAddress(address) ||
      (await ethers.provider.getCode(address)) === "0x"
    ) {
      throw new Error(
        `Prepared ${name} implementation has no code: ${address}`
      );
    }
  }
  for (const [name, proxy] of Object.entries(ADDRESSES)) {
    const current = await upgrades.erc1967.getImplementationAddress(proxy);
    if (
      current.toLowerCase() !==
      currentImplementations[
        name as keyof typeof currentImplementations
      ].toLowerCase()
    ) {
      throw new Error(
        `Prepare unexpectedly changed ${name} proxy implementation`
      );
    }
  }

  const verification = {
    bundle: await verify(preparedImplementations.bundle, CONTRACTS.bundle),
    refund: await verify(preparedImplementations.refund, CONTRACTS.refund),
    collectionReward: await verify(
      preparedImplementations.collectionReward,
      CONTRACTS.collectionReward
    ),
    legacyNft: await verify(
      preparedImplementations.legacyNft,
      CONTRACTS.legacyNft
    ),
    membership: await verify(
      preparedImplementations.membership,
      CONTRACTS.membership
    ),
  };
  console.log(
    JSON.stringify(
      {
        status: "PREPARED",
        preparedImplementations,
        verification,
        proxiesRemainUnchanged: true,
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
