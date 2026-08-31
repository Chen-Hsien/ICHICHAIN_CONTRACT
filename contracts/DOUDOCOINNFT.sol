// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^4.9.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./interfaces/IDoudoPoints.sol";

contract DOUDOCOINNFT is
    Initializable,
    ERC721Upgradeable,
    ERC721EnumerableUpgradeable,
    ERC721BurnableUpgradeable,
    MinimalAccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
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
    uint256 public membershipExpirationPeriod;

    // Mapping of token ID to voucher type ID
    mapping(uint256 => uint256) public voucherTypeIds;

    // Mapping of token ID to membership status (only for membership NFTs)
    mapping(uint256 => bool) public isMembershipNFT;

    // Mapping of user address to their voucher purchases and redemption history
    mapping(address => UserInfo) public userInfo;

    // Mapping of voucher type ID to VoucherType details
    mapping(uint256 => VoucherType) public voucherTypes;

    // Soulbound DOUDO points token used for redemption rewards
    IDoudoPoints public rewardToken;

    // List of membership levels and their thresholds
    MembershipLevel[] public membershipLevels;

    uint256 public nextVoucherTypeId;

    // Roles
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MIGRATOR_ROLE = keccak256("MIGRATOR_ROLE");

    // Reason code emitted on DOUDO points minted from voucher redemption
    bytes32 public constant VOUCHER_REDEEM = keccak256("VOUCHER_REDEEM");

    // Membership NFT metadata base (Pinata dedicated gateway + IPFS directory CID)
    string private constant MEMBERSHIP_METADATA_BASE =
        "https://lime-basic-thrush-351.mypinata.cloud/ipfs/bafybeigarayofyyqxamwhx6mzy4cwxlw57sfrtfaz3iauxtfrdg7gymh6q/";

    event VoucherTypeCreated(
        uint256 voucherTypeId,
        uint256 amount,
        uint256 maxPerUser,
        string tokenURI
    );
    event VoucherTypeUpdated(
        uint256 voucherTypeId,
        uint256 amount,
        uint256 maxPerUser,
        string tokenURI
    );
    event VoucherMinted(
        uint256 tokenId,
        address recipient,
        uint256 voucherTypeId
    );
    /// @param totalAmount Total points minted, in 18-decimal token units.
    /// @param additionalReward Membership reward, in 18-decimal token units.
    event VoucherTotalRedeemed(
        uint256[] tokenIds,
        address redeemer,
        uint256 totalAmount,
        uint256 additionalReward
    );
    event VoucherTransferred(address from, address to, uint256 tokenId);
    event MembershipLevelCreated(
        uint256 levelIndex,
        string name,
        uint256 threshold,
        string membershipTokenURI,
        uint256 rewardBasisPoints
    );
    event MembershipLevelUpdated(
        uint256 levelIndex,
        uint256 threshold,
        string membershipTokenURI,
        uint256 rewardBasisPoints
    );
    event MembershipUpgraded(
        address user,
        uint256 tokenId,
        uint256 level,
        string levelName
    );
    event MembershipNFTBurned(address user, uint256 tokenId);
    event MembershipExpired(address user, uint256 tokenId);
    event MembershipTransferred(
        address from,
        address to,
        uint256 tokenId,
        string levelName
    );
    event MembershipRenewed(
        address user,
        uint256 tokenId,
        uint256 newExpiryDate
    );
    event VouchersIssuedFromSubscription(
        address indexed user,
        uint256[] voucherTypeIds,
        uint256[] amounts,
        uint256 totalAmount
    );
    event LegacyVoucherMigrated(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 indexed voucherTypeId
    );
    event LegacyMembershipMigrated(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 indexed membershipLevel,
        uint256 totalRedeemed,
        uint256 currentRoundRedeemed,
        uint256 lastActiveTimestamp
    );
    event LegacyCollectionCancelled(
        uint256 indexed snapshotBlock,
        bytes32 indexed snapshotRoot,
        uint64 cancelledAt,
        string cancelledTokenURI
    );

    error InvalidAddress();
    error InvalidMembershipLevel();
    error InvalidMembershipThreshold();
    error InvalidRewardBasisPoints();
    error VoucherNonTransferable();
    error LegacyCollectionCancelledOperation();
    error LegacyCollectionAlreadyCancelled();
    error InvalidLegacyCancellationSnapshot();

    modifier whenLegacyCollectionActive() {
        if (legacyCollectionCancelled) {
            revert LegacyCollectionCancelledOperation();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address rewardTokenAddress,
        address defaultAdmin,
        address minter
    ) public initializer {
        if (
            rewardTokenAddress == address(0) ||
            defaultAdmin == address(0) ||
            minter == address(0)
        ) revert InvalidAddress();

        __ERC721_init("DOUDOCOINNFT", "DOUDO");
        __ERC721Enumerable_init();
        __ERC721Burnable_init();
        __MinimalAccessControl_init(defaultAdmin);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        membershipExpirationPeriod = 180 days;
        rewardToken = IDoudoPoints(rewardTokenAddress);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(UPGRADER_ROLE, defaultAdmin);
        _grantRole(MIGRATOR_ROLE, defaultAdmin);

        // Add a "No Membership" level
        _addMembershipLevel("NonMembership", 0, "", 0);

        _addMembershipLevel(
            "Common",
            1,
            string.concat(MEMBERSHIP_METADATA_BASE, "common.json"),
            0
        );

        // Now add the other levels
        _addMembershipLevel(
            "Silver",
            9000 ether,
            string.concat(MEMBERSHIP_METADATA_BASE, "sliver.json"),
            25
        ); // 0.25% additional reward (25 basis points)
        _addMembershipLevel(
            "Gold",
            48000 ether,
            string.concat(MEMBERSHIP_METADATA_BASE, "gold.json"),
            75
        ); // 0.75% additional reward (75 basis points)
        _addMembershipLevel(
            "Platinum",
            90000 ether,
            string.concat(MEMBERSHIP_METADATA_BASE, "Platinum.json"),
            150
        ); // 1.5% additional reward (150 basis points)
        _addMembershipLevel(
            "Emerald",
            180000 ether,
            "https://lime-basic-thrush-351.mypinata.cloud/ipfs/bafybeifydnzvcfadln226n63fqow3xrlhqhrbmvuphokyysgzkhcnsxvwe/Emerald.json",
            250
        ); // 2.5% additional reward (250 basis points)
    }

    // Admin function to create a new voucher type with specific amount, purchase limit, and tokenURI
    function createVoucherType(
        uint256 amount,
        uint256 maxPerUser,
        string memory _tokenURI
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenLegacyCollectionActive {
        voucherTypes[nextVoucherTypeId] = VoucherType(
            amount,
            maxPerUser,
            _tokenURI
        );
        emit VoucherTypeCreated(
            nextVoucherTypeId,
            amount,
            maxPerUser,
            _tokenURI
        );
        nextVoucherTypeId++;
    }

    function updateVoucherType(
        uint256 voucherTypeId,
        uint256 amount,
        uint256 maxPerUser,
        string memory _tokenURI
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenLegacyCollectionActive {
        voucherTypes[voucherTypeId] = VoucherType(
            amount,
            maxPerUser,
            _tokenURI
        );
        emit VoucherTypeUpdated(voucherTypeId, amount, maxPerUser, _tokenURI);
    }

    // Override the tokenURI function to return the specific URI for each voucher type or membership level
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireMinted(tokenId);
        if (legacyCollectionCancelled) return legacyCancelledTokenURI;
        if (isMembershipNFT[tokenId]) {
            uint256 membershipLevel = userInfo[ownerOf(tokenId)].membershipLevel;
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
    ) public onlyRole(MINTER_ROLE) whenLegacyCollectionActive nonReentrant {
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
            updateUserVoucherCount(to, voucherTypeId, quantity);

            for (uint256 j = 0; j < quantity; j++) {
                _tokenIds.increment();
                uint256 tokenId = _tokenIds.current();
                voucherTypeIds[tokenId] = voucherTypeId;
                _safeMint(to, tokenId);
                emit VoucherMinted(tokenId, to, voucherTypeId);
            }
        }
    }

    // 鑄造會員 NFT 的函數
    function mintMembershipNFT(
        address to,
        uint256 membershipLevel
    ) public onlyRole(MINTER_ROLE) whenLegacyCollectionActive nonReentrant {
        require(
            userInfo[to].membershipNFT == 0,
            "User already owns a membership NFT"
        );
        require(
            membershipLevel < membershipLevels.length,
            "Invalid membership level"
        );

        // 更新用戶的累積消費金額為該等級的門檻
        uint256 requiredThreshold = membershipLevels[membershipLevel].threshold;
        userInfo[to].currentRoundRedeemed = requiredThreshold;
        userInfo[to].totalRedeemed = requiredThreshold;
        userInfo[to].lastActiveTimestamp = block.timestamp; // 設置最後活動時間

        _tokenIds.increment();
        uint256 tokenId = _tokenIds.current();
        isMembershipNFT[tokenId] = true;
        userInfo[to].membershipNFT = tokenId;
        userInfo[to].membershipLevel = membershipLevel;
        _safeMint(to, tokenId);

        emit MembershipUpgraded(
            to,
            tokenId,
            membershipLevel,
            membershipLevels[membershipLevel].name
        );
    }

    function migrateLegacyVoucher(
        address to,
        uint256 tokenId,
        uint256 voucherTypeId
    ) external onlyRole(MIGRATOR_ROLE) whenLegacyCollectionActive nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        require(voucherTypeId < nextVoucherTypeId, "Invalid voucher type");
        _advanceTokenId(tokenId);
        voucherTypeIds[tokenId] = voucherTypeId;
        userVoucherCounts[to][voucherTypeId] += 1;
        _safeMint(to, tokenId);
        emit LegacyVoucherMigrated(tokenId, to, voucherTypeId);
    }

    function migrateLegacyMembership(
        address to,
        uint256 tokenId,
        uint256 totalRedeemed,
        uint256 currentRoundRedeemed,
        uint256 membershipLevel,
        uint256 lastActiveTimestamp
    ) external onlyRole(MIGRATOR_ROLE) whenLegacyCollectionActive nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (
            membershipLevel == 0 ||
            membershipLevel >= membershipLevels.length
        ) revert InvalidMembershipLevel();
        require(
            userInfo[to].membershipNFT == 0,
            "User already owns a membership NFT"
        );
        _advanceTokenId(tokenId);
        userInfo[to] = UserInfo({
            totalRedeemed: totalRedeemed,
            currentRoundRedeemed: currentRoundRedeemed,
            membershipLevel: membershipLevel,
            membershipNFT: tokenId,
            lastActiveTimestamp: lastActiveTimestamp
        });
        isMembershipNFT[tokenId] = true;
        _safeMint(to, tokenId);
        emit LegacyMembershipMigrated(
            tokenId,
            to,
            membershipLevel,
            totalRedeemed,
            currentRoundRedeemed,
            lastActiveTimestamp
        );
    }

    function _advanceTokenId(uint256 targetTokenId) internal {
        require(targetTokenId > _tokenIds.current(), "Token ID not increasing");
        while (_tokenIds.current() < targetTokenId) {
            _tokenIds.increment();
        }
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

    // Reconcile membership state after safe transfers. Voucher transfers are
    // rejected centrally in _beforeTokenTransfer.
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory _data
    )
        public
        override(ERC721Upgradeable, IERC721Upgradeable)
        whenLegacyCollectionActive
        nonReentrant
    {
        bool membershipToken = isMembershipNFT[tokenId];
        super.transferFrom(from, to, tokenId);

        if (membershipToken) {
            _transferMembership(from, to, tokenId);
        }

        // Membership reconciliation can replace or burn tokenId. Only notify the
        // receiver when this exact token still belongs to it.
        if (_exists(tokenId)) {
            require(
                ownerOf(tokenId) == to &&
                    _checkOnERC721ReceivedAfterState(
                        _msgSender(),
                        from,
                        to,
                        tokenId,
                        _data
                    ),
                "ERC721: transfer to non ERC721Receiver implementer"
            );
        }
    }

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    )
        public
        virtual
        override(ERC721Upgradeable, IERC721Upgradeable)
        whenLegacyCollectionActive
        nonReentrant
    {
        // 保存原始的 packed ownership 數據
        require(
            ownerOf(tokenId) == from,
            "ERC721: transfer from incorrect owner"
        );

        // 調用原始的 transferFrom 邏輯
        super.transferFrom(from, to, tokenId);

        // Voucher transfers revert in _beforeTokenTransfer, so only membership
        // tokens can reach the reconciliation path below.
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
        require(
            userInfo[from].membershipNFT == tokenId,
            "Membership state mismatch"
        );

        if (from == to) {
            emit MembershipTransferred(
                from,
                to,
                tokenId,
                membershipLevels[userInfo[to].membershipLevel].name
            );
            return;
        }

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
        userInfo[from].totalRedeemed = 0;
        userInfo[from].currentRoundRedeemed = 0;
        userInfo[from].lastActiveTimestamp = 0;

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
    function burnVouchersBatch(
        uint256[] calldata tokenIds
    ) external whenLegacyCollectionActive nonReentrant {
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
        }

        // Convert voucher face values to token units before calculating the
        // membership reward so fractional DOUDO rewards are preserved.
        uint256 currentLevel = userInfo[msg.sender].membershipLevel;
        uint256 baseAmount = totalAmount * 1 ether;
        uint256 additionalReward = Math.mulDiv(
            baseAmount,
            membershipLevels[currentLevel].rewardBasisPoints,
            10000
        );
        totalAmount = baseAmount + additionalReward;

        emit VoucherTotalRedeemed(
            tokenIds,
            msg.sender,
            totalAmount,
            additionalReward
        );

        // Update the user's total redeemed amount, current round redeemed amount, and last activity timestamp
        userInfo[msg.sender].totalRedeemed += totalAmount;
        userInfo[msg.sender].currentRoundRedeemed += totalAmount; // Track current round redemption
        userInfo[msg.sender].lastActiveTimestamp = block.timestamp;

        // Check if membership level should be upgraded
        _updateMembershipLevel(msg.sender);

        // Interact with the reward contract only after redemption and membership
        // state have been fully initialized.
        require(
            rewardToken.mintWithReason(msg.sender, totalAmount, VOUCHER_REDEEM),
            "Token minting failed"
        );
    }

    // Internal function to update membership level and handle NFT minting/burning
    function _updateMembershipLevel(address user) internal {
        uint256 currentRoundRedeemed = userInfo[user].currentRoundRedeemed;
        uint256 currentLevel = userInfo[user].membershipLevel;
        uint256 newLevel = currentLevel;

        // 從最高等級開始檢查
        for (uint256 i = membershipLevels.length - 1; i >= 1; i--) {
            if (currentRoundRedeemed >= membershipLevels[i].threshold) {
                newLevel = i;
                break;
            }
        }

        // 只在等級真正改變時更新
        if (newLevel != currentLevel) {
            // 處理舊的 NFT
            uint256 oldMembershipNFT = userInfo[user].membershipNFT;
            if (oldMembershipNFT != 0) {
                _burn(oldMembershipNFT);
                delete isMembershipNFT[oldMembershipNFT];
                userInfo[user].membershipNFT = 0;
                emit MembershipNFTBurned(user, oldMembershipNFT);
            }

            // 只有在新等級 >= 1 時才鑄造 NFT
            if (newLevel >= 1) {
                _tokenIds.increment();
                uint256 tokenId = _tokenIds.current();
                userInfo[user].membershipNFT = tokenId;
                isMembershipNFT[tokenId] = true;
                userInfo[user].membershipLevel = newLevel;
                _safeMint(user, tokenId);

                emit MembershipUpgraded(
                    user,
                    tokenId, // 新的 NFT ID
                    newLevel, // 新等級
                    membershipLevels[newLevel].name // 等級名稱
                );
            }

            userInfo[user].membershipLevel = newLevel;
        }
    }

    // Check if a user's membership has expired
    function _checkMembershipExpiration(address user) internal {
        uint256 lastActive = userInfo[user].lastActiveTimestamp;
        uint256 tokenId = userInfo[user].membershipNFT;

        // 如果是第一次活動，直接返回，不檢查過期
        if (lastActive == 0) {
            return;
        }

        // 只有非首次用戶才檢查過期時間
        if (block.timestamp > lastActive + membershipExpirationPeriod) {
            // Membership expired, burn the membership NFT and reset the membership level
            if (userInfo[user].membershipNFT != 0) {
                _burn(userInfo[user].membershipNFT);
                delete isMembershipNFT[userInfo[user].membershipNFT];
                emit MembershipNFTBurned(user, userInfo[user].membershipNFT);
                userInfo[user].membershipNFT = 0;
            }
            userInfo[user].membershipLevel = 0; // Reset membership level to default
            userInfo[user].currentRoundRedeemed = 0; // Reset current round redeemed
            emit MembershipExpired(user, tokenId);
        }
    }

    // Admin function to update the membership expiration period
    function setMembershipExpirationPeriod(
        uint256 newExpirationPeriod
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenLegacyCollectionActive {
        membershipExpirationPeriod = newExpirationPeriod;
    }

    // Admin function to add a new membership level
    function addMembershipLevel(
        string memory name,
        uint256 threshold,
        string memory _membershipTokenURI,
        uint256 rewardBasisPoints
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenLegacyCollectionActive {
        _addMembershipLevel(
            name,
            threshold,
            _membershipTokenURI,
            rewardBasisPoints
        );
    }

    // Admin function to update threshold, tokenURI, and reward basis points of an existing membership level
    function updateMembershipLevel(
        uint256 levelIndex,
        uint256 newThreshold,
        string memory newTokenURI,
        uint256 newRewardBasisPoints
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenLegacyCollectionActive {
        _setMembershipLevel(
            levelIndex,
            newThreshold,
            newTokenURI,
            newRewardBasisPoints
        );
    }

    function setMembershipLevelConfig(
        uint256 levelIndex,
        uint256 newThreshold,
        uint256 newRewardBasisPoints
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenLegacyCollectionActive {
        if (levelIndex >= membershipLevels.length) {
            revert InvalidMembershipLevel();
        }
        _setMembershipLevel(
            levelIndex,
            newThreshold,
            membershipLevels[levelIndex].membershipTokenURI,
            newRewardBasisPoints
        );
    }

    function _setMembershipLevel(
        uint256 levelIndex,
        uint256 newThreshold,
        string memory newTokenURI,
        uint256 newRewardBasisPoints
    ) internal {
        _validateMembershipLevelConfig(
            levelIndex,
            newThreshold,
            newRewardBasisPoints
        );
        membershipLevels[levelIndex].threshold = newThreshold;
        membershipLevels[levelIndex].membershipTokenURI = newTokenURI;
        membershipLevels[levelIndex].rewardBasisPoints = newRewardBasisPoints;
        emit MembershipLevelUpdated(
            levelIndex,
            newThreshold,
            newTokenURI,
            newRewardBasisPoints
        );
    }

    // Internal function to add a new membership level
    function _addMembershipLevel(
        string memory name,
        uint256 threshold,
        string memory _membershipTokenURI,
        uint256 rewardBasisPoints
    ) internal {
        uint256 levelIndex = membershipLevels.length;
        if (rewardBasisPoints > 10000) revert InvalidRewardBasisPoints();
        if (levelIndex == 0) {
            if (threshold != 0) revert InvalidMembershipThreshold();
        } else if (
            threshold <= membershipLevels[levelIndex - 1].threshold
        ) {
            revert InvalidMembershipThreshold();
        }
        membershipLevels.push(
            MembershipLevel(
                name,
                threshold,
                _membershipTokenURI,
                rewardBasisPoints
            )
        );
        emit MembershipLevelCreated(
            membershipLevels.length - 1,
            name,
            threshold,
            _membershipTokenURI,
            rewardBasisPoints
        );
    }

    // Admin function to set the token reward contract
    function setRewardToken(
        address _rewardToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenLegacyCollectionActive {
        if (_rewardToken == address(0)) revert InvalidAddress();
        rewardToken = IDoudoPoints(_rewardToken);
    }

    function _validateMembershipLevelConfig(
        uint256 levelIndex,
        uint256 threshold,
        uint256 rewardBasisPoints
    ) internal view {
        if (levelIndex >= membershipLevels.length) {
            revert InvalidMembershipLevel();
        }
        if (rewardBasisPoints > 10000) revert InvalidRewardBasisPoints();
        if (levelIndex == 0) {
            if (threshold != 0) revert InvalidMembershipThreshold();
            return;
        }
        if (threshold <= membershipLevels[levelIndex - 1].threshold) {
            revert InvalidMembershipThreshold();
        }
        if (
            levelIndex + 1 < membershipLevels.length &&
            threshold >= membershipLevels[levelIndex + 1].threshold
        ) {
            revert InvalidMembershipThreshold();
        }
    }

    // Function for subscription contract to mint multiple types of vouchers for users
    function mintVouchersFromSubscription(
        address user,
        uint256[] calldata _voucherTypeIds,
        uint256[] calldata amounts
    ) external onlyRole(MINTER_ROLE) whenLegacyCollectionActive {
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

    function burn(
        uint256 tokenId
    ) public override whenLegacyCollectionActive nonReentrant {
        require(!isMembershipNFT[tokenId], "Cannot burn membership NFTs");
        super.burn(tokenId);
        delete voucherTypeIds[tokenId];
    }

    function _handleLowerLevelNFT(address owner, uint256 tokenId) internal {
        // 這裡可以選擇銷毀 NFT 或將其轉移到一個特定地址
        // 例如：
        _burn(tokenId);
        delete isMembershipNFT[tokenId];
        emit MembershipNFTBurned(owner, tokenId);
    }

    function _checkOnERC721ReceivedAfterState(
        address operator,
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) private returns (bool) {
        if (to.code.length == 0) return true;

        try
            IERC721Receiver(to).onERC721Received(
                operator,
                from,
                tokenId,
                data
            )
        returns (bytes4 retval) {
            return retval == IERC721Receiver.onERC721Received.selector;
        } catch (bytes memory reason) {
            if (reason.length == 0) {
                revert("ERC721: transfer to non ERC721Receiver implementer");
            }
            assembly {
                revert(add(32, reason), mload(reason))
            }
        }
    }

    function cancelLegacyCollection(
        uint256 snapshotBlock,
        bytes32 snapshotRoot,
        string calldata cancelledTokenURI
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (legacyCollectionCancelled) revert LegacyCollectionAlreadyCancelled();
        if (
            snapshotBlock == 0 ||
            snapshotBlock > block.number ||
            snapshotRoot == bytes32(0) ||
            bytes(cancelledTokenURI).length == 0
        ) revert InvalidLegacyCancellationSnapshot();

        legacyCollectionCancelled = true;
        legacyCollectionCancelledAt = uint64(block.timestamp);
        legacyCancellationSnapshotBlock = snapshotBlock;
        legacyCancellationSnapshotRoot = snapshotRoot;
        legacyCancelledTokenURI = cancelledTokenURI;
        emit LegacyCollectionCancelled(
            snapshotBlock,
            snapshotRoot,
            legacyCollectionCancelledAt,
            cancelledTokenURI
        );
    }

    function approve(
        address to,
        uint256 tokenId
    )
        public
        override(ERC721Upgradeable, IERC721Upgradeable)
        whenLegacyCollectionActive
    {
        super.approve(to, tokenId);
    }

    function setApprovalForAll(
        address operator,
        bool approved
    )
        public
        override(ERC721Upgradeable, IERC721Upgradeable)
        whenLegacyCollectionActive
    {
        super.setApprovalForAll(operator, approved);
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
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
        returns (bool)
    {
        return
            interfaceId == type(IAccessControlUpgradeable).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        if (legacyCollectionCancelled) {
            revert LegacyCollectionCancelledOperation();
        }
        if (
            from != address(0) &&
            to != address(0) &&
            !isMembershipNFT[tokenId]
        ) {
            revert VoucherNonTransferable();
        }
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyRole(UPGRADER_ROLE) {}

    bool public legacyCollectionCancelled;
    uint64 public legacyCollectionCancelledAt;
    uint256 public legacyCancellationSnapshotBlock;
    bytes32 public legacyCancellationSnapshotRoot;
    string public legacyCancelledTokenURI;

    uint256[46] private __gap;
}
