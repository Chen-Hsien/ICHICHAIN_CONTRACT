import { expect } from "chai";
import {
  DEAD_ADDRESS,
  buildCoinNftMigrationRows,
  buildRevealedUnexchangedTicketRows,
  calculateErc20Balances,
  calculateErc721Owners,
  summarizeRevealedUnexchanged,
  summarizePhysicalPrizeReservations,
  ZERO_ADDRESS,
} from "../scripts/migrationReportLogic";

const alice = "0x0000000000000000000000000000000000000a11";
const bob = "0x0000000000000000000000000000000000000b0b";
const carol = "0x0000000000000000000000000000000000000caa";

describe("migration report logic", function () {
  it("calculates current ERC20 balances from mint, transfer, and burn logs", function () {
    const balances = calculateErc20Balances([
      { from: ZERO_ADDRESS, to: alice, value: 100n },
      { from: alice, to: bob, value: 25n },
      { from: bob, to: ZERO_ADDRESS, value: 5n },
      { from: ZERO_ADDRESS, to: carol, value: 0n },
    ]);

    expect(balances).to.deep.equal([
      { address: alice, balance: 75n },
      { address: bob, balance: 20n },
    ]);
  });

  it("calculates current ERC721 owners from mint, transfer, and burn logs", function () {
    const ownership = calculateErc721Owners([
      { from: ZERO_ADDRESS, to: alice, tokenId: 1n },
      { from: alice, to: bob, tokenId: 1n },
      { from: ZERO_ADDRESS, to: alice, tokenId: 2n },
      { from: bob, to: ZERO_ADDRESS, tokenId: 1n },
    ]);

    expect(ownership.ownersByToken).to.deep.equal(new Map([[2n, alice]]));
    expect(ownership.holders).to.deep.equal([
      { address: alice, count: 1, tokenIds: [2n] },
    ]);
  });

  it("summarizes revealed but unexchanged tickets by current owner", function () {
    const summary = summarizeRevealedUnexchanged(
      new Map([
        [1n, alice],
        [2n, alice],
        [3n, bob],
        [4n, carol],
      ]),
      new Map([
        [1n, { seriesId: 0n, prizeId: 1n, exchanged: false, revealed: false }],
        [2n, { seriesId: 0n, prizeId: 2n, exchanged: false, revealed: true }],
        [3n, { seriesId: 1n, prizeId: 3n, exchanged: true, revealed: true }],
        [4n, { seriesId: 1n, prizeId: 4n, exchanged: false, revealed: true }],
      ])
    );

    expect(summary).to.deep.equal([
      {
        address: alice,
        count: 1,
        tokenIds: [2n],
        prizeCounts: [{ prizeId: 2n, count: 1 }],
      },
      {
        address: carol,
        count: 1,
        tokenIds: [4n],
        prizeCounts: [{ prizeId: 4n, count: 1 }],
      },
    ]);
  });

  it("builds coinNFT item and holder total rows with voucher value and member level", function () {
    const rows = buildCoinNftMigrationRows(
      new Map([
        [10n, alice],
        [11n, alice],
        [12n, bob],
      ]),
      new Map([
        [10n, { tokenId: 10n, isMembership: false, voucherTypeId: 3n, amount: 250n }],
        [11n, { tokenId: 11n, isMembership: true }],
        [12n, { tokenId: 12n, isMembership: false, voucherTypeId: 1n, amount: 50n }],
      ]),
      new Map([
        [
          alice,
          {
            levelIndex: 2n,
            levelName: "Silver",
            rewardBasisPoints: 100n,
            membershipTokenId: 11n,
            totalRedeemed: 15000n,
            currentRoundRedeemed: 15000n,
          },
        ],
        [
          bob,
          {
            levelIndex: 0n,
            levelName: "NonMembership",
            rewardBasisPoints: 0n,
            membershipTokenId: 0n,
            totalRedeemed: 0n,
            currentRoundRedeemed: 0n,
          },
        ],
      ]),
      { twdPerDoudocoin: "0.6" }
    );

    expect(rows.items).to.deep.equal([
      {
        address: alice,
        tokenId: 10n,
        nftKind: "voucher",
        voucherTypeId: 3n,
        voucherAmountDOUDO: "250",
        estimatedBaseTWD: "150",
        memberLevelIndex: 2n,
        memberLevelName: "Silver",
        memberRewardBasisPoints: 100n,
        membershipTokenId: 11n,
      },
      {
        address: alice,
        tokenId: 11n,
        nftKind: "membership",
        voucherTypeId: undefined,
        voucherAmountDOUDO: "0",
        estimatedBaseTWD: "0",
        memberLevelIndex: 2n,
        memberLevelName: "Silver",
        memberRewardBasisPoints: 100n,
        membershipTokenId: 11n,
      },
      {
        address: bob,
        tokenId: 12n,
        nftKind: "voucher",
        voucherTypeId: 1n,
        voucherAmountDOUDO: "50",
        estimatedBaseTWD: "30",
        memberLevelIndex: 0n,
        memberLevelName: "NonMembership",
        memberRewardBasisPoints: 0n,
        membershipTokenId: 0n,
      },
    ]);
    expect(rows.holderTotals).to.deep.equal([
      {
        address: alice,
        nftCount: 2,
        voucherNftCount: 1,
        membershipNftCount: 1,
        tokenIds: [10n, 11n],
        membershipTokenIds: [11n],
        memberLevelIndex: 2n,
        memberLevelName: "Silver",
        memberRewardBasisPoints: 100n,
        baseVoucherDOUDO: "250",
        bonusDOUDO: "2",
        totalRedeemableDOUDO: "252",
        estimatedBaseTWD: "150",
        estimatedTotalTWD: "151.2",
      },
      {
        address: bob,
        nftCount: 1,
        voucherNftCount: 1,
        membershipNftCount: 0,
        tokenIds: [12n],
        membershipTokenIds: [],
        memberLevelIndex: 0n,
        memberLevelName: "NonMembership",
        memberRewardBasisPoints: 0n,
        baseVoucherDOUDO: "50",
        bonusDOUDO: "0",
        totalRedeemableDOUDO: "50",
        estimatedBaseTWD: "30",
        estimatedTotalTWD: "30",
      },
    ]);
  });

  it("builds revealed-unexchanged item rows with series/prize labels and excludes dead owner", function () {
    const rows = buildRevealedUnexchangedTicketRows(
      new Map([
        [1n, alice],
        [2n, DEAD_ADDRESS],
        [3n, bob],
        [4n, carol],
      ]),
      new Map([
        [1n, { seriesId: 7n, prizeId: 2n, exchanged: false, revealed: true }],
        [2n, { seriesId: 7n, prizeId: 2n, exchanged: false, revealed: true }],
        [3n, { seriesId: 7n, prizeId: 999n, exchanged: false, revealed: true }],
        [4n, { seriesId: 8n, prizeId: 1n, exchanged: true, revealed: true }],
      ]),
      new Map([
        [7n, { seriesName: "Dragon Ball", priceInTWD: 250n }],
      ]),
      new Map([
        [seriesPrizeKey(7n, 2n), { prizeGroup: "B", prizeName: "Figure B" }],
      ]),
      { excludedOwners: [DEAD_ADDRESS] }
    );

    expect(rows).to.deep.equal([
      {
        address: alice,
        tokenId: 1n,
        seriesId: 7n,
        seriesName: "Dragon Ball",
        prizeId: 2n,
        prizeGroup: "B",
        prizeName: "Figure B",
        priceInTWD: 250n,
        isLastPrize: false,
      },
      {
        address: bob,
        tokenId: 3n,
        seriesId: 7n,
        seriesName: "Dragon Ball",
        prizeId: 999n,
        prizeGroup: "LAST",
        prizeName: "Last Prize",
        priceInTWD: 250n,
        isLastPrize: true,
      },
    ]);

    expect(summarizePhysicalPrizeReservations(rows)).to.deep.equal([
      {
        seriesId: 7n,
        seriesName: "Dragon Ball",
        prizeId: 2n,
        prizeGroup: "B",
        prizeName: "Figure B",
        quantity: 1,
        holderCount: 1,
        tokenIds: [1n],
        holders: [alice],
      },
      {
        seriesId: 7n,
        seriesName: "Dragon Ball",
        prizeId: 999n,
        prizeGroup: "LAST",
        prizeName: "Last Prize",
        quantity: 1,
        holderCount: 1,
        tokenIds: [3n],
        holders: [bob],
      },
    ]);
  });
});

function seriesPrizeKey(seriesId: bigint, prizeId: bigint): string {
  return `${seriesId.toString()}:${prizeId.toString()}`;
}
