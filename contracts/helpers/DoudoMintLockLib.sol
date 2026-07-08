// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

library DoudoMintLockLib {
    error SeriesReserved();

    event MintLockUpdated(uint256 indexed seriesID, address indexed owner, uint256 until);

    function checkAndRefresh(
        mapping(uint256 => address) storage mintLockOwner,
        mapping(uint256 => uint256) storage mintLockUntil,
        mapping(uint256 => uint256) storage seriesLockDuration,
        uint256 seriesID,
        address user,
        uint256 defaultLockDuration,
        uint256 maxLockDuration
    ) external {
        uint256 duration = seriesLockDuration[seriesID];
        if (duration == 0) {
            duration = defaultLockDuration;
        }
        if (duration > maxLockDuration) {
            duration = maxLockDuration;
        }
        checkAndRefreshFor(
            mintLockOwner,
            mintLockUntil,
            seriesID,
            user,
            duration
        );
    }

    function checkAndRefreshFor(
        mapping(uint256 => address) storage mintLockOwner,
        mapping(uint256 => uint256) storage mintLockUntil,
        uint256 seriesID,
        address user,
        uint256 duration
    ) public {
        if (block.timestamp < mintLockUntil[seriesID] && mintLockOwner[seriesID] != user) {
            revert SeriesReserved();
        }
        uint256 nextUntil = block.timestamp + duration;
        if (mintLockOwner[seriesID] == user && mintLockUntil[seriesID] > nextUntil) {
            nextUntil = mintLockUntil[seriesID];
        }
        mintLockOwner[seriesID] = user;
        mintLockUntil[seriesID] = nextUntil;
        emit MintLockUpdated(seriesID, user, nextUntil);
    }
}
