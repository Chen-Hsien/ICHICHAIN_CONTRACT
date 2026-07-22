import { ethers } from "hardhat";

const ADDRESSES = {
  reward:
    process.env.DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS ||
    "0x680618a6933DD68fF84Ff9F64760120d27400B3C",
  book: process.env.COLLECTION_BOOK_PROXY_ADDRESS || "0x4284be399cA9591fBd98248969fCcb969E21B2C6",
};

const bookIds = [0n, 1n];

async function main() {
  const network = await ethers.provider.getNetwork();
  const book = await ethers.getContractAt(
    "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable",
    ADDRESSES.book
  );
  const reward = await ethers.getContractAt(
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable",
    ADDRESSES.reward
  );

  console.log("Network:", network.name, network.chainId.toString());
  console.log("CollectionBook:", ADDRESSES.book);
  console.log("CollectionRewardModule:", ADDRESSES.reward);

  for (const bookId of bookIds) {
    const storedBook = await book.books(bookId);
    const totalRequired = await book.totalRequired(bookId);
    const rewardConfig = await reward.rewardConfigs(bookId);
    console.log("Book:", {
      bookId: bookId.toString(),
      name: storedBook.name,
      rewardKind: storedBook.rewardKind.toString(),
      rewardData: storedBook.rewardData.toString(),
      active: storedBook.active,
      totalRequired: totalRequired.toString(),
    });
    console.log("Reward config:", {
      bookId: bookId.toString(),
      rewardKind: rewardConfig.rewardKind.toString(),
      pointsAmount: rewardConfig.pointsAmount.toString(),
      seriesID: rewardConfig.seriesID.toString(),
      prizeID: rewardConfig.prizeID.toString(),
      active: rewardConfig.active,
    });

    for (let i = 0n; i < 3n; i++) {
      const slot = await book.bookSlots(bookId, i);
      console.log("Slot:", {
        bookId: bookId.toString(),
        slotIndex: i.toString(),
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
