// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Shared ABI/storage types only; this base declares no storage.
abstract contract FixedProbabilityTypes {
    enum SeriesStatus {
        NONE,
        DRAFT,
        ACTIVE,
        PAUSED,
        CLOSED
    }

    enum OrderState {
        NONE,
        PENDING,
        RANDOM_READY,
        SETTLED
    }

    struct SeriesConfig {
        uint256 pricePoints;
        uint256 drawCap;
        uint16 maxBatchSize;
        uint256[] prizeIds;
        uint16[] weights;
        uint16[] discountQuantities;
        uint256[] discountPoints;
        uint8 freeOrderMode;
        uint256 freeOrderFirstDraws;
        uint256[] freeOrderPrizeIds;
        uint8 gateMode;
        uint8 minMemberLevel;
        bytes32 eligibilityPolicyId;
        bytes32 eligibilityScope;
        uint256 maxEligibleDraws;
        bytes32 contentHash;
        string contentURI;
    }

    struct Series {
        SeriesConfig config;
        bytes32 configHash;
        SeriesStatus status;
        uint256 acceptedDraws;
    }

    struct DrawAuthorization {
        bytes32 authorizationId;
        address buyer;
        uint256 seriesId;
        bytes32 configHash;
        uint16 quantity;
        uint256 grossPoints;
        uint256 rebatePoints;
        uint256 netPoints;
        bool freeOrderChallenge;
        bytes32 eligibilityKey;
        uint256 deadline;
    }

    struct Order {
        uint256 orderId;
        address buyer;
        uint256 seriesId;
        bytes32 configHash;
        bytes32 authorizationId;
        uint16 quantity;
        uint256 firstDrawId;
        uint256 grossPoints;
        uint256 rebatePoints;
        uint256 netPoints;
        bool freeOrderChallenge;
        bytes32 eligibilityKey;
        uint8 levelAtRequest;
        uint256 acceptedDrawsBefore;
        uint256 requestId;
        OrderState state;
        uint256[] randomWords;
        bool freeOrderWon;
        uint16 firstTriggerIndex;
        uint256 refundPoints;
        bool accountingFinalized;
        bytes32 membershipConsumptionId;
        uint256 finalPointsConsumed;
        uint256 membershipRewardPoints;
        uint8 previousLevel;
        uint8 newLevel;
        uint64 expiresAt;
    }

    struct Draw {
        uint256 drawId;
        uint256 orderId;
        uint16 drawIndex;
        uint256 roll;
        uint256 prizeId;
        uint256 tokenId;
        address recipient;
        bool exchanged;
    }

    struct BuybackAuthorization {
        bytes32 batchId;
        address buyer;
        address coreAddress;
        bytes32 itemsHash;
        bytes32 quoteHash;
        uint256 totalPoints;
        uint256 deadline;
    }
}
