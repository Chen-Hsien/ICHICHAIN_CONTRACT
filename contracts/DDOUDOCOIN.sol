// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IDoudoPoints.sol";

contract DOUDOCOIN is ERC20, AccessControl, IDoudoPoints {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REASON_UNSPECIFIED = keccak256("UNSPECIFIED");

    error NonTransferable();

    event PointsMinted(
        address indexed to,
        uint256 amount,
        bytes32 indexed reason,
        address indexed operator
    );
    event PointsBurned(
        address indexed from,
        uint256 amount,
        bytes32 indexed reason,
        address indexed operator
    );

    constructor(address defaultAdmin, address minter) ERC20("DOUDOCOIN", "DOUDO") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, minter);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) returns (bool) {
        return mintWithReason(to, amount, REASON_UNSPECIFIED);
    }

    function mintWithReason(
        address to,
        uint256 amount,
        bytes32 reason
    ) public onlyRole(MINTER_ROLE) returns (bool) {
        _mint(to, amount);
        emit PointsMinted(to, amount, reason, msg.sender);
        return true;
    }

    function burnFrom(address account, uint256 amount) external onlyRole(BURNER_ROLE) {
        burnFromWithReason(account, amount, REASON_UNSPECIFIED);
    }

    function burnFromWithReason(
        address account,
        uint256 amount,
        bytes32 reason
    ) public onlyRole(BURNER_ROLE) {
        _burn(account, amount);
        emit PointsBurned(account, amount, reason, msg.sender);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from != address(0) && to != address(0)) {
            revert NonTransferable();
        }
        super._beforeTokenTransfer(from, to, amount);
    }
}
