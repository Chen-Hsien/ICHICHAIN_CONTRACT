import { ethers } from "hardhat";
async function main() {
  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5"
  );
  console.log("paused before:", await core.paused());
  if (await core.paused()) {
    const tx = await core.unpause();
    console.log("unpause tx:", tx.hash);
    await tx.wait();
  }
  console.log("paused after:", await core.paused());
}
main().catch((e) => { console.error(e); process.exit(1); });
