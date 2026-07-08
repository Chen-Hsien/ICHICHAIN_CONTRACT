// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoSeriesOps.sol";

contract DoudoSeriesOpsModuleUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    IDoudoSeriesOps
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 public constant MAX_MINT_LOCK_DURATION = 10 minutes;

    address public core;
    uint256 public defaultLockDuration;

    mapping(uint256 => bool) public seriesInitialized;
    mapping(uint256 => uint256) public seriesLockDuration;
    mapping(uint256 => address) public mintLockOwner;
    mapping(uint256 => uint256) public mintLockUntil;
    mapping(uint256 => uint256) public seriesMaxPerWallet;
    mapping(uint256 => mapping(address => uint256)) public mintedPerWallet;
    mapping(uint256 => bool) private seriesRevealDisabled;

    error InvalidConfig();
    error OnlyCore(address caller);
    error SeriesAlreadyInitialized();
    error SeriesNotInitialized();
    error SeriesReserved();
    error WalletCapExceeded();

    event DefaultLockDurationUpdated(uint256 duration);
    event SeriesLockDurationUpdated(uint256 indexed seriesID, uint256 duration);
    event MintLockUpdated(uint256 indexed seriesID, address indexed owner, uint256 until);
    event SeriesMaxPerWalletUpdated(uint256 indexed seriesID, uint256 maxPerWallet);
    event SeriesRevealEnabledUpdated(uint256 indexed seriesID, bool enabled);
    event MintedPerWalletSeeded(uint256 indexed seriesID, address indexed user, uint256 count);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address coreAddress) public initializer {
        if (coreAddress == address(0)) revert InvalidConfig();
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(msg.sender);

        core = coreAddress;
        defaultLockDuration = MAX_MINT_LOCK_DURATION;
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
    }

    modifier onlyCore() {
        if (msg.sender != core) revert OnlyCore(msg.sender);
        _;
    }

    function initializeSeries(
        uint256 seriesID,
        uint256 maxPerWallet,
        bool revealEnabled_
    ) external override onlyCore {
        if (seriesInitialized[seriesID]) revert SeriesAlreadyInitialized();
        _setSeriesConfig(seriesID, maxPerWallet, revealEnabled_);
    }

    function seedSeriesConfig(
        uint256 seriesID,
        uint256 maxPerWallet,
        bool revealEnabled_
    ) external onlyRole(OPERATION_ROLE) {
        _setSeriesConfig(seriesID, maxPerWallet, revealEnabled_);
    }

    function seedMintedCount(
        uint256 seriesID,
        address user,
        uint256 count
    ) external onlyRole(OPERATION_ROLE) {
        _requireInitialized(seriesID);
        if (user == address(0)) revert InvalidConfig();
        mintedPerWallet[seriesID][user] = count;
        emit MintedPerWalletSeeded(seriesID, user, count);
    }

    function setDefaultLockDuration(uint256 duration) external onlyRole(OPERATION_ROLE) {
        defaultLockDuration = _boundedDuration(duration);
        emit DefaultLockDurationUpdated(defaultLockDuration);
    }

    function setSeriesLockDuration(
        uint256 seriesID,
        uint256 duration
    ) external onlyRole(OPERATION_ROLE) {
        _requireInitialized(seriesID);
        seriesLockDuration[seriesID] = _boundedDuration(duration);
        emit SeriesLockDurationUpdated(seriesID, seriesLockDuration[seriesID]);
    }

    function clearMintLock(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
        _requireInitialized(seriesID);
        mintLockOwner[seriesID] = address(0);
        mintLockUntil[seriesID] = 0;
        emit MintLockUpdated(seriesID, address(0), 0);
    }

    function setSeriesMaxPerWallet(
        uint256 seriesID,
        uint256 cap
    ) external onlyRole(OPERATION_ROLE) {
        _requireInitialized(seriesID);
        seriesMaxPerWallet[seriesID] = cap;
        emit SeriesMaxPerWalletUpdated(seriesID, cap);
    }

    function setSeriesRevealEnabled(
        uint256 seriesID,
        bool enabled
    ) external onlyRole(OPERATION_ROLE) {
        _requireInitialized(seriesID);
        seriesRevealDisabled[seriesID] = !enabled;
        emit SeriesRevealEnabledUpdated(seriesID, enabled);
    }

    function checkAndRefreshMintLock(
        uint256 seriesID,
        address user,
        uint256 quantity
    ) external override onlyCore {
        _requireInitialized(seriesID);
        _refreshMintLock(seriesID, user, _lockDurationFor(seriesID));
        _checkWalletCap(seriesID, user, quantity);
    }

    function refreshMintLockFor(
        uint256 seriesID,
        address user,
        uint256 duration
    ) external override onlyCore {
        _requireInitialized(seriesID);
        _refreshMintLock(seriesID, user, _boundedDuration(duration));
    }

    function recordMint(
        uint256 seriesID,
        address user,
        uint256 quantity
    ) external override onlyCore {
        _requireInitialized(seriesID);
        if (user == address(0) || quantity == 0) revert InvalidConfig();
        mintedPerWallet[seriesID][user] += quantity;
    }

    function revealEnabled(uint256 seriesID) external view override returns (bool) {
        return seriesInitialized[seriesID] && !seriesRevealDisabled[seriesID];
    }

    function _setSeriesConfig(
        uint256 seriesID,
        uint256 maxPerWallet,
        bool revealEnabled_
    ) internal {
        seriesInitialized[seriesID] = true;
        seriesMaxPerWallet[seriesID] = maxPerWallet;
        seriesRevealDisabled[seriesID] = !revealEnabled_;
        emit SeriesMaxPerWalletUpdated(seriesID, maxPerWallet);
        emit SeriesRevealEnabledUpdated(seriesID, revealEnabled_);
    }

    function _lockDurationFor(uint256 seriesID) internal view returns (uint256) {
        uint256 duration = seriesLockDuration[seriesID];
        if (duration == 0) {
            duration = defaultLockDuration;
        }
        return _boundedDuration(duration);
    }

    function _boundedDuration(uint256 duration) internal pure returns (uint256) {
        return duration > MAX_MINT_LOCK_DURATION ? MAX_MINT_LOCK_DURATION : duration;
    }

    function _refreshMintLock(uint256 seriesID, address user, uint256 duration) internal {
        if (user == address(0)) revert InvalidConfig();
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

    function _checkWalletCap(uint256 seriesID, address user, uint256 quantity) internal view {
        uint256 cap = seriesMaxPerWallet[seriesID];
        if (cap != 0 && mintedPerWallet[seriesID][user] + quantity > cap) {
            revert WalletCapExceeded();
        }
    }

    function _requireInitialized(uint256 seriesID) internal view {
        if (!seriesInitialized[seriesID]) revert SeriesNotInitialized();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[41] private __gap;
}
