// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockCollectionRewardMinter {
    event MockCollectionRewardMinted(address indexed to, uint256 indexed rewardData);
    event MockSeriesUnlocked(address indexed user, uint256 indexed seriesID);

    function mintCollectionReward(address to, uint256 rewardData) external returns (uint256 tokenId) {
        emit MockCollectionRewardMinted(to, rewardData);
        return rewardData;
    }

    function unlockSeriesFor(address user, uint256 seriesID) external {
        emit MockSeriesUnlocked(user, seriesID);
    }
}
