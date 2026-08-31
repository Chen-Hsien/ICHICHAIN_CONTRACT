const { expect } = require("chai");
const { readFileSync } = require("node:fs");
const path = require("node:path");

describe("database-points cutover script safety gates", function () {
  const source = readFileSync(
    path.resolve(__dirname, "../scripts/cutoverDatabasePointsMembershipV2.ts"),
    "utf8"
  );

  it("requires actual finalized-chain evidence and a verified DB migration gate", function () {
    expect(source).to.include('ethers.provider.getBlock("finalized")');
    expect(source).to.include("LEGACY_SNAPSHOT_MIN_CONFIRMATIONS");
    expect(source).to.include("DATABASE_POINTS_MIGRATION_GATE_PATH");
    expect(source).to.include("DATABASE_POINTS_MIGRATION_MANIFEST_SHA256");
    expect(source).to.include("DATABASE_POINTS_MIGRATION_MANIFEST_PATH");
    expect(source).to.include("DATABASE_POINTS_MIGRATION_ENTRY_COUNT");
    expect(source).to.include(
      "DATABASE_POINTS_MIGRATION_MEMBERSHIP_ENTRY_COUNT"
    );
    expect(source).to.include("DATABASE_POINTS_MIGRATION_TOTAL_RAW");
    expect(source).to.include('migrationGate.status !== "VERIFIED"');
  });

  it("replays and verifies every membership snapshot before cancelling legacy assets", function () {
    expect(source).to.include("migrationManifest.membershipEntries");
    expect(source).to.include("membership.adminSetMembership(");
    expect(source).to.include("MEMBERSHIP_V2_MIGRATED");
    expect(source).to.include("membership.adminCaseUsed(caseId)");
    expect(source.indexOf("MEMBERSHIP_V2_MIGRATED")).to.be.lessThan(
      source.indexOf("cancelLegacyCollection(")
    );
  });

  it("persists Membership V2 and skips completed irreversible actions", function () {
    expect(source).to.include("checkpoint.membershipProxy");
    expect(source).to.include("MEMBERSHIP_V2_PROXY_ADDRESS");
    expect(source).to.include(
      "if (await upgradedLegacy.legacyCollectionCancelled())"
    );
    expect(source).to.include(
      "if (await upgradedBundle.databasePointsModeEnabled())"
    );
    expect(source).to.include(
      "if (await upgradedRefund.databasePointsModeEnabled())"
    );
  });

  it("checks the refund reversal wiring instead of only toggling a mode flag", function () {
    expect(source).to.include("setDatabasePointsRefundModule(refundProxy)");
    expect(source).to.include("configureDatabasePointsRefundAccounting(");
    expect(source).to.include("CONSUMPTION_RECORDER_ROLE");
  });
});
