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

    struct OpeningDiscountConfig {
        uint256 ticketLimit;
        uint256 priceInPoints;
        bool active;
    }

    struct TicketPurchaseQuote {
        uint256 basePriceInPoints;
        uint256 openingPriceInPoints;
        uint256 openingQuantity;
        uint256 regularQuantity;
        uint256 grossPriceInPoints;
        uint256 rebatePoints;
    }

    IDoudoCore public core;
    IDoudoPoints public doudoPoints;
    address public redrawModule;

    mapping(uint256 => mapping(uint256 => BundleConfig)) private seriesBundles;
    mapping(uint256 => RebateTier[]) public seriesRebateTiers;
    mapping(uint256 => OpeningDiscountConfig) public seriesOpeningDiscounts;
    mapping(uint256 => uint256) public openingDiscountUsed;

    error InvalidConfig();
    error RevealBatchTooLarge();
    error PriceLimitRequired();
    error PriceExceedsLimit(uint256 actualPriceInPoints, uint256 maxPriceInPoints);

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
    event OpeningDiscountConfigured(
        uint256 indexed seriesID,
        uint256 ticketLimit,
        uint256 priceInPoints
    );
    event OpeningDiscountCleared(uint256 indexed seriesID);
    event OpeningDiscountApplied(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 openingQuantity,
        uint256 regularQuantity,
        uint256 openingPriceInPoints,
        uint256 grossPriceInPoints,
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

    function setSeriesOpeningDiscount(
        uint256 seriesID,
        uint256 ticketLimit,
        uint256 priceInPoints
    ) external onlyRole(OPERATION_ROLE) {
        (uint256 basePriceInPoints, ) = core.seriesMintConfig(seriesID);
        if (
            basePriceInPoints == 0 ||
            ticketLimit == 0 ||
            priceInPoints == 0 ||
            priceInPoints >= basePriceInPoints ||
            openingDiscountUsed[seriesID] != 0
        ) {
            revert InvalidConfig();
        }

        seriesOpeningDiscounts[seriesID] = OpeningDiscountConfig({
            ticketLimit: ticketLimit,
            priceInPoints: priceInPoints,
            active: true
        });
        emit OpeningDiscountConfigured(seriesID, ticketLimit, priceInPoints);
    }

    function clearSeriesOpeningDiscount(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
        OpeningDiscountConfig storage config = seriesOpeningDiscounts[seriesID];
        if (!config.active || openingDiscountUsed[seriesID] != 0) {
            revert InvalidConfig();
        }

        delete seriesOpeningDiscounts[seriesID];
        emit OpeningDiscountCleared(seriesID);
    }

    function quoteTicketPurchase(
        uint256 seriesID,
        uint256 ticketQuantity
    )
        external
        view
        returns (
            uint256 openingQuantity,
            uint256 regularQuantity,
            uint256 grossPriceInPoints,
            uint256 rebatePoints
        )
    {
        TicketPurchaseQuote memory quote = _quoteTicketPurchase(seriesID, ticketQuantity);
        return (
            quote.openingQuantity,
            quote.regularQuantity,
            quote.grossPriceInPoints,
            quote.rebatePoints
        );
    }

    function mintTickets(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately
    ) external nonReentrant returns (uint256 firstTokenID) {
        OpeningDiscountConfig storage config = seriesOpeningDiscounts[seriesID];
        if (config.active && openingDiscountUsed[seriesID] < config.ticketLimit) {
            revert PriceLimitRequired();
        }
        firstTokenID = _mintTickets(
            seriesID,
            luckyNumbers,
            revealImmediately,
            type(uint256).max
        );
    }

    function mintTicketsWithPriceLimit(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately,
        uint256 maxTotalPriceInPoints
    ) external nonReentrant returns (uint256 firstTokenID) {
        firstTokenID = _mintTickets(
            seriesID,
            luckyNumbers,
            revealImmediately,
            maxTotalPriceInPoints
        );
    }

    function _mintTickets(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        bool revealImmediately,
        uint256 maxTotalPriceInPoints
    ) internal returns (uint256 firstTokenID) {
        uint256 ticketQuantity = luckyNumbers.length;
        if (ticketQuantity == 0) revert InvalidConfig();
        if (revealImmediately && ticketQuantity > MAX_BUNDLE_MINT_AND_REVEAL) {
            revert RevealBatchTooLarge();
        }

        (, bool useLuckyNumber) = core.seriesMintConfig(seriesID);
        for (uint256 i = 0; i < ticketQuantity; i++) {
            if (useLuckyNumber ? luckyNumbers[i] == 0 : luckyNumbers[i] != 0) {
                revert InvalidConfig();
            }
        }

        TicketPurchaseQuote memory quote = _quoteTicketPurchase(seriesID, ticketQuantity);
        if (quote.grossPriceInPoints > maxTotalPriceInPoints) {
            revert PriceExceedsLimit(quote.grossPriceInPoints, maxTotalPriceInPoints);
        }
        if (quote.openingQuantity != 0) {
            openingDiscountUsed[seriesID] += quote.openingQuantity;
        }

        doudoPoints.burnFromWithReason(msg.sender, quote.grossPriceInPoints, BUNDLE_MINT);
        firstTokenID = _mintPricedSegments(seriesID, luckyNumbers, quote);

        if (revealImmediately) {
            uint256[] memory tokenIDs = new uint256[](ticketQuantity);
            unchecked {
                for (uint256 i; i < ticketQuantity; ++i) {
                    tokenIDs[i] = firstTokenID + i;
                }
            }
            core.reveal(seriesID, tokenIDs);
        }

        if (quote.rebatePoints != 0) {
            doudoPoints.mintWithReason(msg.sender, quote.rebatePoints, BUNDLE_REBATE);
            emit TicketPurchaseRebatePaid(
                seriesID,
                msg.sender,
                quote.regularQuantity,
                quote.rebatePoints
            );
        }

        if (quote.openingQuantity != 0) {
            emit OpeningDiscountApplied(
                seriesID,
                msg.sender,
                quote.openingQuantity,
                quote.regularQuantity,
                quote.openingPriceInPoints,
                quote.grossPriceInPoints,
                quote.rebatePoints
            );
        }

        emit TicketPurchaseMinted(
            seriesID,
            msg.sender,
            ticketQuantity,
            quote.grossPriceInPoints,
            revealImmediately,
            firstTokenID
        );
    }

    function _quoteTicketPurchase(
        uint256 seriesID,
        uint256 ticketQuantity
    ) internal view returns (TicketPurchaseQuote memory quote) {
        if (ticketQuantity == 0) revert InvalidConfig();
        (quote.basePriceInPoints, ) = core.seriesMintConfig(seriesID);
        if (quote.basePriceInPoints == 0) revert InvalidConfig();

        OpeningDiscountConfig storage config = seriesOpeningDiscounts[seriesID];
        quote.openingPriceInPoints = config.priceInPoints;
        uint256 used = openingDiscountUsed[seriesID];
        if (config.active && used < config.ticketLimit) {
            uint256 openingRemaining = config.ticketLimit - used;
            quote.openingQuantity = ticketQuantity < openingRemaining
                ? ticketQuantity
                : openingRemaining;
        }
        quote.regularQuantity = ticketQuantity - quote.openingQuantity;
        quote.rebatePoints = _rebateFor(seriesID, quote.regularQuantity);
        quote.grossPriceInPoints =
            quote.openingQuantity * config.priceInPoints +
            quote.regularQuantity * quote.basePriceInPoints;
    }

    function _mintPricedSegments(
        uint256 seriesID,
        uint16[] calldata luckyNumbers,
        TicketPurchaseQuote memory quote
    ) internal returns (uint256 firstTokenID) {
        uint256 cursor;
        if (quote.openingQuantity != 0) {
            firstTokenID = core.moduleMintUnrevealed(
                msg.sender,
                seriesID,
                _sliceLuckyNumbers(luckyNumbers, 0, quote.openingQuantity),
                quote.openingPriceInPoints,
                true
            );
            cursor = quote.openingQuantity;
        }

        uint256 refundableRebate = quote.rebatePoints;
        uint256 regularGrossPrice = quote.regularQuantity * quote.basePriceInPoints;
        if (refundableRebate > regularGrossPrice) {
            refundableRebate = regularGrossPrice;
        }
        if (quote.regularQuantity != 0) {
            uint256 discountPerRegularTicket = refundableRebate / quote.regularQuantity;
            uint256 discountRemainder = refundableRebate % quote.regularQuantity;
            uint256 paidPerRegularTicket = quote.basePriceInPoints - discountPerRegularTicket;

            if (discountRemainder != 0) {
                uint256 tokenID = core.moduleMintUnrevealed(
                    msg.sender,
                    seriesID,
                    _sliceLuckyNumbers(luckyNumbers, cursor, discountRemainder),
                    paidPerRegularTicket - 1,
                    true
                );
                if (cursor == 0) firstTokenID = tokenID;
                cursor += discountRemainder;
            }

            uint256 regularRemainder = quote.regularQuantity - discountRemainder;
            if (regularRemainder != 0) {
                uint256 tokenID = core.moduleMintUnrevealed(
                    msg.sender,
                    seriesID,
                    _sliceLuckyNumbers(luckyNumbers, cursor, regularRemainder),
                    paidPerRegularTicket,
                    true
                );
                if (cursor == 0) firstTokenID = tokenID;
            }
        }
    }

    function _sliceLuckyNumbers(
        uint16[] calldata luckyNumbers,
        uint256 start,
        uint256 length
    ) internal pure returns (uint16[] memory sliced) {
        sliced = new uint16[](length);
        for (uint256 i = 0; i < length; i++) {
            sliced[i] = luckyNumbers[start + i];
        }
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

    uint256[42] private __gap;
}
