// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract FakeUSDT is ERC20, Ownable, ERC20Permit {

    constructor()
        ERC20("FakeERC20", "FakeERC20")
        ERC20Permit("FakeERC20")
    {
        _mint(msg.sender, 1000000000000000000 * 10 ** decimals());
    }


    // Overriding the decimals function to return 6 instead of the default 18
    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}