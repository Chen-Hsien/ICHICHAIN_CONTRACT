// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract ERC721ATicketStateReceiver is IERC721Receiver {
    address public immutable target;
    uint256 public callbackCount;
    uint256 public observedTokenId;
    uint256 public observedSeriesId;
    uint256 public observedPrizeId;
    bool public observedExchanged;
    bool public observedRevealed;
    uint16 public observedLuckyNumber;
    uint256 public observedPointsPaid;
    bytes public reentryData;
    bool public reentrySucceeded;

    constructor(address target_) {
        target = target_;
    }

    function execute(bytes calldata data) external returns (bytes memory result) {
        (bool success, bytes memory returnData) = target.call(data);
        if (!success) {
            assembly {
                revert(add(32, returnData), mload(returnData))
            }
        }
        return returnData;
    }

    function configureReentry(bytes calldata data) external {
        reentryData = data;
        reentrySucceeded = false;
    }

    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        require(msg.sender == target, "Unexpected NFT");

        (bool statusOk, bytes memory statusData) = target.staticcall(
            abi.encodeWithSignature("ticketStatusDetail(uint256)", tokenId)
        );
        require(statusOk && statusData.length >= 160, "Missing ticket state");
        (
            observedSeriesId,
            observedPrizeId,
            observedExchanged,
            observedRevealed,
            observedLuckyNumber
        ) = abi.decode(statusData, (uint256, uint256, bool, bool, uint16));

        (bool pointsOk, bytes memory pointsData) = target.staticcall(
            abi.encodeWithSignature("pointsPaid(uint256)", tokenId)
        );
        require(pointsOk, "Missing points state");
        observedPointsPaid = abi.decode(pointsData, (uint256));
        observedTokenId = tokenId;
        callbackCount += 1;

        bytes memory attackData = reentryData;
        if (attackData.length != 0) {
            delete reentryData;
            (reentrySucceeded, ) = target.call(attackData);
        }

        return IERC721Receiver.onERC721Received.selector;
    }
}
