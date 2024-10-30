// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// 首先，確保您的 rewardToken 合約有一個 mint 函數
interface IDOUDOCOIN is IERC20 {
    function mint(address to, uint256 amount) external returns (bool);
}

contract DOUDOCOINNFT is
    ERC721,
    ERC721Enumerable,
    ERC721Burnable,
    AccessControl
{
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    struct VoucherType {
        uint256 amount; // The value of this voucher type in tokens
        uint256 maxPerUser; // Maximum number of this type a user can purchase
        string tokenURI; // The token URI for this voucher type
    }

    struct UserInfo {
        uint256 totalRedeemed; // Total amount of tokens redeemed
        uint256 currentRoundRedeemed; // Amount of tokens redeemed in the current round
        uint256 membershipLevel; // Current membership level of the user (index)
        uint256 membershipNFT; // ID of the membership NFT the user owns
        uint256 lastActiveTimestamp; // Last active timestamp (last time user redeemed)
    }

    struct MembershipLevel {
        string name; // Membership level name
        uint256 threshold; // Cumulative consumption threshold to reach this level
        string membershipTokenURI; // URI for the membership NFT
        uint256 rewardBasisPoints; // Additional reward percentage when burning vouchers
    }

    // Membership expiration period (e.g., 6 months = 180 days * 24 hours * 60 minutes * 60 seconds)
    uint256 public membershipExpirationPeriod = 180 days;

    // Mapping of token ID to voucher type ID
    mapping(uint256 => uint256) public voucherTypeIds;

    // Mapping of token ID to membership status (only for membership NFTs)
    mapping(uint256 => bool) public isMembershipNFT;

    // Mapping of user address to their voucher purchases and redemption history
    mapping(address => UserInfo) public userInfo;

    // Mapping of voucher type ID to VoucherType details
    mapping(uint256 => VoucherType) public voucherTypes;

    // Token contract for rewards (ERC20)
    IDOUDOCOIN public rewardToken;

    // List of membership levels and their thresholds
    MembershipLevel[] public membershipLevels;

    uint256 public nextVoucherTypeId = 0;

    // Roles
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    event VoucherMinted(
        uint256 tokenId,
        address recipient,
        uint256 voucherTypeId
    );
    event VoucherRedeemed(uint256 tokenId, address redeemer, uint256 amount);
    event MembershipUpgraded(address user, uint256 newLevel, string levelName);
    event MembershipNFTMinted(address user, uint256 tokenId, string levelName);
    event MembershipNFTBurned(address user, uint256 tokenId);
    event MembershipExpired(address user);
    event MembershipTransferred(
        address from,
        address to,
        uint256 tokenId,
        string levelName
    );
    event VouchersIssuedFromSubscription(
        address indexed user,
        uint256[] voucherTypeIds,
        uint256[] amounts,
        uint256 totalAmount
    );

    constructor(
        address rewardTokenAddress,
        address defaultAdmin,
        address minter
    ) ERC721("DOUDOCOINNFT", "DOUDO") {
        rewardToken = IDOUDOCOIN(rewardTokenAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, minter);

        // Add a "No Membership" level
        _addMembershipLevel(
            "Common",
            0,
            "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmTMMQCWK1vVXyo7NCZQawRY7wBQPrmbpgvyqehLxxKJAL/common.json",
            0
        );

        // Now add the other levels
        _addMembershipLevel(
            "Silver",
            10000 ether,
            "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmTMMQCWK1vVXyo7NCZQawRY7wBQPrmbpgvyqehLxxKJAL/sliver.json",
            100
        ); // 1% additional reward (100 basis points)
        _addMembershipLevel(
            "Gold",
            50000 ether,
            "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmTMMQCWK1vVXyo7NCZQawRY7wBQPrmbpgvyqehLxxKJAL/gold.json",
            150
        ); // 1.5% additional reward (150 basis points)
        _addMembershipLevel(
            "Platinum",
            100000 ether,
            "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmTMMQCWK1vVXyo7NCZQawRY7wBQPrmbpgvyqehLxxKJAL/Platinum.json",
            300
        ); // 3% additional reward (300 basis points)
    }

    // Admin function to create a new voucher type with specific amount, purchase limit, and tokenURI
    function createVoucherType(
        uint256 amount,
        uint256 maxPerUser,
        string memory _tokenURI
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        voucherTypes[nextVoucherTypeId] = VoucherType(
            amount,
            maxPerUser,
            _tokenURI
        );
        nextVoucherTypeId++;
    }

    // Override the tokenURI function to return the specific URI for each voucher type or membership level
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        if (isMembershipNFT[tokenId]) {
            uint256 membershipLevel = userInfo[msg.sender].membershipLevel;
            return membershipLevels[membershipLevel].membershipTokenURI;
        }
        uint256 voucherTypeId = voucherTypeIds[tokenId];
        return voucherTypes[voucherTypeId].tokenURI;
    }

    // 鑄造普通 voucher 的函數
    function mintVouchers(
        address to,
        uint256[] memory _voucherTypeIds,
        uint256[] memory quantities
    ) public onlyRole(MINTER_ROLE) {
        require(
            _voucherTypeIds.length == quantities.length,
            "Mismatched inputs"
        );

        for (uint256 i = 0; i < _voucherTypeIds.length; i++) {
            uint256 voucherTypeId = _voucherTypeIds[i];
            uint256 quantity = quantities[i];

            require(voucherTypeId < nextVoucherTypeId, "Invalid voucher type");

            uint256 userVoucherCount = getUserVoucherCount(to, voucherTypeId);
            require(
                userVoucherCount + quantity <=
                    voucherTypes[voucherTypeId].maxPerUser,
                "Exceeds max vouchers per user"
            );

            for (uint256 j = 0; j < quantity; j++) {
                _tokenIds.increment();
                uint256 tokenId = _tokenIds.current();
                _safeMint(to, tokenId);
                voucherTypeIds[tokenId] = voucherTypeId;
                emit VoucherMinted(tokenId, to, voucherTypeId);
            }

            updateUserVoucherCount(to, voucherTypeId, quantity);
        }
    }

    // 鑄造會員 NFT 的函數
    function mintMembershipNFT(
        address to,
        uint256 membershipLevel
    ) public onlyRole(MINTER_ROLE) {
        require(
            userInfo[to].membershipNFT == 0,
            "User already owns a membership NFT"
        );
        require(
            membershipLevel < membershipLevels.length,
            "Invalid membership level"
        );
        _tokenIds.increment();
        uint256 tokenId = _tokenIds.current();
        _safeMint(to, tokenId);

        isMembershipNFT[tokenId] = true;
        userInfo[to].membershipNFT = tokenId;
        userInfo[to].membershipLevel = membershipLevel;

        emit MembershipNFTMinted(
            to,
            tokenId,
            membershipLevels[membershipLevel].name
        );
    }

    // 輔助函數
    function getUserVoucherCount(
        address user,
        uint256 voucherTypeId
    ) public view returns (uint256) {
        return userVoucherCounts[user][voucherTypeId];
    }

    function updateUserVoucherCount(
        address user,
        uint256 voucherTypeId,
        uint256 quantity
    ) internal {
        userVoucherCounts[user][voucherTypeId] += quantity;
    }

    // 新增映射來追踪用戶每種 voucher 的數量
    mapping(address => mapping(uint256 => uint256)) private userVoucherCounts;

    // Override safeTransferFrom to handle membership or voucher transfer
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory _data
    ) public override(ERC721, IERC721) {
        super.safeTransferFrom(from, to, tokenId, _data);
        if (isMembershipNFT[tokenId]) {
            _transferMembership(from, to, tokenId);
        }
    }

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public virtual override(ERC721, IERC721) {
        // 保存原始的 packed ownership 數據
        require(
            ownerOf(tokenId) == from,
            "ERC721: transfer from incorrect owner"
        );

        // 調用原始的 transferFrom 邏輯
        super.transferFrom(from, to, tokenId);

        // 如果是會員 NFT，執行額外的會員轉移邏輯
        if (isMembershipNFT[tokenId]) {
            _transferMembership(from, to, tokenId);
        }
    }

    // Handle membership transfer logic
    function _transferMembership(
        address from,
        address to,
        uint256 tokenId
    ) internal {
        uint256 transferredLevel = userInfo[from].membershipLevel;
        uint256 transferredTotalRedeemed = userInfo[from].totalRedeemed;
        uint256 transferredCurrentRoundRedeemed = userInfo[from]
            .currentRoundRedeemed;

        // 檢查接收者是否已有會員 NFT
        uint256 recipientExistingNFT = userInfo[to].membershipNFT;
        bool recipientHasNFT = recipientExistingNFT != 0;

        if (!recipientHasNFT) {
            userInfo[to].membershipNFT = tokenId;
            userInfo[to].membershipLevel = transferredLevel;
        } else {
            if (transferredLevel > userInfo[to].membershipLevel) {
                // 處理接收者已有較低等級 NFT 的情況
                _handleLowerLevelNFT(to, recipientExistingNFT);
                userInfo[to].membershipNFT = tokenId;
                userInfo[to].membershipLevel = transferredLevel;
            } else {
                // 處理接收到較低等級 NFT 的情況
                _handleLowerLevelNFT(from, tokenId);
            }
        }

        // 更新接收者的兌換金額和時間戳
        userInfo[to].totalRedeemed += transferredTotalRedeemed;
        userInfo[to].currentRoundRedeemed += transferredCurrentRoundRedeemed;
        userInfo[to].lastActiveTimestamp = block.timestamp;

        // 重置發送者的信息
        userInfo[from].membershipLevel = 0;
        userInfo[from].membershipNFT = 0;
        userInfo[from].currentRoundRedeemed = 0;

        // 檢查並可能升級接收者的會員等級
        _updateMembershipLevel(to);

        emit MembershipTransferred(
            from,
            to,
            tokenId,
            membershipLevels[userInfo[to].membershipLevel].name
        );
    }

    // Batch burn vouchers and redeem tokens with additional rewards
    function burnVouchersBatch(uint256[] calldata tokenIds) external {
        _checkMembershipExpiration(msg.sender); // Check if membership is expired

        uint256 totalAmount = 0;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(ownerOf(tokenId) == msg.sender, "Not the owner");

            // Get the voucher type ID associated with this token
            uint256 voucherTypeId = voucherTypeIds[tokenId];
            VoucherType memory voucherType = voucherTypes[voucherTypeId];

            // Check if it's a membership NFT
            require(!isMembershipNFT[tokenId], "Cannot burn membership NFTs");

            // Burn non-membership NFTs
            _burn(tokenId);
            delete voucherTypeIds[tokenId];

            // Accumulate the total amount of tokens to redeem
            totalAmount += voucherType.amount;

            emit VoucherRedeemed(tokenId, msg.sender, voucherType.amount);
        }

        // Calculate additional rewards based on membership level
        uint256 currentLevel = userInfo[msg.sender].membershipLevel;
        uint256 additionalReward = (totalAmount *
            membershipLevels[currentLevel].rewardBasisPoints) / 10000;
        totalAmount += additionalReward;
        totalAmount = totalAmount * 10 ** 18;

        // Mint reward tokens directly to the user
        require(
            rewardToken.mint(msg.sender, totalAmount),
            "Token minting failed"
        );

        // Update the user's total redeemed amount, current round redeemed amount, and last activity timestamp
        userInfo[msg.sender].totalRedeemed += totalAmount;
        userInfo[msg.sender].currentRoundRedeemed += totalAmount; // Track current round redemption
        userInfo[msg.sender].lastActiveTimestamp = block.timestamp;

        // Check if membership level should be upgraded
        _updateMembershipLevel(msg.sender);
    }

    // Internal function to update membership level and handle NFT minting/burning
    function _updateMembershipLevel(address user) internal {
        uint256 currentRoundRedeemed = userInfo[user].currentRoundRedeemed;
        uint256 currentLevel = userInfo[user].membershipLevel;
        uint256 newLevel = currentLevel;

        // Find the highest level the user qualifies for
        for (uint256 i = membershipLevels.length - 1; i > currentLevel; i--) {
            if (currentRoundRedeemed >= membershipLevels[i].threshold) {
                newLevel = i;
                break;
            }
        }

        // Only update if the level has changed
        if (newLevel != currentLevel) {
            // Handle NFT updates
            uint256 oldMembershipNFT = userInfo[user].membershipNFT;
            if (oldMembershipNFT != 0) {
                _burn(oldMembershipNFT);
                delete isMembershipNFT[oldMembershipNFT];
                emit MembershipNFTBurned(user, oldMembershipNFT);
            }

            // Mint a new membership NFT for the upgraded level
            _tokenIds.increment();
            uint256 tokenId = _tokenIds.current();
            _safeMint(user, tokenId);
            userInfo[user].membershipNFT = tokenId;
            isMembershipNFT[tokenId] = true;

            emit MembershipNFTMinted(
                user,
                tokenId,
                membershipLevels[newLevel].name
            );

            // Update user's membership level
            userInfo[user].membershipLevel = newLevel;
            emit MembershipUpgraded(
                user,
                newLevel,
                membershipLevels[newLevel].name
            );
        }
    }

    // Check if a user's membership has expired
    function _checkMembershipExpiration(address user) internal {
        uint256 lastActive = userInfo[user].lastActiveTimestamp;
        if (block.timestamp > lastActive + membershipExpirationPeriod) {
            // Membership expired, burn the membership NFT and reset the membership level
            if (userInfo[user].membershipNFT != 0) {
                _burn(userInfo[user].membershipNFT);
                emit MembershipNFTBurned(user, userInfo[user].membershipNFT);
                userInfo[user].membershipNFT = 0;
            }
            userInfo[user].membershipLevel = 0; // Reset membership level to default (no membership)
            userInfo[user].currentRoundRedeemed = 0; // Reset current round redeemed amount
            emit MembershipExpired(user);
        }
    }

    // Admin function to update the membership expiration period
    function setMembershipExpirationPeriod(
        uint256 newExpirationPeriod
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        membershipExpirationPeriod = newExpirationPeriod;
    }

    // Admin function to add a new membership level
    function addMembershipLevel(
        string memory name,
        uint256 threshold,
        string memory _membershipTokenURI,
        uint256 rewardBasisPoints
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _addMembershipLevel(
            name,
            threshold,
            _membershipTokenURI,
            rewardBasisPoints
        );
    }

    // Admin function to update both the threshold and tokenURI of an existing membership level
    function updateMembershipLevel(
        uint256 levelIndex,
        uint256 newThreshold,
        string memory newTokenURI
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            levelIndex < membershipLevels.length,
            "Invalid membership level"
        );
        membershipLevels[levelIndex].threshold = newThreshold;
        membershipLevels[levelIndex].membershipTokenURI = newTokenURI;
    }

    // Internal function to add a new membership level
    function _addMembershipLevel(
        string memory name,
        uint256 threshold,
        string memory _membershipTokenURI,
        uint256 rewardBasisPoints
    ) internal {
        membershipLevels.push(
            MembershipLevel(
                name,
                threshold,
                _membershipTokenURI,
                rewardBasisPoints
            )
        );
    }

    // Admin function to set the token reward contract
    function setRewardToken(
        address _rewardToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rewardToken = IDOUDOCOIN(_rewardToken);
    }

    // Function for subscription contract to mint multiple types of vouchers for users
    function mintVouchersFromSubscription(
        address user,
        uint256[] calldata _voucherTypeIds,
        uint256[] calldata amounts
    ) external onlyRole(MINTER_ROLE) {
        mintVouchers(user, _voucherTypeIds, amounts);
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 voucherTypeId = _voucherTypeIds[i];
            uint256 amount = amounts[i];
            totalAmount += voucherTypes[voucherTypeId].amount * amount;
        }
        emit VouchersIssuedFromSubscription(
            user,
            _voucherTypeIds,
            amounts,
            totalAmount
        );
    }

    function isVoucherMembershipNFT(
        uint256 tokenId
    ) public view returns (bool) {
        return isMembershipNFT[tokenId];
    }

    function getVoucherTypeId(uint256 tokenId) public view returns (uint256) {
        return voucherTypeIds[tokenId];
    }

    function _handleLowerLevelNFT(address owner, uint256 tokenId) internal {
        // 這裡可以選擇銷毀 NFT 或將其轉移到一個特定地址
        // 例如：
        _burn(tokenId);
        delete isMembershipNFT[tokenId];
        emit MembershipNFTBurned(owner, tokenId);
    }

    // function _update(
    //     address to,
    //     uint256 tokenId,
    //     address auth
    // ) internal override(ERC721, ERC721Enumerable) returns (address) {
    //     return super._update(to, tokenId, auth);
    // }

    // function _increaseBalance(
    //     address account,
    //     uint128 value
    // ) internal override(ERC721, ERC721Enumerable) {
    //     super._increaseBalance(account, value);
    // }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721, ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }
}
