// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoCore.sol";
import "../interfaces/IDoudoPoints.sol";
import "../security/LightweightGuardsUpgradeable.sol";

contract DoudoBundleModuleUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 private constant BUNDLE_MINT = keccak256("BUNDLE_MINT");
    bytes32 private constant BUNDLE_REBATE = keccak256("BUNDLE_REBATE");
    uint256 private constant MAX_BUNDLE_MINT_AND_REVEAL = 10;

    struct BundleConfig {
        uint256 ticketQuantity;
        uint256 priceInPoints;
        uint256 rebatePoints;
        uint256 consolationDrawCredits;
        bool active;
    }

    struct RebateTierInput {
        uint256 minimumTicketQuantity;
        uint256 rebatePoints;
    }

    struct RebateTier {
        uint256 minimumTicketQuantity;
        uint256 rebatePoints;
    }

    IDoudoCore public core;
    IDoudoPoints public doudoPoints;
    address public redrawModule;

    mapping(uint256 => mapping(uint256 => BundleConfig)) private seriesBundles;
    mapping(uint256 => RebateTier[]) public seriesRebateTiers;

    error InvalidConfig();
    error RevealBatchTooLarge();

    event RedrawModuleUpdated(address indexed redrawModule);
    event TicketPurchaseMinted(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 priceInPoints,
        bool revealImmediately,
        uint256 firstTokenID
    );
    event BundleRebateTierConfigured(
        uint256 indexed seriesID,
        uint256 indexed tierIndex,
        uint256 minimumTicketQuantity,
        uint256 rebatePoints
    );
    event BundleRebateTiersCleared(uint256 indexed seriesID);
    event TicketPurchaseRebatePaid(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 rebatePoints
    );

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
    }

    function setRedrawModule(address redrawModule_) external onlyRole(OPERATION_ROLE) {
        redrawModule = redrawModule_;
        emit RedrawModuleUpdated(redrawModule_);
    }

    function setSeriesRebateTiers(
        uint256 seriesID,
        RebateTierInput[] calldata tiers
    ) external onlyRole(OPERATION_ROLE) {
        delete seriesRebateTiers[seriesID];
        emit BundleRebateTiersCleared(seriesID);

        uint256 previousMinimum;
        for (uint256 i = 0; i < tiers.length; i++) {
            uint256 minimumTicketQuantity = tiers[i].minimumTicketQuantity;
            if (minimumTicketQuantity == 0 || minimumTicketQuantity <= previousMinimum) revert InvalidConfig();
            seriesRebateTiers[seriesID].push(
                RebateTier({
                    minimumTicketQuantity: minimumTicketQuantity,
                    rebatePoints: tiers[i].rebatePoints
                })
            );
            previousMinimum = minimumTicketQuantity;
            emit BundleRebateTierConfigured(
                seriesID,
                i,
                minimumTicketQuantity,
                tiers[i].rebatePoints
            );
        }
    }

    function seriesRebateTierCount(uint256 seriesID) external view returns (uint256) {
        return seriesRebateTiers[seriesID].length;
    }

    function mintTickets(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately
    ) external nonReentrant returns (uint256 firstTokenID) {
        firstTokenID = _mintTickets(seriesID, luckyNumbers, revealImmediately);
    }

    function _mintTickets(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately
    ) internal returns (uint256 firstTokenID) {
        uint256 ticketQuantity = luckyNumbers.length;
        if (ticketQuantity == 0) revert InvalidConfig();
        if (revealImmediately && ticketQuantity > MAX_BUNDLE_MINT_AND_REVEAL) {
            revert RevealBatchTooLarge();
        }

        (uint256 pointsPerTicket, bool useLuckyNumber) = core.seriesMintConfig(seriesID);
        for (uint256 i = 0; i < ticketQuantity; i++) {
            if (useLuckyNumber ? luckyNumbers[i] == 0 : luckyNumbers[i] != 0) {
                revert InvalidConfig();
            }
        }

        if (pointsPerTicket == 0) revert InvalidConfig();
        uint256 priceInPoints = pointsPerTicket * ticketQuantity;
        uint256 rebate = _rebateFor(seriesID, ticketQuantity);
        uint256 paidPointsPerTicket = pointsPerTicket;
        if (rebate >= priceInPoints) {
            paidPointsPerTicket = 0;
        } else if (rebate != 0) {
            paidPointsPerTicket = (priceInPoints - rebate) / ticketQuantity;
        }

        doudoPoints.burnFromWithReason(msg.sender, priceInPoints, BUNDLE_MINT);
        firstTokenID = core.moduleMintUnrevealed(
            msg.sender,
            seriesID,
            luckyNumbers,
            paidPointsPerTicket,
            true
        );

        if (revealImmediately) {
            uint256[] memory tokenIDs = new uint256[](ticketQuantity);
            unchecked {
                for (uint256 i; i < ticketQuantity; ++i) {
                    tokenIDs[i] = firstTokenID + i;
                }
            }
            core.reveal(seriesID, tokenIDs);
        }

        if (rebate != 0) {
            doudoPoints.mintWithReason(msg.sender, rebate, BUNDLE_REBATE);
            emit TicketPurchaseRebatePaid(seriesID, msg.sender, ticketQuantity, rebate);
        }

        emit TicketPurchaseMinted(
            seriesID,
            msg.sender,
            ticketQuantity,
            priceInPoints,
            revealImmediately,
            firstTokenID
        );
    }

    function _rebateFor(
        uint256 seriesID,
        uint256 ticketQuantity
    ) internal view returns (uint256) {
        RebateTier[] storage tiers = seriesRebateTiers[seriesID];
        uint256 length = tiers.length;

        uint256 rebate;
        for (uint256 i = 0; i < length; i++) {
            RebateTier storage tier = tiers[i];
            if (ticketQuantity < tier.minimumTicketQuantity) break;
            rebate = tier.rebatePoints;
        }
        return rebate;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[44] private __gap;
}
