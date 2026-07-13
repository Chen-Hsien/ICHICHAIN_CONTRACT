// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./interfaces/IDoudoPoints.sol";
import "./interfaces/IDoudoPrizeSource.sol";
import "./security/LightweightGuardsUpgradeable.sol";

interface IDoudochainV2CollectionRewardsUpgradeable {
    function mintCollectionReward(address to, uint256 rewardData) external returns (uint256);
    function unlockSeriesFor(address user, uint256 seriesID) external;
}

contract CollectionBookUpgradeable is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable,
    IERC721Receiver
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    enum RewardKind {
        NftPrize,
        Points,
        UnlockSeries
    }

    struct Slot {
        address sourceContract;
        uint256 seriesID;
        uint256 prizeId;
        uint32 quantity;
    }

    struct Book {
        string name;
        RewardKind rewardKind;
        uint256 rewardData;
        bool active;
    }

    IDoudoPoints public doudoPoints;
    address public doudochainV2RewardTarget;

    uint256 private bookCounter;
    mapping(uint256 => Book) public books;
    mapping(uint256 => Slot[]) public bookSlots;
    mapping(uint256 => uint256) public totalRequired;
    mapping(address => mapping(uint256 => uint32)) public filledCount;
    mapping(address => mapping(uint256 => mapping(uint256 => uint32))) public filledPerSlot;
    mapping(address => mapping(uint256 => bool)) public claimed;
    mapping(address => mapping(uint256 => uint256)) public depositedTokenBook;
    mapping(address => mapping(uint256 => uint256)) public depositedTokenSlotPlusOne;
    mapping(address => mapping(uint256 => address)) public depositedTokenOwner;

    error InvalidBookDefinition();
    error BookDoesNotExist();
    error BookInactive();
    error BookAlreadyClaimed();
    error TokenDoesNotMatchAnyOpenSlot();
    error TokenNotRevealed();
    error TokenAlreadyExchanged();
    error CannotWithdrawAfterClaim();
    error TokenNotDeposited();
    error TokenDepositedByAnotherUser();
    error BookIncomplete();
    error RewardTargetMissing();
    error UnexpectedERC721Transfer();
    error TrackedERC721();

    event CollectionBookCreated(
        uint256 indexed bookId,
        string name,
        RewardKind rewardKind,
        uint256 rewardData,
        bool active
    );
    event CollectionBookSlotDefined(
        uint256 indexed bookId,
        uint256 indexed slotIndex,
        address indexed sourceContract,
        uint256 seriesID,
        uint256 prizeId,
        uint32 quantity
    );
    event CollectionBookStatusUpdated(uint256 indexed bookId, bool active);
    event CollectionBookRewardTargetUpdated(address doudochainV2RewardTarget);
    event CollectionBookSlotFilled(
        address indexed user,
        uint256 indexed bookId,
        uint256 indexed slotIndex,
        address sourceContract,
        uint256 tokenId,
        uint32 newFilledCount
    );
    event CollectionBookSlotEmptied(
        address indexed user,
        uint256 indexed bookId,
        uint256 indexed slotIndex,
        address sourceContract,
        uint256 tokenId,
        uint32 newFilledCount
    );
    event CollectionBookClaimed(address indexed user, uint256 indexed bookId, RewardKind rewardKind, uint256 rewardData);
    event UntrackedERC721Recovered(
        address indexed sourceContract,
        uint256 indexed tokenId,
        address indexed recipient
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address doudoPointsAddress) public initializer {
        if (doudoPointsAddress == address(0)) revert InvalidBookDefinition();
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(msg.sender);
        __LightweightGuards_init();

        doudoPoints = IDoudoPoints(doudoPointsAddress);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
    }

    function createBook(
        string calldata name,
        Slot[] calldata slots,
        RewardKind rewardKind,
        uint256 rewardData,
        bool active
    ) external onlyRole(OPERATION_ROLE) returns (uint256 bookId) {
        if (bytes(name).length == 0 || slots.length == 0) revert InvalidBookDefinition();
        bookId = bookCounter++;
        books[bookId] = Book({
            name: name,
            rewardKind: rewardKind,
            rewardData: rewardData,
            active: active
        });

        uint256 required;
        for (uint256 i = 0; i < slots.length; i++) {
            if (slots[i].sourceContract == address(0) || slots[i].quantity == 0) {
                revert InvalidBookDefinition();
            }
            bookSlots[bookId].push(slots[i]);
            required += slots[i].quantity;
            emit CollectionBookSlotDefined(
                bookId,
                i,
                slots[i].sourceContract,
                slots[i].seriesID,
                slots[i].prizeId,
                slots[i].quantity
            );
        }
        totalRequired[bookId] = required;
        emit CollectionBookCreated(bookId, name, rewardKind, rewardData, active);
    }

    function setBookActive(uint256 bookId, bool active) external onlyRole(OPERATION_ROLE) {
        if (totalRequired[bookId] == 0) revert InvalidBookDefinition();
        books[bookId].active = active;
        emit CollectionBookStatusUpdated(bookId, active);
    }

    function setDoudochainV2RewardTarget(address doudochainV2RewardTarget_) external onlyRole(OPERATION_ROLE) {
        doudochainV2RewardTarget = doudochainV2RewardTarget_;
        emit CollectionBookRewardTargetUpdated(doudochainV2RewardTarget_);
    }

    function depositToBook(uint256 bookId, uint256[] calldata tokenIds) external nonReentrant {
        Book storage book = books[bookId];
        if (!book.active) revert BookInactive();
        if (claimed[msg.sender][bookId]) revert BookAlreadyClaimed();
        if (tokenIds.length == 0) revert TokenDoesNotMatchAnyOpenSlot();

        for (uint256 i = 0; i < tokenIds.length; i++) {
            _depositOne(bookId, tokenIds[i]);
        }
    }

    function withdrawDeposited(
        uint256 bookId,
        address sourceContract,
        uint256[] calldata tokenIds
    ) external nonReentrant {
        if (claimed[msg.sender][bookId]) revert CannotWithdrawAfterClaim();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _withdrawOne(bookId, sourceContract, tokenIds[i]);
        }
    }

    function recoverUntrackedERC721(
        address sourceContract,
        uint256 tokenId,
        address recipient
    ) external onlyRole(OPERATION_ROLE) nonReentrant {
        if (recipient == address(0) || recipient == address(this)) {
            revert InvalidBookDefinition();
        }
        if (depositedTokenOwner[sourceContract][tokenId] != address(0)) {
            revert TrackedERC721();
        }
        IDoudoPrizeSource source = IDoudoPrizeSource(sourceContract);
        if (!_isOwnedBy(source, tokenId, address(this))) revert TokenNotDeposited();
        source.safeTransferFrom(address(this), recipient, tokenId);
        emit UntrackedERC721Recovered(sourceContract, tokenId, recipient);
    }

    function claimBook(uint256 bookId) external nonReentrant {
        if (bookId >= bookCounter) revert BookDoesNotExist();
        Book storage book = books[bookId];
        if (claimed[msg.sender][bookId]) revert BookAlreadyClaimed();
        if (filledCount[msg.sender][bookId] != totalRequired[bookId]) revert BookIncomplete();

        claimed[msg.sender][bookId] = true;

        if (book.rewardKind == RewardKind.Points) {
            if (doudochainV2RewardTarget == address(0)) {
                doudoPoints.mintWithReason(msg.sender, book.rewardData, keccak256("COLLECTION_BOOK_REWARD"));
            } else {
                IDoudochainV2CollectionRewardsUpgradeable(doudochainV2RewardTarget).mintCollectionReward(
                    msg.sender,
                    book.rewardData
                );
            }
        } else if (book.rewardKind == RewardKind.NftPrize) {
            if (doudochainV2RewardTarget == address(0)) revert RewardTargetMissing();
            IDoudochainV2CollectionRewardsUpgradeable(doudochainV2RewardTarget).mintCollectionReward(
                msg.sender,
                book.rewardData
            );
        } else if (book.rewardKind == RewardKind.UnlockSeries) {
            if (doudochainV2RewardTarget == address(0)) revert RewardTargetMissing();
            IDoudochainV2CollectionRewardsUpgradeable(doudochainV2RewardTarget).unlockSeriesFor(
                msg.sender,
                book.rewardData
            );
        }

        emit CollectionBookClaimed(msg.sender, bookId, book.rewardKind, book.rewardData);
    }

    function _depositOne(uint256 bookId, uint256 tokenId) internal {
        Slot[] storage slots = bookSlots[bookId];
        for (uint256 slotIndex = 0; slotIndex < slots.length; slotIndex++) {
            Slot storage slot = slots[slotIndex];
            if (filledPerSlot[msg.sender][bookId][slotIndex] >= slot.quantity) continue;
            IDoudoPrizeSource source = IDoudoPrizeSource(slot.sourceContract);
            if (!_isOwnedBy(source, tokenId, msg.sender)) continue;
            (
                uint256 seriesID,
                uint256 prizeId,
                bool tokenExchange,
                bool tokenRevealed
            ) = _readTicket(source, tokenId);
            if (seriesID == slot.seriesID && prizeId == slot.prizeId) {
                if (!tokenRevealed) revert TokenNotRevealed();
                if (tokenExchange) revert TokenAlreadyExchanged();
                source.safeTransferFrom(msg.sender, address(this), tokenId);
                filledPerSlot[msg.sender][bookId][slotIndex] += 1;
                filledCount[msg.sender][bookId] += 1;
                depositedTokenBook[slot.sourceContract][tokenId] = bookId + 1;
                depositedTokenSlotPlusOne[slot.sourceContract][tokenId] = slotIndex + 1;
                depositedTokenOwner[slot.sourceContract][tokenId] = msg.sender;
                emit CollectionBookSlotFilled(
                    msg.sender,
                    bookId,
                    slotIndex,
                    slot.sourceContract,
                    tokenId,
                    filledPerSlot[msg.sender][bookId][slotIndex]
                );
                return;
            }
        }
        revert TokenDoesNotMatchAnyOpenSlot();
    }

    function _withdrawOne(uint256 bookId, address sourceContract, uint256 tokenId) internal {
        if (depositedTokenBook[sourceContract][tokenId] != bookId + 1) revert TokenNotDeposited();
        if (depositedTokenOwner[sourceContract][tokenId] != msg.sender) {
            revert TokenDepositedByAnotherUser();
        }
        uint256 slotIndex = _findFilledSlotForToken(bookId, sourceContract, tokenId);
        depositedTokenBook[sourceContract][tokenId] = 0;
        depositedTokenSlotPlusOne[sourceContract][tokenId] = 0;
        depositedTokenOwner[sourceContract][tokenId] = address(0);
        filledPerSlot[msg.sender][bookId][slotIndex] -= 1;
        filledCount[msg.sender][bookId] -= 1;
        IDoudoPrizeSource(sourceContract).safeTransferFrom(address(this), msg.sender, tokenId);
        emit CollectionBookSlotEmptied(
            msg.sender,
            bookId,
            slotIndex,
            sourceContract,
            tokenId,
            filledPerSlot[msg.sender][bookId][slotIndex]
        );
    }

    function _findFilledSlotForToken(
        uint256 bookId,
        address sourceContract,
        uint256 tokenId
    ) internal view returns (uint256 slotIndex) {
        uint256 slotPlusOne = depositedTokenSlotPlusOne[sourceContract][tokenId];
        if (slotPlusOne == 0) revert TokenNotDeposited();
        slotIndex = slotPlusOne - 1;
        Slot storage slot = bookSlots[bookId][slotIndex];
        if (slot.sourceContract != sourceContract) revert TokenNotDeposited();
    }

    function _isOwnedBy(
        IDoudoPrizeSource source,
        uint256 tokenId,
        address owner
    ) internal view returns (bool) {
        try source.ownerOf(tokenId) returns (address tokenOwner) {
            return tokenOwner == owner;
        } catch {
            return false;
        }
    }

    function _readTicket(
        IDoudoPrizeSource source,
        uint256 tokenId
    )
        internal
        view
        returns (
            uint256 seriesID,
            uint256 prizeId,
            bool tokenExchange,
            bool tokenRevealed
        )
    {
        (seriesID, prizeId, tokenExchange, tokenRevealed, ) = source.ticketStatusDetail(tokenId);
    }

    function onERC721Received(
        address operator,
        address,
        uint256,
        bytes calldata
    ) external view returns (bytes4) {
        if (operator != address(this)) revert UnexpectedERC721Transfer();
        return IERC721Receiver.onERC721Received.selector;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[41] private __gap;
}
