// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../FixedProbabilityLotteryV3Upgradeable.sol";
/// @dev Test-only compatible implementation; V1's initializer must not run again.
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract FixedProbabilityLotteryV3UpgradeableV2 is FixedProbabilityLotteryV3Upgradeable {
    uint256 public upgradeMarker;
    function revision() external pure returns(uint256) {return 2;}
    function initializeV2(uint256 marker) external reinitializer(2) onlyRole(UPGRADER_ROLE) { upgradeMarker=marker; }
}
/// @dev Negative layout fixture: inserting storage ahead of the core must be rejected.
contract FixedProbabilityWrongStorage {uint256 private misplaced;}
/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract FixedProbabilityLotteryV3Incompatible is FixedProbabilityWrongStorage, FixedProbabilityLotteryV3Upgradeable {}
