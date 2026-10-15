// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../fixed-probability/FixedProbabilityTypes.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
/// @dev Fixed linked signature/format validation, executed in the proxy's domain.
library FixedProbabilityBuybackValidation {
    bytes32 private constant TYPEHASH=keccak256("BuybackAuthorization(bytes32 batchId,address buyer,address coreAddress,bytes32 itemsHash,bytes32 quoteHash,uint256 totalPoints,uint256 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH=keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    error InvalidBuybackAuthorization(); error InvalidBuybackItems();
    function digest(FixedProbabilityTypes.BuybackAuthorization calldata auth) external view returns(bytes32) { return _digest(auth); }
    function _digest(FixedProbabilityTypes.BuybackAuthorization calldata auth) private view returns(bytes32) {
        bytes32 domain=keccak256(abi.encode(DOMAIN_TYPEHASH,keccak256("DOUDO Prize Buyback"),keccak256("1"),block.chainid,address(this)));
        return keccak256(abi.encodePacked("\x19\x01",domain,keccak256(abi.encode(TYPEHASH,auth))));
    }
    function validate(FixedProbabilityTypes.BuybackAuthorization calldata auth,uint256[] calldata tokenIds,
        uint256[] calldata points,bytes calldata signature) external view returns(address) {
        if(auth.buyer!=msg.sender || auth.coreAddress!=address(this) || auth.batchId==bytes32(0) || auth.quoteHash==bytes32(0)
            || block.timestamp>auth.deadline) revert InvalidBuybackAuthorization();
        if(tokenIds.length==0 || tokenIds.length>50 || tokenIds.length!=points.length ||
            keccak256(abi.encode(tokenIds,points))!=auth.itemsHash) revert InvalidBuybackItems();
        uint256 total;
        for(uint256 i;i<tokenIds.length;++i) {
            if(points[i]==0 || (i>0 && tokenIds[i]<=tokenIds[i-1])) revert InvalidBuybackItems();
            total+=points[i];
        }
        if(total!=auth.totalPoints) revert InvalidBuybackItems();
        return ECDSA.recover(_digest(auth),signature);
    }
}
