// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

library DoudoTokenURILib {
    function buildTokenURI(
        string memory exchangeTokenURI,
        string memory revealTokenURI,
        string memory unrevealTokenURI,
        uint256 prizeID,
        bool exchanged,
        bool revealed
    ) external pure returns (string memory) {
        if (exchanged) {
            return string(abi.encodePacked(exchangeTokenURI, _toString(prizeID)));
        }
        if (revealed) {
            return string(abi.encodePacked(revealTokenURI, _toString(prizeID)));
        }
        return unrevealTokenURI;
    }

    function _toString(uint256 value) private pure returns (string memory str) {
        assembly {
            let m := add(mload(0x40), 0xa0)
            mstore(0x40, m)
            str := sub(m, 0x20)
            mstore(str, 0)
            let end := str
            for { let temp := value } 1 {} {
                str := sub(str, 1)
                mstore8(str, add(48, mod(temp, 10)))
                temp := div(temp, 10)
                if iszero(temp) { break }
            }
            let length := sub(end, str)
            str := sub(str, 0x20)
            mstore(str, length)
        }
    }
}
