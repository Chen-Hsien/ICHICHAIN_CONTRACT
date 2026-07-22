import { ethers } from "hardhat";

const ADDRESSES = {
  core: process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  reward:
    process.env.DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS ||
    "0x680618a6933DD68fF84Ff9F64760120d27400B3C",
  book: process.env.COLLECTION_BOOK_PROXY_ADDRESS || "0x4284be399cA9591fBd98248969fCcb969E21B2C6",
};

const BOOK_ID = 1n;
const definition = {
  name: "Dragon Ball Part 2 - NFT Reward Collection",
  rewardKind: 0,
  rewardData: BOOK_ID,
  active: true,
  slots: [
    { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 7, quantity: 1 },
    { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 8, quantity: 1 },
    { sourceContract: ADDRESSES.core, seriesID: 0, prizeId: 9, quantity: 1 },
  ],
};

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

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Deployer:", deployerAddress);
  console.log("CollectionBook:", ADDRESSES.book);
  console.log("CollectionRewardModule:", ADDRESSES.reward);

  const existingBook0 = await book.books(0);
  const existingBook1 = await book.books(BOOK_ID);
  const existingRequired1 = await book.totalRequired(BOOK_ID);
  const existingReward1 = await reward.rewardConfigs(BOOK_ID);

  console.log("Existing book 0:", {
    name: existingBook0.name,
    rewardKind: existingBook0.rewardKind.toString(),
    rewardData: existingBook0.rewardData.toString(),
    active: existingBook0.active,
    totalRequired: (await book.totalRequired(0)).toString(),
  });
  console.log("Existing book 1:", {
    name: existingBook1.name,
    rewardKind: existingBook1.rewardKind.toString(),
    rewardData: existingBook1.rewardData.toString(),
    active: existingBook1.active,
    totalRequired: existingRequired1.toString(),
  });
  console.log("Existing reward config 1:", {
    rewardKind: existingReward1.rewardKind.toString(),
    pointsAmount: existingReward1.pointsAmount.toString(),
    seriesID: existingReward1.seriesID.toString(),
    prizeID: existingReward1.prizeID.toString(),
    active: existingReward1.active,
  });

  if (existingRequired1 !== 0n) {
    console.log("Book 1 already exists, skipping create.");
    return;
  }
  if (
    existingReward1.rewardKind !== 0n ||
    existingReward1.seriesID !== 0n ||
    existingReward1.prizeID !== 5n ||
    !existingReward1.active
  ) {
    throw new Error("Reward config 1 is not the expected NFT reward config");
  }

  const expectedBookId = await book.createBook.staticCall(
    definition.name,
    definition.slots,
    definition.rewardKind,
    definition.rewardData,
    definition.active
  );
  if (expectedBookId !== BOOK_ID) {
    throw new Error(`Expected next bookId ${BOOK_ID}, got ${expectedBookId}`);
  }

  const estimatedGas = await book.createBook.estimateGas(
    definition.name,
    definition.slots,
    definition.rewardKind,
    definition.rewardData,
    definition.active
  );
  const gasLimit = (estimatedGas * 200n) / 100n;
  console.log("Create book estimated gas:", estimatedGas.toString());
  console.log("Create book gas limit:", gasLimit.toString());

  const tx = await book.createBook(
    definition.name,
    definition.slots,
    definition.rewardKind,
    definition.rewardData,
    definition.active,
    { gasLimit }
  );
  console.log("Create book tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Create book block:", receipt?.blockNumber);
  console.log("Create book gas used:", receipt?.gasUsed.toString());

  const storedBook = await book.books(BOOK_ID);
  console.log("Stored book 1:", {
    name: storedBook.name,
    rewardKind: storedBook.rewardKind.toString(),
    rewardData: storedBook.rewardData.toString(),
    active: storedBook.active,
    totalRequired: (await book.totalRequired(BOOK_ID)).toString(),
  });
  for (let i = 0; i < definition.slots.length; i++) {
    const slot = await book.bookSlots(BOOK_ID, i);
    console.log("Stored slot:", {
      slotIndex: i,
      sourceContract: slot.sourceContract,
      seriesID: slot.seriesID.toString(),
      prizeId: slot.prizeId.toString(),
      quantity: slot.quantity.toString(),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
