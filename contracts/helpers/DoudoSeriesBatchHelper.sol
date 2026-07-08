// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "../DOUDOCHAINV2CoreUpgradeable.sol";

/// @notice Off-core helper to batch-create series without growing Core bytecode.
contract DoudoSeriesBatchHelper {
    function batchCreateSeriesWithSubPrizes(
        DOUDOCHAINV2CoreUpgradeable core,
        DOUDOCHAINV2CoreUpgradeable.SeriesInput[] calldata inputs,
        DOUDOCHAINV2CoreUpgradeable.SubPrize[][] calldata subPrizesList,
        bool[] calldata revealEnabledList
    ) external returns (uint256[] memory seriesIDs) {
        if (inputs.length == 0 || inputs.length != subPrizesList.length || inputs.length != revealEnabledList.length) {
            revert DOUDOCHAINV2CoreUpgradeable.InvalidSeriesInput();
        }

        seriesIDs = new uint256[](inputs.length);
        for (uint256 i = 0; i < inputs.length; i++) {
            seriesIDs[i] = core.createSeriesWithSubPrizes(inputs[i], subPrizesList[i], revealEnabledList[i]);
        }
    }
}
