// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoMembershipV2 {
    function recordConsumption(
        address wallet,
        uint256 pointsConsumed,
        bytes32 authorizationId
    )
        external
        returns (
            uint256 rewardPoints,
            uint8 previousLevel,
            uint8 newLevel,
            uint64 expiresAt
        );

    function reverseConsumption(
        address wallet,
        uint256 pointsConsumed,
        bytes32 reversalId
    )
        external
        returns (
            uint8 previousLevel,
            uint8 newLevel,
            uint256 currentQualifyingSpend,
            uint256 lifetimeSpend
        );

    function adminSetMembership(
        address wallet,
        uint8 level,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt,
        bytes32 caseId
    ) external returns (uint256 tokenId);

    function adminMigrateMembership(
        address from,
        address to,
        uint8 level,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt,
        bytes32 caseId
    ) external returns (uint256 newTokenId);
}
