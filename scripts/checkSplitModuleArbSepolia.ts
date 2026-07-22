import { ethers } from "hardhat";

const ADDRESSES = {
  points: process.env.DOUDO_POINTS_ADDRESS || "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E",
  coreRouter: process.env.DOUDO_VRF_ROUTER_ADDRESS || "0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5",
  redrawRouter:
    process.env.DOUDO_REDRAW_VRF_ROUTER_ADDRESS ||
    "0x5A59D45437559C7CE0A012630a456321180C21e1",
  core: process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  bundle: process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
  refund: process.env.DOUDO_REFUND_MODULE_PROXY_ADDRESS || "0x8ee19238DAa466B7792BE33569c6E4f6993CCf20",
  redraw: process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || "0xE75461828f41C890fbc811e7cABFe2143B3F4afE",
  reward: process.env.DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS || "0x680618a6933DD68fF84Ff9F64760120d27400B3C",
  book: process.env.COLLECTION_BOOK_PROXY_ADDRESS || "0x4284be399cA9591fBd98248969fCcb969E21B2C6",
};

async function requireTrue(label: string, value: boolean) {
  if (!value) {
    throw new Error(`Check failed: ${label}`);
  }
  console.log("OK:", label);
}

async function main() {
  const points = await ethers.getContractAt("contracts/DDOUDOCOIN.sol:DOUDOCOIN", ADDRESSES.points);
  const coreRouter = await ethers.getContractAt(
    "contracts/DoudoVRFRouter.sol:DoudoVRFRouter",
    ADDRESSES.coreRouter
  );
  const redrawRouter = await ethers.getContractAt(
    "contracts/DoudoVRFRouter.sol:DoudoVRFRouter",
    ADDRESSES.redrawRouter
  );
  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    ADDRESSES.core
  );
  const bundle = await ethers.getContractAt(
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable",
    ADDRESSES.bundle
  );
  const redraw = await ethers.getContractAt(
    "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable",
    ADDRESSES.redraw
  );
  const reward = await ethers.getContractAt(
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable",
    ADDRESSES.reward
  );
  const book = await ethers.getContractAt(
    "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable",
    ADDRESSES.book
  );

  await requireTrue("core points address", (await core.doudoPoints()).toLowerCase() === ADDRESSES.points.toLowerCase());
  await requireTrue(
    "core router address",
    (await core.vrfRouter()).toLowerCase() === ADDRESSES.coreRouter.toLowerCase()
  );
  await requireTrue(
    "core router coordinator set",
    (await coreRouter.s_vrfCoordinator()) !== ethers.ZeroAddress
  );
  await requireTrue("core router requester core", await coreRouter.isRequester(ADDRESSES.core));
  await requireTrue(
    "redraw router address",
    (await redraw.router()).toLowerCase() === ADDRESSES.redrawRouter.toLowerCase()
  );
  await requireTrue(
    "redraw router coordinator set",
    (await redrawRouter.s_vrfCoordinator()) !== ethers.ZeroAddress
  );
  await requireTrue(
    "redraw router requester redraw",
    await redrawRouter.isRequester(ADDRESSES.redraw)
  );

  const moduleRole = await core.MODULE_ROLE();
  await requireTrue("core MODULE_ROLE bundle", await core.hasRole(moduleRole, ADDRESSES.bundle));
  await requireTrue("core MODULE_ROLE refund", await core.hasRole(moduleRole, ADDRESSES.refund));
  await requireTrue("core MODULE_ROLE redraw", await core.hasRole(moduleRole, ADDRESSES.redraw));
  await requireTrue("core MODULE_ROLE reward", await core.hasRole(moduleRole, ADDRESSES.reward));

  await requireTrue("points BURNER_ROLE core", await points.hasRole(await points.BURNER_ROLE(), ADDRESSES.core));
  await requireTrue("points BURNER_ROLE bundle", await points.hasRole(await points.BURNER_ROLE(), ADDRESSES.bundle));
  await requireTrue("points MINTER_ROLE bundle", await points.hasRole(await points.MINTER_ROLE(), ADDRESSES.bundle));
  await requireTrue("points MINTER_ROLE refund", await points.hasRole(await points.MINTER_ROLE(), ADDRESSES.refund));
  await requireTrue("points MINTER_ROLE reward", await points.hasRole(await points.MINTER_ROLE(), ADDRESSES.reward));
  await requireTrue("points MINTER_ROLE book", await points.hasRole(await points.MINTER_ROLE(), ADDRESSES.book));

  await requireTrue("bundle redraw module", (await bundle.redrawModule()).toLowerCase() === ADDRESSES.redraw.toLowerCase());
  await requireTrue("redraw bundle module", (await redraw.bundleModule()).toLowerCase() === ADDRESSES.bundle.toLowerCase());
  await requireTrue("reward collection book", (await reward.collectionBook()).toLowerCase() === ADDRESSES.book.toLowerCase());
  await requireTrue("book reward target", (await book.doudochainV2RewardTarget()).toLowerCase() === ADDRESSES.reward.toLowerCase());

  console.log("Split module wiring checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
