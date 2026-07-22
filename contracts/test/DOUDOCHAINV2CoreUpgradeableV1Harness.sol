// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";
import "../access/MinimalAccessControlUpgradeable.sol";
import "../interfaces/IDoudoPoints.sol";
import "../interfaces/IDoudoVRFCallback.sol";
import "../interfaces/IDoudoVRFRouter.sol";
import "../security/LightweightGuardsUpgradeable.sol";

contract DOUDOCHAINV2CoreUpgradeableV1Harness is
    Initializable,
    ERC721AUpgradeable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    LightweightGuardsUpgradeable,
    IDoudoVRFCallback
{
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant ADMINMINT_ROLE = keccak256("ADMINMINT_ROLE");
    bytes32 public constant MODULE_ROLE = keccak256("MODULE_ROLE");
    bytes32 public constant VRF_ROUTER_ROLE = keccak256("VRF_ROUTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    enum RequestKind {
        None,
        Reveal,
        LastPrize
    }

    struct SubPrize {
        uint256 subPrizeID;
        string prizeGroup;
        string subPrizeName;
        uint256 subPrizeRemainingQuantity;
    }

    struct Series {
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 remainingTicketNumbers;
        uint256 priceInPoints;
        bool isGoodsArrived;
        uint256 estimateDeliverTime;
        uint256 exchangeExpireTime;
        string exchangeTokenURI;
        string unrevealTokenURI;
        string revealTokenURI;
        string seriesMetaDataURI;
        uint256 priceInTWD;
        bool isRefund;
        bool isPreOrder;
        bool useLuckyNumber;
        uint256 maxPerWallet;
    }

    struct TicketStatus {
        uint256 seriesID;
        uint256 tokenRevealedPrize;
        bool tokenExchange;
        bool tokenRevealed;
        uint16 luckyNumber;
    }

    struct TokenRange {
        uint256 start;
        uint256 end;
    }

    IDoudoPoints public doudoPoints;
    address public vrfRouter;
    uint256 public defaultLockDuration;

    mapping(uint256 => Series) private seriesData;
    mapping(uint256 => SubPrize[]) private seriesSubPrizes;
    mapping(uint256 => TicketStatus) public ticketStatusDetail;
    mapping(uint256 => mapping(uint16 => bool)) public luckyNumberUsed;
    mapping(uint256 => mapping(address => uint256)) public mintedPerWallet;
    mapping(uint256 => address) public mintLockOwner;
    mapping(uint256 => uint256) public mintLockUntil;
    mapping(uint256 => uint256) public pointsPaid;
    mapping(uint256 => TokenRange[]) public seriesRanges;
    mapping(uint256 => uint256) public totalMintedInSeries;
    mapping(uint256 => RequestKind) public requestKind;
    mapping(uint256 => uint256[]) public requestToRevealToken;
    mapping(uint256 => uint256) public requestToSeries;
    mapping(uint256 => address[]) public lastPrizeOwners;
    mapping(uint256 => bool) public lastPrizeRequestPending;
    mapping(uint256 => mapping(address => uint256)) public seriesUnlockUntil;

    uint256 private seriesCounter;

    error InvalidConfig();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address doudoPointsAddress,
        address vrfRouter_
    ) public initializerERC721A initializer {
        if (doudoPointsAddress == address(0) || vrfRouter_ == address(0)) {
            revert InvalidConfig();
        }

        __ERC721A_init("DOUDOCHAINV2", "DOUDOV2");
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(msg.sender);
        __LightweightGuards_init();

        doudoPoints = IDoudoPoints(doudoPointsAddress);
        vrfRouter = vrfRouter_;
        defaultLockDuration = 900;

        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
        _grantRole(ADMINMINT_ROLE, msg.sender);
    }

    function seedForUpgrade(address user, address lastPrizeOwner) external onlyRole(OPERATION_ROLE) {
        seriesData[0] = Series({
            seriesName: "Old Upgrade Series",
            totalTicketNumbers: 10,
            remainingTicketNumbers: 9,
            priceInPoints: 1 ether,
            isGoodsArrived: true,
            estimateDeliverTime: 1_780_000_000,
            exchangeExpireTime: 1_780_000_000 + 60 days,
            exchangeTokenURI: "ipfs://old-exchange/",
            unrevealTokenURI: "ipfs://old-unreveal",
            revealTokenURI: "ipfs://old-reveal/",
            seriesMetaDataURI: "ipfs://old-series",
            priceInTWD: 100,
            isRefund: false,
            isPreOrder: false,
            useLuckyNumber: true,
            maxPerWallet: 2
        });
        seriesSubPrizes[0].push(SubPrize({
            subPrizeID: 1,
            prizeGroup: "A",
            subPrizeName: "A1",
            subPrizeRemainingQuantity: 10
        }));

        _safeMint(user, 1);
        ticketStatusDetail[0] = TicketStatus({
            seriesID: 0,
            tokenRevealedPrize: 0,
            tokenExchange: false,
            tokenRevealed: false,
            luckyNumber: 7
        });
        luckyNumberUsed[0][7] = true;
        mintedPerWallet[0][user] = 1;
        mintLockOwner[0] = user;
        mintLockUntil[0] = block.timestamp + 1 days;
        pointsPaid[0] = 1 ether;
        seriesRanges[0].push(TokenRange({start: 0, end: 0}));
        totalMintedInSeries[0] = 1;
        requestKind[88] = RequestKind.Reveal;
        requestToRevealToken[88].push(0);
        requestToSeries[88] = 0;
        lastPrizeOwners[0].push(lastPrizeOwner);
        seriesUnlockUntil[0][user] = block.timestamp + 30 days;
        seriesCounter = 1;
    }

    function fulfillRandomWordsFromRouter(uint256, uint256[] calldata) external override {}

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[40] private __gap;
}
