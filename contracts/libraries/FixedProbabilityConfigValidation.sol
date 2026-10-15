// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../fixed-probability/FixedProbabilityTypes.sol";
/// @notice Fixed linked validation/hash logic; no storage, external calls or roles.
library FixedProbabilityConfigValidation {
    bytes32 private constant SERIES_DOMAIN=keccak256("FIXED_PROBABILITY_SERIES_V3");
    error InvalidConfig();
    uint16 private constant MAX_BATCH = 10;
    uint256 private constant TOTAL_WEIGHT = 10000;
    function validateAndHash(uint256 seriesId,FixedProbabilityTypes.SeriesConfig calldata config) external view returns(bytes32) {
        _validate(config);
        return _configHash(seriesId,config);
    }
    function _validate(FixedProbabilityTypes.SeriesConfig calldata config) private pure {
        if (
            config.pricePoints == 0 ||
            config.maxBatchSize == 0 ||
            config.maxBatchSize > MAX_BATCH ||
            config.prizeIds.length == 0 ||
            config.prizeIds.length != config.weights.length ||
            config.prizeIds.length > 32 ||
            config.discountQuantities.length != config.discountPoints.length ||
            config.discountQuantities.length > 10 ||
            config.freeOrderMode > 2 ||
            config.gateMode > 3 ||
            config.contentHash == bytes32(0) ||
            bytes(config.contentURI).length == 0 ||
            bytes(config.contentURI).length > 512
        ) revert InvalidConfig();

        uint256 totalWeight;
        for (uint256 i = 0; i < config.prizeIds.length; i++) {
            if (config.prizeIds[i] == 0 || config.weights[i] == 0) revert InvalidConfig();
            for (uint256 j = 0; j < i; j++) {
                if (config.prizeIds[j] == config.prizeIds[i]) revert InvalidConfig();
            }
            totalWeight += config.weights[i];
        }
        if (totalWeight != TOTAL_WEIGHT) revert InvalidConfig();

        for (uint256 i = 0; i < config.discountQuantities.length; i++) {
            if (
                config.discountQuantities[i] == 0 ||
                config.discountQuantities[i] > config.maxBatchSize ||
                (i != 0 && config.discountQuantities[i] <= config.discountQuantities[i - 1]) ||
                config.discountPoints[i] > config.pricePoints * config.discountQuantities[i] ||
                (i != 0 && config.discountPoints[i] < config.discountPoints[i - 1])
            ) revert InvalidConfig();
        }

        if (
            (config.freeOrderMode == 0 &&
                (config.freeOrderFirstDraws != 0 || config.freeOrderPrizeIds.length != 0)) ||
            (config.freeOrderMode == 1 &&
                (config.freeOrderFirstDraws == 0 || config.freeOrderPrizeIds.length == 0)) ||
            (config.freeOrderMode == 2 &&
                (config.freeOrderFirstDraws != 0 || config.freeOrderPrizeIds.length == 0))
        ) revert InvalidConfig();
        for (uint256 i = 0; i < config.freeOrderPrizeIds.length; i++) {
            if (!_containsCalldata(config.prizeIds, config.freeOrderPrizeIds[i])) {
                revert InvalidConfig();
            }
        }

        bool memberGate = config.gateMode == 1 || config.gateMode == 3;
        bool backendGate = config.gateMode == 2 || config.gateMode == 3;
        if (
            (memberGate && (config.minMemberLevel == 0 || config.minMemberLevel > 5)) ||
            (!memberGate && config.minMemberLevel != 0) ||
            (backendGate &&
                (config.eligibilityPolicyId == bytes32(0) ||
                    config.eligibilityScope == bytes32(0) ||
                    config.maxEligibleDraws == 0)) ||
            (!backendGate &&
                (config.eligibilityPolicyId != bytes32(0) ||
                    config.eligibilityScope != bytes32(0) ||
                    config.maxEligibleDraws != 0))
        ) revert InvalidConfig();
    }

    function _containsCalldata(
        uint256[] calldata values,
        uint256 needle
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] == needle) return true;
        }
        return false;
    }
    function _configHash(
        uint256 seriesId,
        FixedProbabilityTypes.SeriesConfig calldata config
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    SERIES_DOMAIN,
                    block.chainid,
                    address(this),
                    seriesId,
                    config.pricePoints,
                    config.drawCap,
                    config.maxBatchSize,
                    keccak256(abi.encode(config.prizeIds, config.weights)),
                    keccak256(
                        abi.encode(
                            config.discountQuantities,
                            config.discountPoints,
                            config.freeOrderMode,
                            config.freeOrderFirstDraws,
                            config.freeOrderPrizeIds
                        )
                    ),
                    keccak256(
                        abi.encode(
                            config.gateMode,
                            config.minMemberLevel,
                            config.eligibilityPolicyId,
                            config.eligibilityScope,
                            config.maxEligibleDraws
                        )
                    ),
                    config.contentHash,
                    config.contentURI
                )
            );
    }

}
