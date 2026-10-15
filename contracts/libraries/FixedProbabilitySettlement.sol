// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../fixed-probability/FixedProbabilityTypes.sol";
interface IFixedProbabilityAccountingMembership {
    function recordConsumption(address,uint256,bytes32) external returns(uint256,uint8,uint8,uint64);
    function reverseConsumption(address,uint256,bytes32) external returns(uint8,uint8,uint256,uint256);
}
/// @dev Linked delegate library; storage references come only from the guarded UUPS core.
/// No independent state or mutable routing. Event and accounting behavior match legacy V3.
library FixedProbabilitySettlement {
    uint16 private constant NO_TRIGGER=type(uint16).max;
    uint256 private constant TOTAL_WEIGHT=10000;
    bytes32 private constant MEMBERSHIP_DOMAIN=keccak256("FIXED_PROBABILITY_MEMBERSHIP_V3");
    error InvalidOrderState(); error UnknownOrder(); error AccountingAlreadyFinalized(); error InvalidConfig();
    event RandomnessStored(uint256 indexed orderId, uint256 indexed requestId, uint256[] randomWords);
    event DrawSettled(
        uint256 indexed orderId,
        uint256 indexed drawId,
        uint16 drawIndex,
        uint256 roll,
        uint256 prizeId
    );
    event OrderSettled(
        uint256 indexed orderId,
        bool freeOrderWon,
        uint16 firstTriggerIndex,
        uint256 refundPoints
    );
    event OrderAccountingFinalized(
        uint256 indexed orderId,
        address indexed buyer,
        bytes32 indexed membershipConsumptionId,
        uint256 finalPointsConsumed,
        uint256 refundPoints,
        uint256 membershipRewardPoints,
        uint8 previousLevel,
        uint8 newLevel,
        uint64 expiresAt
    );

    event DatabasePointsFreeOrderChallengeRefunded(
        uint256 indexed requestId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 refundPoints
    );
    event UpdateTicketStatus(
        uint256 tokenID,
        uint256 seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed
    );

    event OrderRequested(
        uint256 indexed orderId,
        uint256 indexed requestId,
        address indexed buyer,
        uint256 seriesId,
        bytes32 configHash,
        bytes32 authorizationId,
        uint16 quantity,
        uint256 firstDrawId,
        uint256 grossPoints,
        uint256 rebatePoints,
        uint256 netPoints,
        bool freeOrderChallenge,
        bytes32 eligibilityKey,
        uint8 levelAtRequest,
        uint256 acceptedDrawsBefore
    );
    event TicketPurchaseMinted(
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 priceInPoints,
        bool revealImmediately,
        uint256 firstTokenID
    );
    event DatabasePointsPurchaseMinted(
        bytes32 indexed authorizationId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 ticketQuantity,
        uint256 grossPoints,
        uint256 rebatePoints,
        uint256 netPointsConsumed,
        uint256 membershipRewardPoints,
        bool revealImmediately,
        bool freeOrderChallenge,
        uint256 firstTokenID,
        uint256 challengeRequestId
    );
    event DatabasePointsRebateEntitled(
        bytes32 indexed authorizationId,
        uint256 indexed seriesID,
        address indexed buyer,
        uint256 rebatePoints
    );
    function fulfill(mapping(uint256=>FixedProbabilityTypes.Order) storage _orders,mapping(uint256=>FixedProbabilityTypes.Series) storage _series,
        mapping(uint256=>FixedProbabilityTypes.Draw) storage _draws,mapping(uint256=>uint256) storage requestToOrder,
        uint256 requestId,uint256[] calldata randomWords) external {
        uint256 orderId = requestToOrder[requestId];
        FixedProbabilityTypes.Order storage order = _orders[orderId];
        if (
            orderId == 0 ||
            order.state != FixedProbabilityTypes.OrderState.PENDING ||
            randomWords.length != order.quantity
        ) revert InvalidOrderState();
        FixedProbabilityTypes.SeriesConfig storage config = _series[order.seriesId].config;
        order.randomWords = randomWords;
        order.state = FixedProbabilityTypes.OrderState.RANDOM_READY;
        emit RandomnessStored(orderId, requestId, randomWords);

        bool won;
        uint16 trigger = NO_TRIGGER;
        for (uint16 i = 0; i < order.quantity; i++) {
            uint256 drawId = order.firstDrawId + i;
            FixedProbabilityTypes.Draw storage draw = _draws[drawId];
            uint256 roll = randomWords[i] % TOTAL_WEIGHT;
            uint256 prizeId = _prizeForRoll(config, roll);
            draw.roll = roll;
            draw.prizeId = prizeId;
            if (
                !won &&
                order.freeOrderChallenge &&
                _contains(config.freeOrderPrizeIds, prizeId)
            ) {
                won = true;
                trigger = i;
            }
            emit DrawSettled(orderId, drawId, i, roll, prizeId);
            emit UpdateTicketStatus(drawId, order.seriesId, prizeId, false, true);
        }
        order.freeOrderWon = won;
        order.firstTriggerIndex = trigger;
        order.refundPoints = won ? order.netPoints : 0;
        order.state = FixedProbabilityTypes.OrderState.SETTLED;
        delete requestToOrder[requestId];
        emit OrderSettled(orderId, won, trigger, order.refundPoints);
    }
    function finalizeAccounting(mapping(uint256=>FixedProbabilityTypes.Order) storage _orders,address membership,uint256 orderId) external {
        FixedProbabilityTypes.Order storage order = _orders[orderId];
        if (order.orderId == 0) revert UnknownOrder();
        if (order.state != FixedProbabilityTypes.OrderState.SETTLED) revert InvalidOrderState();
        if (order.accountingFinalized) revert AccountingAlreadyFinalized();
        order.accountingFinalized = true;

        if (order.refundPoints != 0) {
            IFixedProbabilityAccountingMembership(membership).reverseConsumption(
                order.buyer,
                order.refundPoints,
                keccak256(abi.encode(MEMBERSHIP_DOMAIN, order.membershipConsumptionId, "REVERSAL"))
            );
            order.membershipRewardPoints = 0;
            order.finalPointsConsumed = 0;
            emit DatabasePointsFreeOrderChallengeRefunded(
                order.requestId,
                order.seriesId,
                order.buyer,
                order.refundPoints
            );
        } else {
            order.finalPointsConsumed = order.netPoints;
        }
        emit OrderAccountingFinalized(
            orderId,
            order.buyer,
            order.membershipConsumptionId,
            order.finalPointsConsumed,
            order.refundPoints,
            order.membershipRewardPoints,
            order.previousLevel,
            order.newLevel,
            order.expiresAt
        );
    }

    function _prizeForRoll(
        FixedProbabilityTypes.SeriesConfig storage config,
        uint256 roll
    ) internal view returns (uint256) {
        uint256 cursor;
        for (uint256 i = 0; i < config.prizeIds.length; i++) {
            cursor += config.weights[i];
            if (roll < cursor) return config.prizeIds[i];
        }
        revert InvalidConfig();
    }

    function _contains(
        uint256[] storage values,
        uint256 needle
    ) internal view returns (bool) {
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] == needle) return true;
        }
        return false;
    }

    function prepareOrder(FixedProbabilityTypes.Order storage order,FixedProbabilityTypes.DrawAuthorization calldata authorization,
        uint256 orderId,uint256 firstDrawId,uint256 acceptedBefore,uint8 level,address membership) external {
        bytes32 membershipConsumptionId = keccak256(
            abi.encode(
                MEMBERSHIP_DOMAIN,
                block.chainid,
                address(this),
                orderId,
                authorization.authorizationId
            )
        );

        order.orderId = orderId;
        order.buyer = msg.sender;
        order.seriesId = authorization.seriesId;
        order.configHash = authorization.configHash;
        order.authorizationId = authorization.authorizationId;
        order.quantity = authorization.quantity;
        order.firstDrawId = firstDrawId;
        order.grossPoints = authorization.grossPoints;
        order.rebatePoints = authorization.rebatePoints;
        order.netPoints = authorization.netPoints;
        order.freeOrderChallenge = authorization.freeOrderChallenge;
        order.eligibilityKey = authorization.eligibilityKey;
        order.levelAtRequest = level;
        order.acceptedDrawsBefore = acceptedBefore;
        order.state = FixedProbabilityTypes.OrderState.PENDING;
        order.firstTriggerIndex = NO_TRIGGER;
        order.membershipConsumptionId = membershipConsumptionId;

        if (authorization.netPoints != 0) {
            (
                order.membershipRewardPoints,
                order.previousLevel,
                order.newLevel,
                order.expiresAt
            ) = IFixedProbabilityAccountingMembership(membership).recordConsumption(msg.sender, authorization.netPoints, membershipConsumptionId);
        }

    }
    function emitRequested(FixedProbabilityTypes.Order storage order) external {
        emit OrderRequested(order.orderId,order.requestId,order.buyer,order.seriesId,order.configHash,order.authorizationId,
            order.quantity,order.firstDrawId,order.grossPoints,order.rebatePoints,order.netPoints,order.freeOrderChallenge,
            order.eligibilityKey,order.levelAtRequest,order.acceptedDrawsBefore);
    }
    function emitPurchase(FixedProbabilityTypes.Order storage order) external {
        emit TicketPurchaseMinted(order.seriesId,order.buyer,order.quantity,order.grossPoints,false,order.firstDrawId);
        emit DatabasePointsPurchaseMinted(order.authorizationId,order.seriesId,order.buyer,order.quantity,order.grossPoints,
            order.rebatePoints,order.netPoints,order.membershipRewardPoints,false,order.freeOrderChallenge,order.firstDrawId,order.requestId);
        if(order.rebatePoints!=0) emit DatabasePointsRebateEntitled(order.authorizationId,order.seriesId,order.buyer,order.rebatePoints);
    }
}
