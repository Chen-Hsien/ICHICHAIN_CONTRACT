// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IDOUDOCOINNFTReentryTarget {
    function mintMembershipNFT(address to, uint256 membershipLevel) external;

    function transferFrom(address from, address to, uint256 tokenId) external;

    function isMembershipNFT(uint256 tokenId) external view returns (bool);

    function userInfo(
        address user
    )
        external
        view
        returns (
            uint256 totalRedeemed,
            uint256 currentRoundRedeemed,
            uint256 membershipLevel,
            uint256 membershipNFT,
            uint256 lastActiveTimestamp
        );
}

contract ReentrantDOUDOCOINNFTReceiver is IERC721Receiver {
    enum Attack {
        None,
        MintMembership,
        TransferReceivedToken
    }

    IDOUDOCOINNFTReentryTarget public immutable target;
    Attack public attack;
    address public transferRecipient;
    bool public reentrySucceeded;
    bool public membershipFlagDuringCallback;
    uint256 public membershipNFTDuringCallback;
    uint256 public membershipLevelDuringCallback;
    uint256 public callbackCount;

    constructor(address target_) {
        target = IDOUDOCOINNFTReentryTarget(target_);
    }

    function configure(Attack attack_, address transferRecipient_) external {
        attack = attack_;
        transferRecipient = transferRecipient_;
        reentrySucceeded = false;
    }

    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        callbackCount += 1;
        membershipFlagDuringCallback = target.isMembershipNFT(tokenId);
        (, , membershipLevelDuringCallback, membershipNFTDuringCallback, ) = target
            .userInfo(address(this));

        if (attack == Attack.MintMembership) {
            try target.mintMembershipNFT(address(this), 1) {
                reentrySucceeded = true;
            } catch {}
        } else if (attack == Attack.TransferReceivedToken) {
            try target.transferFrom(address(this), transferRecipient, tokenId) {
                reentrySucceeded = true;
            } catch {}
        }

        return IERC721Receiver.onERC721Received.selector;
    }
}
