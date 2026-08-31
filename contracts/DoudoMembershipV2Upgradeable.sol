// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "./access/MinimalAccessControlUpgradeable.sol";

/// @title DoudoMembershipV2Upgradeable
/// @notice Soulbound membership whose qualifying spend is recorded by an authorized lottery module.
contract DoudoMembershipV2Upgradeable is
    Initializable,
    UUPSUpgradeable,
    ERC721Upgradeable,
    MinimalAccessControlUpgradeable
{
    bytes32 public constant CONSUMPTION_RECORDER_ROLE =
        keccak256("CONSUMPTION_RECORDER_ROLE");
    bytes32 public constant MEMBERSHIP_OPERATOR_ROLE =
        keccak256("MEMBERSHIP_OPERATOR_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    uint64 public constant MEMBERSHIP_VALIDITY_PERIOD = 180 days;
    uint256 public constant SILVER_THRESHOLD = 9_000 ether;
    uint256 public constant GOLD_THRESHOLD = 48_000 ether;
    uint256 public constant PLATINUM_THRESHOLD = 90_000 ether;
    uint256 public constant EMERALD_THRESHOLD = 180_000 ether;

    uint8 public constant LEVEL_NONE = 0;
    uint8 public constant LEVEL_COMMON = 1;
    uint8 public constant LEVEL_SILVER = 2;
    uint8 public constant LEVEL_GOLD = 3;
    uint8 public constant LEVEL_PLATINUM = 4;
    uint8 public constant LEVEL_EMERALD = 5;

    struct MemberState {
        uint256 tokenId;
        uint256 currentQualifyingSpend;
        uint256 lifetimeSpend;
        uint64 lastActivityAt;
        uint64 expiresAt;
        uint8 level;
    }

    uint256 private _nextTokenId;
    mapping(address => MemberState) private _members;
    mapping(bytes32 => bool) public consumptionAuthorizationUsed;
    mapping(bytes32 => bool) public consumptionReversalUsed;
    mapping(bytes32 => bool) public adminCaseUsed;
    mapping(address => address) public memberMigratedTo;
    mapping(uint8 => string) private _levelTokenURIs;
    string private _expiredTokenURI;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidAuthorizationId();
    error AuthorizationAlreadyUsed(bytes32 authorizationId);
    error ReversalAlreadyUsed(bytes32 reversalId);
    error InvalidReversalId();
    error ReversalExceedsLifetimeSpend(uint256 requested, uint256 available);
    error InvalidMemberState();
    error InvalidMembershipLevel(uint8 level);
    error AdminCaseAlreadyUsed(bytes32 caseId);
    error InvalidAdminCaseId();
    error MembershipAlreadyMigrated(address wallet, address migratedTo);
    error MigrationTargetHasMembership(address wallet);
    error SoulboundTransfer();

    event MembershipConsumptionRecorded(
        bytes32 indexed authorizationId,
        address indexed wallet,
        uint256 indexed tokenId,
        uint256 pointsConsumed,
        uint256 rewardPoints,
        uint8 previousLevel,
        uint8 newLevel,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt,
        uint64 expiresAt
    );
    event MembershipConsumptionReversed(
        bytes32 indexed reversalId,
        address indexed wallet,
        uint256 indexed tokenId,
        uint256 pointsReversed,
        uint8 previousLevel,
        uint8 newLevel,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend
    );
    event MembershipExpired(
        address indexed wallet,
        uint256 indexed tokenId,
        uint8 previousLevel,
        uint256 lifetimeSpend,
        uint64 expiredAt
    );
    event MembershipRestored(
        bytes32 indexed caseId,
        address indexed wallet,
        uint256 indexed tokenId,
        uint8 level,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt,
        uint64 expiresAt
    );
    event MembershipMigrated(
        bytes32 indexed caseId,
        address indexed from,
        address indexed to,
        uint256 oldTokenId,
        uint256 newTokenId,
        uint8 level,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt,
        uint64 expiresAt
    );
    event MembershipLevelTokenURIUpdated(uint8 indexed level, string tokenURI);
    event ExpiredMembershipTokenURIUpdated(string tokenURI);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address defaultAdmin,
        address consumptionRecorder,
        address membershipOperator
    ) public initializer {
        if (
            defaultAdmin == address(0) ||
            consumptionRecorder == address(0) ||
            membershipOperator == address(0)
        ) revert InvalidAddress();

        __ERC721_init("DOUDO Membership V2", "DOUDO-MEMBER-V2");
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(defaultAdmin);

        _grantRole(UPGRADER_ROLE, defaultAdmin);
        _grantRole(CONSUMPTION_RECORDER_ROLE, consumptionRecorder);
        _grantRole(MEMBERSHIP_OPERATOR_ROLE, membershipOperator);
    }

    function recordConsumption(
        address wallet,
        uint256 pointsConsumed,
        bytes32 authorizationId
    )
        external
        onlyRole(CONSUMPTION_RECORDER_ROLE)
        returns (
            uint256 rewardPoints,
            uint8 previousLevel,
            uint8 newLevel,
            uint64 expiresAt
        )
    {
        if (wallet == address(0)) revert InvalidAddress();
        if (pointsConsumed == 0) revert InvalidAmount();
        if (authorizationId == bytes32(0)) revert InvalidAuthorizationId();
        if (consumptionAuthorizationUsed[authorizationId]) {
            revert AuthorizationAlreadyUsed(authorizationId);
        }
        address migratedTo = memberMigratedTo[wallet];
        if (migratedTo != address(0)) {
            revert MembershipAlreadyMigrated(wallet, migratedTo);
        }

        consumptionAuthorizationUsed[authorizationId] = true;
        MemberState storage member = _members[wallet];
        if (member.expiresAt != 0 && block.timestamp > member.expiresAt) {
            emit MembershipExpired(
                wallet,
                member.tokenId,
                member.level,
                member.lifetimeSpend,
                member.expiresAt
            );
            member.currentQualifyingSpend = 0;
            member.level = LEVEL_NONE;
        }

        previousLevel = member.level;
        rewardPoints = (pointsConsumed * _rewardBasisPoints(previousLevel)) / 10_000;
        member.currentQualifyingSpend += pointsConsumed;
        member.lifetimeSpend += pointsConsumed;
        member.lastActivityAt = uint64(block.timestamp);
        expiresAt = uint64(block.timestamp) + MEMBERSHIP_VALIDITY_PERIOD;
        member.expiresAt = expiresAt;
        newLevel = _levelForSpend(member.currentQualifyingSpend);
        member.level = newLevel;

        if (member.tokenId == 0) {
            member.tokenId = ++_nextTokenId;
            // Deliberately avoid a receiver callback inside the lottery transaction.
            _mint(wallet, member.tokenId);
        }

        emit MembershipConsumptionRecorded(
            authorizationId,
            wallet,
            member.tokenId,
            pointsConsumed,
            rewardPoints,
            previousLevel,
            newLevel,
            member.currentQualifyingSpend,
            member.lifetimeSpend,
            member.lastActivityAt,
            expiresAt
        );
    }

    /// @notice Reverse qualifying spend after the corresponding tickets are refunded.
    /// @dev Lifetime spend is exact. Current-window spend is reduced conservatively and
    ///      never below zero because old-cycle refunds cannot be reconstructed after expiry.
    function reverseConsumption(
        address wallet,
        uint256 pointsConsumed,
        bytes32 reversalId
    )
        external
        onlyRole(CONSUMPTION_RECORDER_ROLE)
        returns (
            uint8 previousLevel,
            uint8 newLevel,
            uint256 currentQualifyingSpend,
            uint256 lifetimeSpend
        )
    {
        if (wallet == address(0)) revert InvalidAddress();
        if (pointsConsumed == 0) revert InvalidAmount();
        if (reversalId == bytes32(0)) revert InvalidReversalId();
        if (consumptionReversalUsed[reversalId]) {
            revert ReversalAlreadyUsed(reversalId);
        }
        address migratedTo = memberMigratedTo[wallet];
        if (migratedTo != address(0)) {
            revert MembershipAlreadyMigrated(wallet, migratedTo);
        }

        MemberState storage member = _members[wallet];
        if (pointsConsumed > member.lifetimeSpend) {
            revert ReversalExceedsLifetimeSpend(pointsConsumed, member.lifetimeSpend);
        }
        consumptionReversalUsed[reversalId] = true;
        previousLevel = member.level;
        member.lifetimeSpend -= pointsConsumed;
        if (member.expiresAt != 0 && block.timestamp > member.expiresAt) {
            member.currentQualifyingSpend = 0;
        } else if (pointsConsumed >= member.currentQualifyingSpend) {
            member.currentQualifyingSpend = 0;
        } else {
            member.currentQualifyingSpend -= pointsConsumed;
        }
        member.level = _levelForSpend(member.currentQualifyingSpend);
        newLevel = member.level;
        currentQualifyingSpend = member.currentQualifyingSpend;
        lifetimeSpend = member.lifetimeSpend;

        emit MembershipConsumptionReversed(
            reversalId,
            wallet,
            member.tokenId,
            pointsConsumed,
            previousLevel,
            newLevel,
            currentQualifyingSpend,
            lifetimeSpend
        );
    }

    /// @notice Restore or explicitly upgrade one wallet from an audited backend case.
    function adminSetMembership(
        address wallet,
        uint8 level,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt,
        bytes32 caseId
    ) external onlyRole(MEMBERSHIP_OPERATOR_ROLE) returns (uint256 tokenId) {
        _consumeAdminCase(caseId);
        if (wallet == address(0)) revert InvalidAddress();
        address migratedTo = memberMigratedTo[wallet];
        if (migratedTo != address(0)) {
            revert MembershipAlreadyMigrated(wallet, migratedTo);
        }

        uint64 expiresAt = _validateImportedState(
            level,
            currentQualifyingSpend,
            lifetimeSpend,
            lastActivityAt
        );
        MemberState storage member = _members[wallet];
        tokenId = member.tokenId;
        if (tokenId == 0 && level != LEVEL_NONE) {
            tokenId = ++_nextTokenId;
            _mint(wallet, tokenId);
        }
        member.tokenId = tokenId;
        member.currentQualifyingSpend = currentQualifyingSpend;
        member.lifetimeSpend = lifetimeSpend;
        member.lastActivityAt = lastActivityAt;
        member.expiresAt = expiresAt;
        member.level = level;

        emit MembershipRestored(
            caseId,
            wallet,
            tokenId,
            level,
            currentQualifyingSpend,
            lifetimeSpend,
            lastActivityAt,
            expiresAt
        );
    }

    /// @notice Invalidate the old wallet token and restore an explicitly supplied state on a new wallet.
    function adminMigrateMembership(
        address from,
        address to,
        uint8 level,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt,
        bytes32 caseId
    ) external onlyRole(MEMBERSHIP_OPERATOR_ROLE) returns (uint256 newTokenId) {
        _consumeAdminCase(caseId);
        if (from == address(0) || to == address(0) || from == to) {
            revert InvalidAddress();
        }
        address migratedTo = memberMigratedTo[from];
        if (migratedTo != address(0)) {
            revert MembershipAlreadyMigrated(from, migratedTo);
        }
        MemberState storage target = _members[to];
        if (
            target.tokenId != 0 ||
            target.currentQualifyingSpend != 0 ||
            target.lifetimeSpend != 0 ||
            target.lastActivityAt != 0
        ) revert MigrationTargetHasMembership(to);

        uint64 expiresAt = _validateImportedState(
            level,
            currentQualifyingSpend,
            lifetimeSpend,
            lastActivityAt
        );
        MemberState storage source = _members[from];
        uint256 oldTokenId = source.tokenId;
        if (oldTokenId != 0) {
            source.tokenId = 0;
            _burn(oldTokenId);
        }
        memberMigratedTo[from] = to;

        if (level != LEVEL_NONE) {
            newTokenId = ++_nextTokenId;
            _mint(to, newTokenId);
        }
        target.tokenId = newTokenId;
        target.currentQualifyingSpend = currentQualifyingSpend;
        target.lifetimeSpend = lifetimeSpend;
        target.lastActivityAt = lastActivityAt;
        target.expiresAt = expiresAt;
        target.level = level;

        emit MembershipMigrated(
            caseId,
            from,
            to,
            oldTokenId,
            newTokenId,
            level,
            currentQualifyingSpend,
            lifetimeSpend,
            lastActivityAt,
            expiresAt
        );
    }

    function setMembershipLevelTokenURI(
        uint8 level,
        string calldata tokenURI_
    ) external onlyRole(MEMBERSHIP_OPERATOR_ROLE) {
        if (level == LEVEL_NONE || level > LEVEL_EMERALD) {
            revert InvalidMembershipLevel(level);
        }
        _levelTokenURIs[level] = tokenURI_;
        emit MembershipLevelTokenURIUpdated(level, tokenURI_);
    }

    function setExpiredMembershipTokenURI(
        string calldata tokenURI_
    ) external onlyRole(MEMBERSHIP_OPERATOR_ROLE) {
        _expiredTokenURI = tokenURI_;
        emit ExpiredMembershipTokenURIUpdated(tokenURI_);
    }

    function getMember(address wallet) external view returns (MemberState memory) {
        return _members[wallet];
    }

    function effectiveLevelOf(address wallet) public view returns (uint8) {
        MemberState storage member = _members[wallet];
        if (member.expiresAt != 0 && block.timestamp > member.expiresAt) {
            return LEVEL_NONE;
        }
        return member.level;
    }

    function rewardBasisPointsOf(address wallet) external view returns (uint256) {
        return _rewardBasisPoints(effectiveLevelOf(wallet));
    }

    function levelForSpend(uint256 currentQualifyingSpend) external pure returns (uint8) {
        return _levelForSpend(currentQualifyingSpend);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address wallet = ownerOf(tokenId);
        MemberState storage member = _members[wallet];
        if (member.expiresAt != 0 && block.timestamp > member.expiresAt) {
            return _expiredTokenURI;
        }
        return _levelTokenURIs[member.level];
    }

    function approve(address, uint256) public pure override {
        revert SoulboundTransfer();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundTransfer();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert SoulboundTransfer();
    }

    function safeTransferFrom(address, address, uint256) public pure override {
        revert SoulboundTransfer();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert SoulboundTransfer();
    }

    function _consumeAdminCase(bytes32 caseId) private {
        if (caseId == bytes32(0)) revert InvalidAdminCaseId();
        if (adminCaseUsed[caseId]) revert AdminCaseAlreadyUsed(caseId);
        adminCaseUsed[caseId] = true;
    }

    function _validateImportedState(
        uint8 level,
        uint256 currentQualifyingSpend,
        uint256 lifetimeSpend,
        uint64 lastActivityAt
    ) private view returns (uint64 expiresAt) {
        if (level > LEVEL_EMERALD || lifetimeSpend < currentQualifyingSpend) {
            revert InvalidMemberState();
        }
        if (lastActivityAt == 0) {
            if (level != LEVEL_NONE || currentQualifyingSpend != 0) {
                revert InvalidMemberState();
            }
            return 0;
        }
        if (lastActivityAt > block.timestamp) revert InvalidMemberState();

        expiresAt = lastActivityAt + MEMBERSHIP_VALIDITY_PERIOD;
        if (block.timestamp > expiresAt) {
            if (level != LEVEL_NONE || currentQualifyingSpend != 0) {
                revert InvalidMemberState();
            }
        } else if (level != _levelForSpend(currentQualifyingSpend)) {
            revert InvalidMemberState();
        }
    }

    function _levelForSpend(uint256 currentQualifyingSpend) private pure returns (uint8) {
        if (currentQualifyingSpend >= EMERALD_THRESHOLD) return LEVEL_EMERALD;
        if (currentQualifyingSpend >= PLATINUM_THRESHOLD) return LEVEL_PLATINUM;
        if (currentQualifyingSpend >= GOLD_THRESHOLD) return LEVEL_GOLD;
        if (currentQualifyingSpend >= SILVER_THRESHOLD) return LEVEL_SILVER;
        if (currentQualifyingSpend >= 1) return LEVEL_COMMON;
        return LEVEL_NONE;
    }

    function _rewardBasisPoints(uint8 level) private pure returns (uint256) {
        if (level == LEVEL_EMERALD) return 250;
        if (level == LEVEL_PLATINUM) return 150;
        if (level == LEVEL_GOLD) return 75;
        if (level == LEVEL_SILVER) return 25;
        return 0;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 firstTokenId,
        uint256 batchSize
    ) internal override {
        if (from != address(0) && to != address(0)) revert SoulboundTransfer();
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[39] private __gap;
}
