// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../security/LightweightGuardsUpgradeable.sol";

interface IBuybackCore {
    function moduleBurnForRedraw(uint256 tokenID, address owner) external returns (uint256);
    function requireBuybackDeadlineOpen(uint256 tokenID) external view;
}

/// @notice Burns prizes against a signed quote; credits are settled in the DB Points ledger.
contract DoudoPrizeBuybackModuleUpgradeable is
    UUPSUpgradeable, EIP712Upgradeable, MinimalAccessControlUpgradeable, LightweightGuardsUpgradeable
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant AUTHORIZER_ROLE = keccak256("AUTHORIZER_ROLE");
    uint256 public constant MAX_BATCH_SIZE = 50;
    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "BuybackAuthorization(bytes32 batchId,address buyer,address coreAddress,bytes32 itemsHash,bytes32 quoteHash,uint256 totalPoints,uint256 deadline)"
    );

    struct BuybackAuthorization {
        bytes32 batchId;
        address buyer;
        address coreAddress;
        bytes32 itemsHash;
        bytes32 quoteHash;
        uint256 totalPoints;
        uint256 deadline;
    }

    IBuybackCore public core;
    mapping(bytes32 => bool) public consumed;

    error InvalidAuthorization();
    error InvalidItems();
    event PrizeBuybackBurned(
        bytes32 indexed batchId, address indexed buyer, address indexed coreAddress,
        uint256[] tokenIds, uint256[] points, uint256 totalPoints, bytes32 quoteHash
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address coreAddress, address authorizer) public initializer {
        if (coreAddress == address(0) || authorizer == address(0)) revert InvalidAuthorization();
        __UUPSUpgradeable_init();
        __EIP712_init("DOUDO Prize Buyback", "1");
        __MinimalAccessControl_init(msg.sender);
        __LightweightGuards_init();
        core = IBuybackCore(coreAddress);
        _grantRole(OPERATION_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(AUTHORIZER_ROLE, authorizer);
    }

    function buyback(
        BuybackAuthorization calldata auth, uint256[] calldata tokenIds,
        uint256[] calldata points, bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (auth.buyer != msg.sender || auth.coreAddress != address(core)
            || block.timestamp > auth.deadline || consumed[auth.batchId]
            || auth.batchId == bytes32(0) || auth.quoteHash == bytes32(0)) revert InvalidAuthorization();
        if (tokenIds.length == 0 || tokenIds.length > MAX_BATCH_SIZE || tokenIds.length != points.length
            || keccak256(abi.encode(tokenIds, points)) != auth.itemsHash) revert InvalidItems();
        uint256 total;
        for (uint256 i; i < tokenIds.length; ++i) {
            if (points[i] == 0 || (i > 0 && tokenIds[i] <= tokenIds[i - 1])) revert InvalidItems();
            total += points[i];
        }
        if (total != auth.totalPoints) revert InvalidItems();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(AUTHORIZATION_TYPEHASH, auth)));
        if (!hasRole(AUTHORIZER_ROLE, ECDSA.recover(digest, signature))) revert InvalidAuthorization();
        consumed[auth.batchId] = true;
        for (uint256 i; i < tokenIds.length; ++i) {
            core.requireBuybackDeadlineOpen(tokenIds[i]);
            core.moduleBurnForRedraw(tokenIds[i], msg.sender);
        }
        emit PrizeBuybackBurned(auth.batchId, msg.sender, address(core), tokenIds, points, total, auth.quoteHash);
    }

    function pause() external onlyRole(OPERATION_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATION_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
    uint256[48] private __gap;
}
