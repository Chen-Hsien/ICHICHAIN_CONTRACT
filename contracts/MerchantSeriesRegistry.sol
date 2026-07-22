// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./interfaces/IMerchantSeriesRegistry.sol";

/// @notice Canonical on-chain attribution ledger mapping a series to a merchant.
/// Detailed merchant records live off-chain; only an opaque merchantRef is stored.
contract MerchantSeriesRegistry is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    IMerchantSeriesRegistry
{
    bytes32 public constant LINKER_ROLE = keccak256("LINKER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // seriesContract => seriesID => merchantRef
    mapping(address => mapping(uint256 => bytes32)) public seriesMerchantRefs;

    error ZeroMerchantRef();
    error AlreadyLinked(address seriesContract, uint256 seriesID);
    error NotLinked(address seriesContract, uint256 seriesID);

    event SeriesMerchantLinked(
        address indexed seriesContract,
        uint256 indexed seriesID,
        bytes32 indexed merchantRef,
        address operator
    );

    event SeriesMerchantRelinked(
        address indexed seriesContract,
        uint256 indexed seriesID,
        bytes32 previousMerchantRef,
        bytes32 newMerchantRef,
        address operator
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function linkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 merchantRef
    ) external override onlyRole(LINKER_ROLE) {
        if (merchantRef == bytes32(0)) revert ZeroMerchantRef();
        if (seriesMerchantRefs[seriesContract][seriesID] != bytes32(0)) {
            revert AlreadyLinked(seriesContract, seriesID);
        }
        seriesMerchantRefs[seriesContract][seriesID] = merchantRef;
        emit SeriesMerchantLinked(seriesContract, seriesID, merchantRef, msg.sender);
    }

    function relinkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 newMerchantRef
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMerchantRef == bytes32(0)) revert ZeroMerchantRef();
        bytes32 previous = seriesMerchantRefs[seriesContract][seriesID];
        if (previous == bytes32(0)) revert NotLinked(seriesContract, seriesID);
        seriesMerchantRefs[seriesContract][seriesID] = newMerchantRef;
        emit SeriesMerchantRelinked(seriesContract, seriesID, previous, newMerchantRef, msg.sender);
    }

    function merchantOf(
        address seriesContract,
        uint256 seriesID
    ) external view override returns (bytes32) {
        return seriesMerchantRefs[seriesContract][seriesID];
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[49] private __gap;
}
