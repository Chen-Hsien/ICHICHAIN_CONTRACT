// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

library SafeERC721AReceiver {
    error InvalidERC721Receiver();

    function notify(
        address operator,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal {
        if (to.code.length == 0) return;

        for (uint256 i = 0; i < quantity; ) {
            uint256 tokenId = startTokenId + i;
            bool accepted;
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, shl(224, 0x150b7a02))
                mstore(add(ptr, 0x04), operator)
                mstore(add(ptr, 0x24), 0)
                mstore(add(ptr, 0x44), tokenId)
                mstore(add(ptr, 0x64), 0x80)
                mstore(add(ptr, 0x84), 0)

                accepted := call(gas(), to, 0, ptr, 0xa4, ptr, 0x20)
                accepted := and(
                    accepted,
                    and(
                        eq(returndatasize(), 0x20),
                        eq(mload(ptr), shl(224, 0x150b7a02))
                    )
                )
            }
            if (!accepted) revert InvalidERC721Receiver();
            unchecked {
                ++i;
            }
        }
    }
}
