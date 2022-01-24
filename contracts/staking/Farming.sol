// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

contract Farming is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 pendingRewards;
        uint256 lastClaim;
    }

    struct PoolInfo {
        IERC20 lpToken;
        uint256 allocPoint;
        uint256 lastRewardBlock;
        uint256 accTokenPerShare;
        uint256 lockupDuration;
    }

    IERC20 public token;
    uint256 public tokenPerBlock;

    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    uint256 public totalAllocPoint;
    uint256 public startBlock;

    mapping(address => bool) private isLPPoolAdded;

    // 5% fee when users withdraw within 3 days
    uint256 public emergencyWithdrawFee;
    uint256 public constant FEE_MULTIPLIER = 10000;
    address public treasury;

    uint256 public constant SHARE_MULTIPLIER = 1e12;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Claim(address indexed user, uint256 indexed pid, uint256 amount);
    event RewardPerBlockChanged(uint256 reward);
    event Pause();
    event Unpause();

    function initialize(
        IERC20 _token,
        uint256 _tokenPerBlock,
        uint256 _startBlock,
        address _treasury
    ) public initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __ReentrancyGuard_init_unchained();
        __Pausable_init_unchained();

        require(address(_token) != address(0), "Invalid token address!");
        require(address(_treasury) != address(0), "Invalid treasury address!");

        token = _token;
        tokenPerBlock = _tokenPerBlock;
        startBlock = _startBlock;
        treasury = _treasury;

        emergencyWithdrawFee = 500; // 5%

        emit RewardPerBlockChanged(_tokenPerBlock);
    }

    modifier validatePoolByPid(uint256 _pid) {
        require(_pid < poolInfo.length, "Pool does not exist");
        _;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function getMultiplier(uint256 _from, uint256 _to) public pure returns (uint256) {
        return _to - (_from);
    }

    function pendingToken(uint256 _pid, address _user) external view validatePoolByPid(_pid) returns (uint256) {
        require(_user != address(0), "Invalid address!");

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accTokenPerShare = pool.accTokenPerShare;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
            uint256 tokenReward = (multiplier * (tokenPerBlock) * (pool.allocPoint)) / (totalAllocPoint);
            accTokenPerShare = accTokenPerShare + ((tokenReward * (SHARE_MULTIPLIER)) / (lpSupply));
        }
        return (user.amount * (accTokenPerShare)) / (SHARE_MULTIPLIER) - (user.rewardDebt) + (user.pendingRewards);
    }

    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    function updatePool(uint256 _pid) public validatePoolByPid(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
        uint256 tokenReward = (multiplier * (tokenPerBlock) * (pool.allocPoint)) / (totalAllocPoint);
        pool.accTokenPerShare = pool.accTokenPerShare + ((tokenReward * (SHARE_MULTIPLIER)) / (lpSupply));
        pool.lastRewardBlock = block.number;
    }

    function deposit(uint256 _pid, uint256 _amount) external nonReentrant whenNotPaused validatePoolByPid(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = (user.amount * (pool.accTokenPerShare)) / (SHARE_MULTIPLIER) - (user.rewardDebt);

            if (pending > 0) {
                user.pendingRewards = user.pendingRewards + pending;
                uint256 claimedAmount = safeTokenTransfer(msg.sender, user.pendingRewards);
                emit Claim(msg.sender, _pid, claimedAmount);
                user.pendingRewards -= claimedAmount;
            }
        }
        if (_amount > 0) {
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.amount = user.amount + (_amount);
            user.lastClaim = block.timestamp;
        }
        user.rewardDebt = (user.amount * (pool.accTokenPerShare)) / (SHARE_MULTIPLIER);
        emit Deposit(msg.sender, _pid, _amount);
    }

    function withdraw(uint256 _pid, uint256 _amount) external nonReentrant whenNotPaused validatePoolByPid(_pid) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        require(user.amount >= _amount, "withdraw: not good");

        uint256 feeAmount;
        if (block.timestamp < user.lastClaim + pool.lockupDuration) {
            feeAmount = (_amount * emergencyWithdrawFee) / FEE_MULTIPLIER;
        }

        updatePool(_pid);

        uint256 pending = (user.amount * (pool.accTokenPerShare)) / (SHARE_MULTIPLIER) - (user.rewardDebt);
        if (pending > 0) {
            user.pendingRewards = user.pendingRewards + pending;
            uint256 claimedAmount = safeTokenTransfer(msg.sender, user.pendingRewards);
            emit Claim(msg.sender, _pid, claimedAmount);
            user.pendingRewards -= claimedAmount;
        }

        if (_amount > 0) {
            user.amount = user.amount - (_amount);
            user.lastClaim = block.timestamp;

            pool.lpToken.safeTransfer(address(msg.sender), _amount - feeAmount);

            if (feeAmount > 0) {
                pool.lpToken.safeTransfer(treasury, feeAmount);
            }
        }

        user.rewardDebt = (user.amount * (pool.accTokenPerShare)) / (SHARE_MULTIPLIER);

        emit Withdraw(msg.sender, _pid, _amount);
    }

    function safeTokenTransfer(address _to, uint256 _amount) internal returns (uint256) {
        uint256 tokenBal = token.balanceOf(address(this));
        if (_amount > tokenBal) {
            token.safeTransfer(_to, tokenBal);
            return tokenBal;
        } else {
            token.safeTransfer(_to, _amount);
            return _amount;
        }
    }

    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        bool _withUpdate,
        uint256 _lockupDuration
    ) external onlyOwner {
        require(!isLPPoolAdded[address(_lpToken)], "There's already a pool with that LP token!");
        require(_lockupDuration > 0, "Invalid lockupDuration");
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint + (_allocPoint);
        poolInfo.push(
            PoolInfo({
                lpToken: _lpToken,
                allocPoint: _allocPoint,
                lastRewardBlock: lastRewardBlock,
                accTokenPerShare: 0,
                lockupDuration: _lockupDuration
            })
        );

        isLPPoolAdded[address(_lpToken)] = true;
    }

    function set(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    ) external onlyOwner validatePoolByPid(_pid) {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint - (poolInfo[_pid].allocPoint) + (_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    function setTokenPerBlock(uint256 _tokenPerBlock) external onlyOwner {
        require(_tokenPerBlock > 0, "!tokenPerBlock-0");
        tokenPerBlock = _tokenPerBlock;

        emit RewardPerBlockChanged(_tokenPerBlock);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(address(_treasury) != address(0), "Invalid treasury address!");

        treasury = _treasury;
    }

    function setEmergencyWithdrawFee(uint256 _emergencyWithdrawFee) external onlyOwner {
        require(_emergencyWithdrawFee < 1000, "Fee can't be 100%");
        require(_emergencyWithdrawFee > 0, "Fee can't be 0");

        emergencyWithdrawFee = _emergencyWithdrawFee;
    }

    function pause() external onlyOwner whenNotPaused {
        _pause();
        emit Pause();
    }

    function unpause() external onlyOwner whenPaused {
        _unpause();
        emit Unpause();
    }
}
