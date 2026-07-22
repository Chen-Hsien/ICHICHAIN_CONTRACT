// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract MinimalAccessControlUpgradeable is Initializable {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    mapping(bytes32 => mapping(address => bool)) private _roles;

    error MissingRole(bytes32 role, address account);
    error InvalidRoleAccount();
    error CanOnlyRenounceSelf();

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    modifier onlyRole(bytes32 role) {
        _checkRole(role, msg.sender);
        _;
    }

    function __MinimalAccessControl_init(address initialAdmin) internal onlyInitializing {
        if (initialAdmin == address(0)) revert InvalidRoleAccount();
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    function getRoleAdmin(bytes32) public pure returns (bytes32) {
        return DEFAULT_ADMIN_ROLE;
    }

    function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address account) external {
        if (account != msg.sender) revert CanOnlyRenounceSelf();
        _revokeRole(role, account);
    }

    function _checkRole(bytes32 role, address account) internal view {
        if (!hasRole(role, account)) revert MissingRole(role, account);
    }

    function _grantRole(bytes32 role, address account) internal {
        if (account == address(0)) revert InvalidRoleAccount();
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function _revokeRole(bytes32 role, address account) internal {
        if (_roles[role][account]) {
            _roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    uint256[49] private __gap;
}
