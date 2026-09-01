// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoBundleRefundAccounting {
    function consumeTicketRefundAccounting(
        uint256 tokenID
    )
        external
        returns (
            bool membershipRecorded,
            uint256 membershipRewardPoints,
            address membershipWallet
        );
}
