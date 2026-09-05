// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract OpeningDiscountCallbackReceiver is IERC721Receiver {
    address public immutable bundle;
    bytes public attack;
    bool public propagateFailure;
    bool public succeeded;
    bytes public result;

    constructor(address bundle_) { bundle = bundle_; }

    function configure(bytes calldata data, bool propagate) external {
        attack = data;
        propagateFailure = propagate;
        succeeded = false;
        delete result;
    }

    function execute(bytes calldata data) external {
        (bool ok, bytes memory reason) = bundle.call(data);
        if (!ok) assembly { revert(add(reason, 32), mload(reason)) }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (attack.length != 0) {
            bytes memory data = attack;
            delete attack;
            (succeeded, result) = bundle.call(data);
            if (!succeeded && propagateFailure) {
                bytes memory reason = result;
                assembly { revert(add(reason, 32), mload(reason)) }
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
