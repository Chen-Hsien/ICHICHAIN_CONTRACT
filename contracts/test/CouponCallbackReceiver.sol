// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Local regression fixture: inspect initialized state and replay checkout from an NFT callback.
contract CouponCallbackReceiver is IERC721Receiver {
    address public immutable nft;
    address private checkout;
    bytes private checkoutData;
    address private stateTarget;
    bytes private stateQuery;
    bytes public observedState;
    bytes public replayResult;
    bool public replaySucceeded;
    uint256 public callbackCount;

    constructor(address nft_) { nft = nft_; }

    function execute(address checkout_, bytes calldata data, address stateTarget_, bytes calldata query) external {
        checkout = checkout_;
        checkoutData = data;
        stateTarget = stateTarget_;
        stateQuery = query;
        (bool ok, bytes memory result) = checkout_.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        require(msg.sender == nft, "Unexpected NFT");
        callbackCount++;
        (bool ok, bytes memory state) = stateTarget.staticcall(stateQuery);
        require(ok, "Missing initialized state");
        observedState = state;
        (replaySucceeded, replayResult) = checkout.call(checkoutData);
        return IERC721Receiver.onERC721Received.selector;
    }
}
