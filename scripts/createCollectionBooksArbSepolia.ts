import { ethers } from "hardhat";

const ADDRESSES = {
  core: process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  reward:
    process.env.DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS ||
    "0x680618a6933DD68fF84Ff9F64760120d27400B3C",
  book: process.env.COLLECTION_BOOK_PROXY_ADDRESS || "0x4284be399cA9591fBd98248969fCcb969E21B2C6",
};

const RewardKind = {
  NftPrize: 0,
  Points: 1,
  UnlockSeries: 2,
} as const;

const collectionBooks = [
  {
    name: "Dragon Ball Part 2 - Points Collection",
    rewardKind: RewardKind.Points,
    rewardConfig: {
      rewardKind: RewardKind.Points,
      pointsAmount: ethers.parseEther("500"),
      seriesID: 0,
      prizeID: 0,
      active: true,
    },
    slots: [
      { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 8, quantity: 3 },
      { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 9, quantity: 3 },
      { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 10, quantity: 3 },
    ],
  },
  {
    name: "Dragon Ball Part 2 - NFT Reward Collection",
    rewardKind: RewardKind.NftPrize,
    rewardConfig: {
      rewardKind: RewardKind.NftPrize,
      pointsAmount: 0n,
      seriesID: 0,
      prizeID: 5,
      active: true,
    },
    slots: [
      { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 7, quantity: 1 },
      { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 8, quantity: 1 },
      { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 9, quantity: 1 },
    ],
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const deployerAddress = await deployer.getAddress();
  const book = await ethers.getContractAt(
    "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable",
    ADDRESSES.book
  );
  const reward = await ethers.getContractAt(
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable",
    ADDRESSES.reward
  );

  const bookOperationRole = await book.OPERATION_ROLE();
  const rewardOperationRole = await reward.OPERATION_ROLE();
  const hasBookOperationRole = await book.hasRole(bookOperationRole, deployerAddress);
  const hasRewardOperationRole = await reward.hasRole(rewardOperationRole, deployerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Deployer:", deployerAddress);
  console.log("Core:", ADDRESSES.core);
  console.log("CollectionBook:", ADDRESSES.book);
  console.log("CollectionRewardModule:", ADDRESSES.reward);
  console.log("Has Book OPERATION_ROLE:", hasBookOperationRole);
  console.log("Has Reward OPERATION_ROLE:", hasRewardOperationRole);
  console.log("Book reward target:", await book.doudochainV2RewardTarget());
  console.log("Reward collection book:", await reward.collectionBook());

  if (!hasBookOperationRole) {
    throw new Error(`Deployer ${deployerAddress} does not have CollectionBook OPERATION_ROLE`);
  }
  if (!hasRewardOperationRole) {
    throw new Error(`Deployer ${deployerAddress} does not have CollectionReward OPERATION_ROLE`);
  }
  if ((await book.doudochainV2RewardTarget()).toLowerCase() !== ADDRESSES.reward.toLowerCase()) {
    throw new Error("CollectionBook reward target is not the configured CollectionRewardModule");
  }
  if ((await reward.collectionBook()).toLowerCase() !== ADDRESSES.book.toLowerCase()) {
    throw new Error("CollectionRewardModule collectionBook is not the configured CollectionBook");
  }

  for (const definition of collectionBooks) {
    const expectedBookId = await book.createBook.staticCall(
      definition.name,
      definition.slots,
      definition.rewardKind,
      0,
      true
    );

    const rewardConfig = definition.rewardConfig;
    console.log("Expected bookId:", expectedBookId.toString());
    console.log("Book name:", definition.name);
    console.log("Reward kind:", definition.rewardKind);
    console.log("Reward config:", {
      rewardKind: rewardConfig.rewardKind,
      pointsAmount: rewardConfig.pointsAmount.toString(),
      seriesID: rewardConfig.seriesID,
      prizeID: rewardConfig.prizeID,
      active: rewardConfig.active,
    });

    await reward.setCollectionRewardConfig.staticCall(expectedBookId, rewardConfig);
    const rewardGas = await reward.setCollectionRewardConfig.estimateGas(expectedBookId, rewardConfig);
    console.log("Reward config estimated gas:", rewardGas.toString());

    const setRewardTx = await reward.setCollectionRewardConfig(expectedBookId, rewardConfig);
    console.log("Reward config tx:", setRewardTx.hash);
    const setRewardReceipt = await setRewardTx.wait();
    console.log("Reward config block:", setRewardReceipt?.blockNumber);
    console.log("Reward config gas used:", setRewardReceipt?.gasUsed.toString());

    await book.createBook.staticCall(
      definition.name,
      definition.slots,
      definition.rewardKind,
      expectedBookId,
      true
    );
    const createGas = await book.createBook.estimateGas(
      definition.name,
      definition.slots,
      definition.rewardKind,
      expectedBookId,
      true
    );
    console.log("Create book estimated gas:", createGas.toString());

    const createBookTx = await book.createBook(
      definition.name,
      definition.slots,
      definition.rewardKind,
      expectedBookId,
      true
    );
    console.log("Create book tx:", createBookTx.hash);
    const createBookReceipt = await createBookTx.wait();
    console.log("Create book block:", createBookReceipt?.blockNumber);
    console.log("Create book gas used:", createBookReceipt?.gasUsed.toString());

    const storedBook = await book.books(expectedBookId);
    const storedRewardConfig = await reward.rewardConfigs(expectedBookId);
    console.log("Stored book:", {
      name: storedBook.name,
      rewardKind: storedBook.rewardKind.toString(),
      rewardData: storedBook.rewardData.toString(),
      active: storedBook.active,
      totalRequired: (await book.totalRequired(expectedBookId)).toString(),
    });
    console.log("Stored reward config:", {
      rewardKind: storedRewardConfig.rewardKind.toString(),
      pointsAmount: storedRewardConfig.pointsAmount.toString(),
      seriesID: storedRewardConfig.seriesID.toString(),
      prizeID: storedRewardConfig.prizeID.toString(),
      active: storedRewardConfig.active,
    });

    for (let i = 0; i < definition.slots.length; i++) {
      const slot = await book.bookSlots(expectedBookId, i);
      console.log("Stored slot:", {
        slotIndex: i,
        sourceContract: slot.sourceContract,
        seriesID: slot.seriesID.toString(),
        prizeId: slot.prizeId.toString(),
        quantity: slot.quantity.toString(),
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
