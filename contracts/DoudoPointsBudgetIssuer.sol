// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IDoudoPoints.sol";

contract DoudoPointsBudgetIssuer is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IDoudoPoints public immutable doudoPoints;
    mapping(bytes32 => uint256) public budget;
    mapping(bytes32 => uint256) public issued;

    error BudgetExceeded();
    error InvalidIssue();

    event BudgetSet(bytes32 indexed source, uint256 amount);
    event BudgetedPointsIssued(
        address indexed to,
        uint256 amount,
        bytes32 indexed source,
        address indexed operator
    );

    constructor(address doudoPointsAddress, address admin) {
        if (doudoPointsAddress == address(0) || admin == address(0)) revert InvalidIssue();
        doudoPoints = IDoudoPoints(doudoPointsAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    function setBudget(bytes32 source, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (source == bytes32(0)) revert InvalidIssue();
        if (amount < issued[source]) revert BudgetExceeded();
        budget[source] = amount;
        emit BudgetSet(source, amount);
    }

    function issue(address to, uint256 amount, bytes32 source) external onlyRole(OPERATOR_ROLE) {
        if (to == address(0) || amount == 0 || source == bytes32(0)) revert InvalidIssue();
        uint256 nextIssued = issued[source] + amount;
        if (nextIssued > budget[source]) revert BudgetExceeded();
        issued[source] = nextIssued;
        doudoPoints.mintWithReason(to, amount, source);
        emit BudgetedPointsIssued(to, amount, source, msg.sender);
    }
}
