// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IStaking {
    function deposit(uint256) external;

    function withdraw(uint256) external;

    function emergencyWithdraw() external;

    function userInfo(address)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        );

    function pendingRewards(address) external view returns (uint256);
}
