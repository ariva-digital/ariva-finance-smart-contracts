import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { deployContract, solidity } from "ethereum-waffle";
import hre, { ethers, upgrades } from "hardhat";
import { Artifact } from "hardhat/types";
import { TestToken, Staking } from "../typechain";

import {
  advanceBlock,
  advanceTimeAndBlock,
  ether,
  wei,
  ZERO,
  getLatestBlockTimestamp,
  getLatestBlockNumber,
  revertEvm,
  getSnapShot,
} from "./utils";

const { expect } = chai;

chai.use(solidity);

describe("Staking", function () {
  let owner: SignerWithAddress;
  let token: TestToken;
  let staking: Staking;

  let tester1: SignerWithAddress;
  let tester2: SignerWithAddress;
  let tester3: SignerWithAddress;

  let blockNumber: number;
  const lockDuration = 3 * 24 * 3600; // 3 days

  before(async function () {
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    owner = signers[0];
    tester1 = signers[1];
    tester2 = signers[2];
    tester3 = signers[3];

    const TestTokenArtifact: Artifact = await hre.artifacts.readArtifact("TestToken");
    token = <TestToken>await deployContract(owner, TestTokenArtifact);

    const StakingArtifact = await ethers.getContractFactory("Staking");
    staking = <Staking>(
      await upgrades.deployProxy(StakingArtifact, [token.address, lockDuration], { initializer: "initialize" })
    );

    // transfer tokens to users
    await token.transfer(tester1.address, ether(50));
    await token.transfer(tester2.address, ether(50));
    await token.transfer(tester3.address, ether(50));

    // approve
    await token.connect(tester1).approve(staking.address, ether(10000));
    await token.connect(tester2).approve(staking.address, ether(10000));
    await token.connect(tester3).approve(staking.address, ether(10000));

    // transfer reward tokens to stakingContract for rewards
    await token.transfer(staking.address, ether(1000));
  });

  describe("start staking", function () {
    it("startStaking", async function () {
      blockNumber = await getLatestBlockNumber();
      await staking.startStaking(blockNumber);
    });
  });

  describe("check initial config", function () {
    it("check tokenAddress", async function () {
      expect(await staking.token()).to.equal(token.address);
    });

    it("check tokenPerBlock", async function () {
      expect(await staking.tokenPerBlock()).to.equal(ether(1));
    });

    it("check pool info", async function () {
      const pool = await staking.poolInfo();
      expect(pool.lastRewardBlock).to.equal(wei(blockNumber));
      expect(pool.accTokenPerShare).to.equal(ZERO);
      expect(pool.depositedAmount).to.equal(ZERO);
      expect(pool.rewardsAmount).to.equal(ZERO);
      expect(pool.lockupDuration).to.equal(wei(lockDuration));
    });
  });

  describe("check owner functions", function () {
    it("check setFeeInfo", async () => {
      await expect(staking.connect(tester1).setFeeInfo(200, 1000)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await staking.setFeeInfo(1000, 200);

      expect(await staking.withdrawFee()).to.equal(wei(200));
      expect(await staking.emergencyWithdrawFee()).to.equal(wei(1000));

      await staking.setFeeInfo(500, 100);

      expect(await staking.withdrawFee()).to.equal(wei(100));
      expect(await staking.emergencyWithdrawFee()).to.equal(wei(500));
    });

    it("check setTokenPerBlock", async () => {
      await expect(staking.connect(tester1).setTokenPerBlock(ether(2))).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await staking.setTokenPerBlock(ether(2));
      expect(await staking.tokenPerBlock()).to.equal(ether(2));
      await staking.setTokenPerBlock(ether(1));
    });
  });

  describe("Do staking", function () {
    it("Stake from tester1", async function () {
      await staking.connect(tester1).deposit(ether(10));
    });

    it("check poolInfo", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(ZERO);
      expect(pool.depositedAmount).to.equal(ether(10));
      expect(pool.rewardsAmount).to.equal(ZERO);
    });

    it("check tester1 info", async function () {
      const userInfo = await staking.userInfo(tester1.address);

      const blockTimeStamp = await getLatestBlockTimestamp();

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ZERO);
      expect(userInfo.pendingRewards).to.equal(ZERO);
      expect(userInfo.lastAction).to.equal(wei(blockTimeStamp));
    });

    it("Advance 5 blocks", async () => {
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
    });

    it("check pendingRewards of tester1", async () => {
      const rewards = await staking.pendingRewards(tester1.address);
      expect(rewards).to.equal(ether(5));
    });

    it("Stake from tester2", async function () {
      await staking.connect(tester2).deposit(ether(10));
    });

    it("check poolInfo", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(wei(600000000000));
      expect(pool.depositedAmount).to.equal(ether(20));
      expect(pool.rewardsAmount).to.equal(ether(6));
    });

    it("check tester2 info", async function () {
      const userInfo = await staking.userInfo(tester2.address);
      const blockTimeStamp = await getLatestBlockTimestamp();

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ether(6));
      expect(userInfo.pendingRewards).to.equal(ZERO);

      expect(userInfo.lastAction).to.equal(wei(blockTimeStamp));
    });

    it("Advance 5 blocks", async () => {
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
    });

    it("check pendingRewards of tester1", async () => {
      const rewards = await staking.pendingRewards(tester1.address);
      expect(rewards).to.equal(ether(8.5));
    });

    it("check pendingRewards of tester2", async () => {
      const rewards = await staking.pendingRewards(tester2.address);
      expect(rewards).to.equal(ether(2.5));
    });
  });

  describe("check claim", function () {
    let snapshotID: any;
    before(async () => {
      snapshotID = await getSnapShot();
    });
    after(async () => {
      await revertEvm(snapshotID);
    });

    it("Claim rewards from tester1", async () => {
      await staking.connect(tester1).deposit(ZERO);
    });

    it("check poolInfo after test1 claim", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(wei(900000000000));
      expect(pool.depositedAmount).to.equal(ether(20));
      expect(pool.rewardsAmount).to.equal(ether(3));
    });

    it("check tester1 info", async function () {
      const userInfo = await staking.userInfo(tester1.address);

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ether(9));
      expect(userInfo.pendingRewards).to.equal(ZERO);

      const userTokenBalance = await token.balanceOf(tester1.address);

      expect(userTokenBalance).to.equal(ether(49));
    });

    it("Claim rewards from tester2", async () => {
      await staking.connect(tester2).deposit(ZERO);
    });

    it("check poolInfo  after test2 claim", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(wei(950000000000));
      expect(pool.depositedAmount).to.equal(ether(20));
      expect(pool.rewardsAmount).to.equal(ether(0.5));
    });

    it("check tester2 info", async function () {
      const userInfo = await staking.userInfo(tester2.address);

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ether(9.5));
      expect(userInfo.pendingRewards).to.equal(ZERO);

      const userTokenBalance = await token.balanceOf(tester2.address);

      expect(userTokenBalance).to.equal(ether(43.5));
    });

    it("do withdraw", async () => {
      const prevBalance = await token.balanceOf(tester1.address);
      await staking.connect(tester1).withdraw(ether(5)); // 5% -0.25, +1 reward
      const afterBalance = await token.balanceOf(tester1.address);
      expect(afterBalance.sub(prevBalance)).to.equal(ether(5.75));
    });

    it("check pool after test1 withdraw", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(wei(1000000000000));
      expect(pool.depositedAmount).to.equal(ether(15));
      expect(pool.rewardsAmount).to.equal(ether(0.5));
    });

    it("check tester1 info", async function () {
      const userInfo = await staking.userInfo(tester1.address);

      expect(userInfo.amount).to.equal(ether(5));
      expect(userInfo.rewardDebt).to.equal(ether(5));
      expect(userInfo.pendingRewards).to.equal(ZERO);
    });

    it("do excludeFromFee", async () => {
      await expect(staking.connect(tester1).excludeFromFee(tester1.address, true)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await staking.excludeFromFee(tester1.address, true);

      expect(await staking.isWhitelistedFromFee(tester1.address)).to.equal(true);
    });

    it("do withdraw", async () => {
      const prevBalance = await token.balanceOf(tester1.address);

      await staking.connect(tester1).withdraw(ether(5));
      const afterBalance = await token.balanceOf(tester1.address);
      expect(afterBalance.sub(prevBalance)).to.equal(ether(6));
    });

    it("check pool after test1 withdraw", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(wei(1200000000000));
      expect(pool.depositedAmount).to.equal(ether(10));
      expect(pool.rewardsAmount).to.equal(ether(2.5));
    });

    it("check tester1 info", async function () {
      const userInfo = await staking.userInfo(tester1.address);
      const blockTimeStamp = await getLatestBlockTimestamp();

      expect(userInfo.amount).to.equal(ether(0));
      expect(userInfo.rewardDebt).to.equal(ether(0));
      expect(userInfo.pendingRewards).to.equal(ZERO);
      expect(userInfo.lastAction).to.equal(wei(blockTimeStamp));
    });

    it("check emergencyWithdraw", async function () {
      const prevBalance = await token.balanceOf(tester2.address);
      await staking.connect(tester2).emergencyWithdraw();
      const afterBalance = await token.balanceOf(tester2.address);

      expect(afterBalance.sub(prevBalance)).to.equal(ether(9.5));
    });

    it("check pool after test2 emergencyWithdraw", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(wei(1300000000000));
      expect(pool.depositedAmount).to.equal(ether(0));
      expect(pool.rewardsAmount).to.equal(ether(0));
    });

    it("check tester2 info", async function () {
      const userInfo = await staking.userInfo(tester1.address);

      expect(userInfo.amount).to.equal(ether(0));
      expect(userInfo.rewardDebt).to.equal(ether(0));
      expect(userInfo.pendingRewards).to.equal(ZERO);
    });
  });

  describe("check withdraw", function () {
    let snapshotID: any;
    before(async () => {
      snapshotID = await getSnapShot();
    });
    after(async () => {
      await revertEvm(snapshotID);
    });

    it("advance time to withdraw", async () => {
      await advanceTimeAndBlock(3 * 24 * 60 * 60);
    });

    it("withdraw from tester1", async () => {
      const prevBalance = await token.balanceOf(tester1.address);

      await staking.connect(tester1).withdraw(ether(5)); // 1% fee
      const afterBalance = await token.balanceOf(tester1.address);

      expect(afterBalance.sub(prevBalance)).to.equal(ether(14.45)); // 5 + 8.5 + 1 - 0.05
    });

    it("check pool after test1 withdraw", async function () {
      const pool = await staking.poolInfo();

      expect(pool.accTokenPerShare).to.equal(wei(950000000000));
      expect(pool.depositedAmount).to.equal(ether(15));
      expect(pool.rewardsAmount).to.equal(ether(3.5));
    });

    it("check tester1 info", async function () {
      const userInfo = await staking.userInfo(tester1.address);
      const blockTimeStamp = await getLatestBlockTimestamp();

      expect(userInfo.amount).to.equal(ether(5));
      expect(userInfo.rewardDebt).to.equal(ether(4.75));
      expect(userInfo.pendingRewards).to.equal(ZERO);
      expect(userInfo.lastAction).to.equal(wei(blockTimeStamp));
    });
  });
});
