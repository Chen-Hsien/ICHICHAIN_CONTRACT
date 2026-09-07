// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal view of DOUDOCHAINV2CoreUpgradeable's series-creation entry,
/// used by MerchantSeriesPublisher to publish without importing the full Core.
/// Struct field order/types mirror the deployed Core so calldata encoding matches.
interface IDoudoSeriesPublishing {
    enum PackingType {
        Unknown,
        Assorted,
        OriginalCase
    }

    enum SourceType {
        Unknown,
        Japan,
        Distributor
    }

    struct SubPrize {
        uint256 subPrizeID;
        string prizeGroup;
        string subPrizeName;
        uint256 subPrizeRemainingQuantity;
    }

    struct SeriesInput {
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 priceInPoints;
        uint256 priceInTWD;
        uint256 estimateDeliverTime;
        string exchangeTokenURI;
        string unrevealTokenURI;
        string revealTokenURI;
        string seriesMetaDataURI;
        bool isPreOrder;
        bool useLuckyNumber;
        uint256 maxPerWallet;
        uint8 packingType;
        uint8 sourceType;
    }

    function createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool revealEnabled
    ) external returns (uint256 seriesID);

    function setSeriesMetadata(
        uint256 seriesID,
        string calldata exchangeTokenURI,
        string calldata unrevealTokenURI,
        string calldata revealTokenURI,
        string calldata seriesMetaDataURI,
        uint256 extendedExchangeExpireTime
    ) external;
}
