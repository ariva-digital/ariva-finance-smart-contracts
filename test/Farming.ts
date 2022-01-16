import { getLatestBlockNumber } from './utils/helpers';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { deployContract, solidity } from "ethereum-waffle";
import hre, { ethers, upgrades } from "hardhat";
import { Artifact } from "hardhat/types";
import { TestToken, Farming } from "../typechain";
import { BigNumber } from "@ethersproject/bignumber";

import {
  advanceBlock,
  advanceTimeAndBlock,
  ether,
  wei,
  ZERO,
  getLatestBlockTimestamp,
  revertEvm,
  getSnapShot,
} from "./utils";

const { expect } = chai;

chai.use(solidity);

describe("Farming", function () {
  let owner: SignerWithAddress;
  let token: TestToken;
  let farming: Farming;

  let tester1: SignerWithAddress;
  let tester2: SignerWithAddress;
  let tester3: SignerWithAddress;

  let lpToken0: TestToken;
  let lpToken1: TestToken;

  const tokenPerBlock = ether(1);
  const startBlock = BigNumber.from(1);
  let farmingTreasury: string;
  const lockupDuration = BigNumber.from(3 * 24 * 3600); // 3 days

  before(async function () {
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    owner = signers[0];
    tester1 = signers[1];
    tester2 = signers[2];
    tester3 = signers[3];
    farmingTreasury = signers[4].address;

    const TestTokenArtifact: Artifact = await hre.artifacts.readArtifact("TestToken");
    token = <TestToken>await deployContract(owner, TestTokenArtifact);

    const FarmingArtifact = await ethers.getContractFactory("Farming");
    farming = <Farming>(
      await upgrades.deployProxy(FarmingArtifact, [token.address, tokenPerBlock, startBlock, farmingTreasury], { initializer: "initialize" })
    );

    // transfer reward tokens to farmingContract for rewards
    await token.transfer(farming.address, ether(1000));

    lpToken0 = <TestToken>await deployContract(owner, TestTokenArtifact);
    lpToken1 = <TestToken>await deployContract(owner, TestTokenArtifact);

    // transfer lptokens to users
    await lpToken0.transfer(tester1.address, ether(50));
    await lpToken0.transfer(tester2.address, ether(50));
    await lpToken0.transfer(tester3.address, ether(50));
    await lpToken1.transfer(tester1.address, ether(50));
    await lpToken1.transfer(tester2.address, ether(50));
    await lpToken1.transfer(tester3.address, ether(50));

    // approve
    await lpToken0.connect(tester1).approve(farming.address, ether(10000));
    await lpToken0.connect(tester2).approve(farming.address, ether(10000));
    await lpToken0.connect(tester3).approve(farming.address, ether(10000));
    await lpToken1.connect(tester1).approve(farming.address, ether(10000));
    await lpToken1.connect(tester2).approve(farming.address, ether(10000));
    await lpToken1.connect(tester3).approve(farming.address, ether(10000));

  });

  describe("check initial config", function () {
    it("check tokenAddress", async function () {
      expect(await farming.token()).to.equal(token.address);
    });

    it("check tokenPerBlock", async function () {
      expect(await farming.tokenPerBlock()).to.equal(tokenPerBlock);
    });

    it("check startBlock", async function () {
      expect(await farming.startBlock()).to.equal(startBlock);
    });

    it("check treasury", async function () {
      expect(await farming.treasury()).to.equal(farmingTreasury);
    });
  });

  describe("check owner functions", function () {
    it("check setTokenPerBlock", async () => {
      await expect(farming.connect(tester1).setTokenPerBlock(ether(2))).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await farming.setTokenPerBlock(ether(2));
      expect(await farming.tokenPerBlock()).to.equal(ether(2));
      await farming.setTokenPerBlock(tokenPerBlock);
    });

    it("check setTreasury", async () => {
      await expect(farming.connect(tester1).setTreasury(tester3.address)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await farming.setTreasury(tester3.address);
      expect(await farming.treasury()).to.equal(tester3.address);
      await farming.setTreasury(farmingTreasury);
    });
  });

  describe("prepare pools", function () {
    it("add pool0", async () => {
      await farming.add(50, lpToken0.address, false, lockupDuration);
      const blockNumber = await getLatestBlockNumber();
      expect(await farming.poolLength()).to.equal(1);
      expect((await farming.poolInfo(0)).lpToken).to.equal(lpToken0.address);
      expect((await farming.poolInfo(0)).allocPoint).to.equal(50);
      expect((await farming.poolInfo(0)).lastRewardBlock).to.equal(Math.max(blockNumber, startBlock.toNumber()));
      expect((await farming.poolInfo(0)).accTokenPerShare).to.equal(ZERO);
      expect((await farming.poolInfo(0)).lockupDuration).to.equal(lockupDuration);
    });

    it("add pool1", async () => {
      await farming.add(50, lpToken1.address, false, lockupDuration);
      const blockNumber = await getLatestBlockNumber();
      expect(await farming.poolLength()).to.equal(2);
      expect((await farming.poolInfo(1)).lpToken).to.equal(lpToken1.address);
      expect((await farming.poolInfo(1)).allocPoint).to.equal(50);
      expect((await farming.poolInfo(1)).lastRewardBlock).to.equal(Math.max(blockNumber, startBlock.toNumber()));
      expect((await farming.poolInfo(1)).accTokenPerShare).to.equal(ZERO);
      expect((await farming.poolInfo(1)).lockupDuration).to.equal(lockupDuration);
    });

    it("set pool0", async () => {
      await farming.set(0, 100, false);
      expect((await farming.poolInfo(0)).allocPoint).to.equal(100);
    });

    it("set pool1", async () => {
      await farming.set(1, ZERO, true);
      expect((await farming.poolInfo(1)).allocPoint).to.equal(ZERO);
    });
  })

  describe("Do farming", function () {
    it("Stake lpToken0 on pool0 from tester1", async function () {
      await farming.connect(tester1).deposit(0, ether(10));
    });

    it("check poolInfo0", async function () {
      const pool = await farming.poolInfo(0);
      
      expect(pool.accTokenPerShare).to.equal(ZERO);
    });

    it("check tester1 info for pool0", async function () {
      const userInfo = await farming.userInfo(0, tester1.address);
      const blockTimeStamp = await getLatestBlockTimestamp();

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ZERO);
      expect(userInfo.pendingRewards).to.equal(ZERO);
      expect(userInfo.lastClaim).to.equal(wei(blockTimeStamp));
    });

    it("Advance 5 blocks", async () => {
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
    });

    it("check pendingRewards of tester1", async () => {
      const rewards = await farming.pendingToken(0, tester1.address);
      expect(rewards).to.equal(ether(5));
    });

    it("Stake lpToken0 on pool0 from tester2", async function () {
      await farming.connect(tester2).deposit(0, ether(10));
    });

    it("check poolInfo0", async function () {
      const pool = await farming.poolInfo(0);

      expect(pool.accTokenPerShare).to.equal(wei(600000000000));
    });

    it("check tester2 info for pool0", async function () {
      const userInfo = await farming.userInfo(0, tester2.address);
      const blockTimeStamp = await getLatestBlockTimestamp();

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ether(6));
      expect(userInfo.pendingRewards).to.equal(ZERO);
      expect(userInfo.lastClaim).to.equal(wei(blockTimeStamp));
    });

    it("Advance 5 blocks", async () => {
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
    });

    it("check pendingRewards of tester1", async () => {
      const rewards = await farming.pendingToken(0, tester1.address);
      expect(rewards).to.equal(ether(8.5));
    });

    it("check pendingRewards of tester2", async () => {
      const rewards = await farming.pendingToken(0, tester2.address);
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

    it("Claim rewards from pool0 for tester1", async () => {
      await farming.connect(tester1).deposit(0, ZERO);
    });

    it("check poolInfo0 after test1 claim", async function () {
      const pool = await farming.poolInfo(0);

      expect(pool.accTokenPerShare).to.equal(wei(900000000000));
    });

    it("check tester1 info for pool0", async function () {
      const userInfo = await farming.userInfo(0, tester1.address);

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ether(9));
      expect(userInfo.pendingRewards).to.equal(ZERO);

      const userTokenBalance = await token.balanceOf(tester1.address);

      expect(userTokenBalance).to.equal(ether(9));
    });

    it("Claim rewards from pool0 for tester2", async () => {
      await farming.connect(tester2).deposit(0, ZERO);
    });

    it("check poolInfo  after test2 claim", async function () {
      const pool = await farming.poolInfo(0);

      expect(pool.accTokenPerShare).to.equal(wei(950000000000));
    });

    it("check tester2 info for pool0", async function () {
      const userInfo = await farming.userInfo(0, tester2.address);

      expect(userInfo.amount).to.equal(ether(10));
      expect(userInfo.rewardDebt).to.equal(ether(9.5));
      expect(userInfo.pendingRewards).to.equal(ZERO);

      const userTokenBalance = await token.balanceOf(tester2.address);

      expect(userTokenBalance).to.equal(ether(3.5));
    });

    it("do withdraw", async () => {
      const prevBalance = await lpToken0.balanceOf(tester1.address);
      await farming.connect(tester1).withdraw(0, ether(5)); // 5% -0.25
      const afterBalance = await lpToken0.balanceOf(tester1.address);
      expect(afterBalance.sub(prevBalance)).to.equal(ether(4.75));
    });

    it("check pool after test1 withdraw", async function () {
      const pool = await farming.poolInfo(0);

      expect(pool.accTokenPerShare).to.equal(wei(1000000000000));
    });

    it("check tester1 info for pool0", async function () {
      const userInfo = await farming.userInfo(0, tester1.address);

      expect(userInfo.amount).to.equal(ether(5));
      expect(userInfo.rewardDebt).to.equal(ether(5));
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
      const prevBalance = await lpToken0.balanceOf(tester1.address);

      await farming.connect(tester1).withdraw(0, ether(5)); // 0% fee
      const afterBalance = await lpToken0.balanceOf(tester1.address);

      expect(afterBalance.sub(prevBalance)).to.equal(ether(5));
    });

    it("check poolInfo0 after test1 withdraw", async function () {
      const pool = await farming.poolInfo(0);

      expect(pool.accTokenPerShare).to.equal(wei(950000000000));
    });

    it("check tester1 info for pool0", async function () {
      const userInfo = await farming.userInfo(0, tester1.address);
      const blockTimeStamp = await getLatestBlockTimestamp();

      expect(userInfo.amount).to.equal(ether(5));
      expect(userInfo.rewardDebt).to.equal(ether(4.75));
      expect(userInfo.pendingRewards).to.equal(ZERO);
      expect(userInfo.lastClaim).to.equal(wei(blockTimeStamp));
    });
  });
});
