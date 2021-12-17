// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor() ERC20("TestToken", "TTN") {
        _mint(msg.sender, 10000000 ether);
    }

    function mint() external {
        _mint(msg.sender, 10000 ether);
    }
}
