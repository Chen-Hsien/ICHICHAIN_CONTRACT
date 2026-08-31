// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoCore.sol";
import "../interfaces/IDoudoPoints.sol";
import "../security/LightweightGuardsUpgradeable.sol";

contract DoudoCollectionRewardModuleUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant POINTS_CONFIG_ROLE = keccak256("POINTS_CONFIG_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 private constant COLLECTION_BOOK_REWARD = keccak256("COLLECTION_BOOK_REWARD");

    enum RewardKind {
        NftPrize,
        Points,
        UnlockSeries
    }

    struct RewardConfig {
        uint8 rewardKind;
        uint256 pointsAmount;
        uint256 seriesID;
        uint256 prizeID;
        bool active;
    }

    IDoudoCore public core;
    IDoudoPoints public doudoPoints;
    address public collectionBook;
    mapping(uint256 => RewardConfig) public rewardConfigs;
    bool public databasePointsModeEnabled;

    error InvalidConfig();
    error OnlyCollectionBook(address caller);
    error RewardInactive();

    event CollectionBookUpdated(address indexed collectionBook);
    event CollectionRewardConfigSet(
        uint256 indexed collectionBookID,
        uint8 rewardKind,
        uint256 pointsAmount,
        uint256 seriesID,
        uint256 prizeID,
        bool active
    );
    event CollectionRewardMinted(
        uint256 indexed collectionBookID,
        address indexed user,
        uint8 rewardKind,
        uint256 amount,
        uint256 tokenID
    );
    event DatabasePointsCollectionRewardModeConfigured(bool enabled);
    event DatabasePointsCollectionRewardEntitled(
        uint256 indexed collectionBookID,
        address indexed user,
        uint256 amount
    );
    event SeriesUnlockedFor(uint256 indexed seriesID, address indexed user, uint256 expires);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address coreAddress, address doudoPointsAddress) public initializer {
        if (coreAddress == address(0) || doudoPointsAddress == address(0)) revert InvalidConfig();
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(msg.sender);
        __LightweightGuards_init();

        core = IDoudoCore(coreAddress);
        doudoPoints = IDoudoPoints(doudoPointsAddress);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
        _grantRole(POINTS_CONFIG_ROLE, msg.sender);
    }

    function setCollectionBook(address collectionBook_) external onlyRole(OPERATION_ROLE) {
        collectionBook = collectionBook_;
        emit CollectionBookUpdated(collectionBook_);
    }

    function setDatabasePointsMode(bool enabled) external onlyRole(POINTS_CONFIG_ROLE) {
        databasePointsModeEnabled = enabled;
        emit DatabasePointsCollectionRewardModeConfigured(enabled);
    }

    function setCollectionRewardConfig(
        uint256 collectionBookID,
        RewardConfig calldata config
    ) external onlyRole(OPERATION_ROLE) {
        _validateRewardConfig(config);
        rewardConfigs[collectionBookID] = config;
        emit CollectionRewardConfigSet(
            collectionBookID,
            config.rewardKind,
            config.pointsAmount,
            config.seriesID,
            config.prizeID,
            config.active
        );
    }

    function mintCollectionReward(
        address to,
        uint256 rewardData
    ) external nonReentrant returns (uint256 tokenID) {
        if (msg.sender != collectionBook) revert OnlyCollectionBook(msg.sender);
        RewardConfig memory config = rewardConfigs[rewardData];
        if (!config.active) revert RewardInactive();

        if (config.rewardKind == uint8(RewardKind.Points)) {
            if (databasePointsModeEnabled) {
                emit DatabasePointsCollectionRewardEntitled(
                    rewardData,
                    to,
                    config.pointsAmount
                );
            } else {
                doudoPoints.mintWithReason(to, config.pointsAmount, COLLECTION_BOOK_REWARD);
            }
            emit CollectionRewardMinted(rewardData, to, config.rewardKind, config.pointsAmount, 0);
            return 0;
        }

        if (config.rewardKind == uint8(RewardKind.NftPrize)) {
            tokenID = core.moduleMintRevealed(to, config.seriesID, config.prizeID);
            emit CollectionRewardMinted(rewardData, to, config.rewardKind, 1, tokenID);
            return tokenID;
        }

        if (config.rewardKind != uint8(RewardKind.UnlockSeries) || config.pointsAmount == 0) {
            revert InvalidConfig();
        }

        uint256 expires = block.timestamp + config.pointsAmount;
        core.moduleUnlockSeriesFor(config.seriesID, to, expires);
        emit CollectionRewardMinted(rewardData, to, config.rewardKind, expires, 0);
    }

    function unlockSeriesFor(address user, uint256 seriesID) external {
        if (msg.sender != collectionBook) revert OnlyCollectionBook(msg.sender);
        uint256 expires = block.timestamp + 30 days;
        core.moduleUnlockSeriesFor(seriesID, user, expires);
    }

    function _validateRewardConfig(RewardConfig calldata config) internal view {
        if (config.rewardKind > uint8(RewardKind.UnlockSeries)) revert InvalidConfig();
        if (config.rewardKind == uint8(RewardKind.Points)) return;

        (uint256 priceInPoints, , , ) = core.seriesMintConfig(config.seriesID);
        if (priceInPoints == 0) revert InvalidConfig();
        if (config.rewardKind == uint8(RewardKind.UnlockSeries) && config.pointsAmount == 0) {
            revert InvalidConfig();
        }
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[45] private __gap;
}
