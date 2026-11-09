// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../fixed-probability/FixedProbabilityTypes.sol";
/// @notice Fixed linked configuration and authorization logic; storage references belong to the guarded UUPS core.
library FixedProbabilityConfigValidation {
    bytes32 private constant SERIES_DOMAIN=keccak256("FIXED_PROBABILITY_SERIES_V3");
    error InvalidConfig();
    uint16 private constant MAX_BATCH = 10;
    uint256 private constant TOTAL_WEIGHT = 10000;
    function validateAndHash(uint256 seriesId,FixedProbabilityTypes.SeriesConfig calldata config) public view returns(bytes32) {
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

    error InvalidAuthorization();
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant AUTHORIZATION_V2_TYPEHASH = keccak256("DrawAuthorizationV2(bytes32 authorizationId,address buyer,uint256 seriesId,bytes32 configHash,uint16 quantity,uint256 grossPoints,uint256 rebatePoints,uint256 netPoints,bool freeOrderChallenge,bytes32 eligibilityKey,uint256 deadline,uint256 couponDiscount,bytes32 pricingSnapshotHash,uint256 pricingVersion)");
    function authorizationDigestV2(FixedProbabilityTypes.DrawAuthorizationV2 calldata authorization) external view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(AUTHORIZATION_V2_TYPEHASH, authorization));
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("FixedProbabilityLottery"), keccak256("3"), block.chainid, address(this)));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }
    function couponAuthorization(FixedProbabilityTypes.DrawAuthorizationV2 calldata authorization)
        external pure returns (FixedProbabilityTypes.DrawAuthorization memory legacy, FixedProbabilityTypes.CouponPricing memory coupon)
    {
        if (authorization.pricingVersion != 2 || authorization.pricingSnapshotHash == bytes32(0) ||
            authorization.couponDiscount == 0 || authorization.couponDiscount % 1 ether != 0 ||
            authorization.netPoints < 1 ether) revert InvalidAuthorization();
        legacy = FixedProbabilityTypes.DrawAuthorization(
            authorization.authorizationId, authorization.buyer, authorization.seriesId, authorization.configHash,
            authorization.quantity, authorization.grossPoints, authorization.rebatePoints, authorization.netPoints,
            authorization.freeOrderChallenge, authorization.eligibilityKey, authorization.deadline
        );
        coupon = FixedProbabilityTypes.CouponPricing(authorization.couponDiscount, authorization.pricingSnapshotHash, authorization.pricingVersion);
    }

    error EligibilityScopeConflict();
    event EligibilityScopeRegistered(bytes32 indexed scope, bytes32 indexed policyId, uint256 maxEligibleDraws);
    event SeriesCreated(uint256 indexed seriesId, bytes32 indexed configHash, bytes configData);
    event SeriesStatusChanged(uint256 indexed seriesId, FixedProbabilityTypes.SeriesStatus previousStatus, FixedProbabilityTypes.SeriesStatus nextStatus);
    function createSeries(
        mapping(uint256 => FixedProbabilityTypes.Series) storage _series,
        mapping(bytes32 => bytes32) storage eligibilityScopePolicy,
        mapping(bytes32 => uint256) storage eligibilityScopeMaximum,
        uint256 seriesId,
        FixedProbabilityTypes.SeriesConfig calldata config
    ) external {
        bytes32 configHash=validateAndHash(seriesId,config);
        if (config.gateMode == 2 || config.gateMode == 3) {
            bytes32 registered = eligibilityScopePolicy[config.eligibilityScope];
            if (
                registered != bytes32(0) &&
                (registered != config.eligibilityPolicyId ||
                    eligibilityScopeMaximum[config.eligibilityScope] != config.maxEligibleDraws)
            ) revert EligibilityScopeConflict();
            if (registered == bytes32(0)) {
                eligibilityScopePolicy[config.eligibilityScope] = config.eligibilityPolicyId;
                eligibilityScopeMaximum[config.eligibilityScope] = config.maxEligibleDraws;
                emit EligibilityScopeRegistered(
                    config.eligibilityScope,
                    config.eligibilityPolicyId,
                    config.maxEligibleDraws
                );
            }
        }
        FixedProbabilityTypes.Series storage series = _series[seriesId];
        series.config = config;
        series.configHash = configHash;
        series.status = FixedProbabilityTypes.SeriesStatus.DRAFT;
        emit SeriesCreated(seriesId, series.configHash, abi.encode(config));
        emit SeriesStatusChanged(seriesId, FixedProbabilityTypes.SeriesStatus.NONE, FixedProbabilityTypes.SeriesStatus.DRAFT);
    }


}
