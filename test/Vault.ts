import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { deployContract, solidity } from "ethereum-waffle";
import hre, { ethers, upgrades } from "hardhat";
import { Artifact } from "hardhat/types";
import { TestToken, Staking, Vault } from "../typechain";

import {
  advanceBlock,
  advanceTimeAndBlock,
  ether,
  ONE_WEEK_IN_SECONDS,
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
  let vault: Vault;

  let tester1: SignerWithAddress;
  let tester2: SignerWithAddress;
  let tester3: SignerWithAddress;
  let treasury: SignerWithAddress;

  let blockNumber: number;
  const lockDuration = 3 * 24 * 3600; // 3 days

  before(async function () {
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    owner = signers[0];
    tester1 = signers[1];
    tester2 = signers[2];
    tester3 = signers[3];
    treasury = signers[4];

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
    await token.approve(staking.address, ether(10000));
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

  describe("deploy Vault", function () {
    it("deploy Vault", async function () {
      const VaultArtifact = await ethers.getContractFactory("Vault");
      vault = <Vault>await upgrades.deployProxy(
        VaultArtifact,
        [token.address, staking.address,  treasury.address],
        {
          initializer: "initialize",
        },
      );
    });

    it("exclude from fee", async function () {
      await staking.excludeFromFee(vault.address, true);
    });

    it("do approve", async function () {
      await token.approve(vault.address, ether(10000));
      await token.connect(tester1).approve(vault.address, ether(10000));
      await token.connect(tester2).approve(vault.address, ether(10000));
      await token.connect(tester3).approve(vault.address, ether(10000));
    });
  });

  describe("check vault config", function () {
    it("check fee related variables", async () => {
      expect(await vault.performanceFee()).to.equal(wei(200));
      expect(await vault.callFee()).to.equal(wei(25));
      expect(await vault.withdrawFee()).to.equal(wei(100));
      expect(await vault.emergencyWithdrawFee()).to.equal(wei(500));
      expect(await vault.withdrawFeePeriod()).to.equal(wei(72 * 3600));
    });

    it("check config values", async () => {
      expect(await vault.token()).to.equal(token.address);
      expect(await vault.masterchef()).to.equal(staking.address);
      expect(await vault.treasury()).to.equal(treasury.address);
    });
  });

  describe("check ownable functions", function () {
    

    it("check setTreasury", async () => {
      await expect(vault.connect(tester1).setTreasury(tester2.address)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await vault.setTreasury(tester2.address);
      expect(await vault.treasury()).to.equal(tester2.address);
      await vault.setTreasury(treasury.address);
    });

    it("check setPerformanceFee", async () => {
      await expect(vault.connect(tester1).setPerformanceFee(300)).to.be.revertedWith("Ownable: caller is not the owner");
      await vault.setPerformanceFee(300);
      expect(await vault.performanceFee()).to.equal(wei(300));
      await vault.setPerformanceFee(200);
    });

    it("check setCallFee", async () => {
      await expect(vault.connect(tester1).setCallFee(300)).to.be.revertedWith("Ownable: caller is not the owner");
      await vault.setCallFee(300);
      expect(await vault.callFee()).to.equal(wei(300));
      await vault.setCallFee(25);
    });

    it("check setWithdrawFee", async () => {
      await expect(vault.connect(tester1).setWithdrawFee(300)).to.be.revertedWith("Ownable: caller is not the owner");
      await vault.setWithdrawFee(300);
      expect(await vault.withdrawFee()).to.equal(wei(300));
      await vault.setWithdrawFee(100);
    });

    it("check setEmergencyWithdrawFee", async () => {
      await expect(vault.connect(tester1).setEmergencyWithdrawFee(300)).to.be.revertedWith("Ownable: caller is not the owner");
      await vault.setEmergencyWithdrawFee(300);
      expect(await vault.emergencyWithdrawFee()).to.equal(wei(300));
      await vault.setEmergencyWithdrawFee(500);
    });
  });

  describe("stake some", function () {
    it("stake to masterChef", async () => {
      await staking.deposit(ether(10));
    });
    it("stake to vault from tester1", async () => {
      await vault.connect(tester1).deposit(ether(10));
    });
    it("check pool values", async () => {
      expect(await vault.totalShares()).to.equal(ether(10));
      expect(await vault.lastHarvestedTime()).to.equal(ZERO);
      expect(await vault.balanceOf()).to.equal(ether(10));
      expect(await vault.calculateTotalPendingRewards()).to.equal(ZERO);
      expect(await vault.calculateHarvestRewards()).to.equal(ZERO);
      expect(await vault.getPricePerFullShare()).to.equal(ether(1));
      expect(await vault.available()).to.equal(ZERO);
    });
    it("check tester1 info", async () => {
      const blockTimestamp = await getLatestBlockTimestamp();
      const userInfo = await vault.userInfo(tester1.address);
      expect(userInfo.shares).to.equal(ether(10));
      expect(userInfo.lastDepositedTime).to.equal(wei(blockTimestamp));
      expect(userInfo.lastUserActionTime).to.equal(wei(blockTimestamp));
      expect(userInfo.tokenAtLastUserAction).to.equal(ether(10));
    });
    it("advance 5 blocks", async function () {
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
    });
    it("stake to vault from tester2", async () => {
      await vault.connect(tester2).deposit(ether(10));
    });
    it("check pool values", async () => {
      expect(await vault.totalShares()).to.equal(ether(20));
      expect(await vault.lastHarvestedTime()).to.equal(ZERO);
      expect(await vault.balanceOf()).to.equal(ether(23));
      expect(await vault.calculateTotalPendingRewards()).to.equal(ether(3));
      expect(await vault.calculateHarvestRewards()).to.equal(ether(0.0075));
      expect(await vault.getPricePerFullShare()).to.equal(ether(1.15));
      expect(await vault.available()).to.equal(ether(3));
    });
    it("check tester2 info", async () => {
      const blockTimestamp = await getLatestBlockTimestamp();
      const userInfo = await vault.userInfo(tester2.address);
      expect(userInfo.shares).to.equal(ether(10));
      expect(userInfo.lastDepositedTime).to.equal(wei(blockTimestamp));
      expect(userInfo.lastUserActionTime).to.equal(wei(blockTimestamp));
      expect(userInfo.tokenAtLastUserAction).to.equal(ether(10));
    });

    it("advance 3 blocks", async function () {
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
    });
  });

  describe("harvest", function () {
    it("check and harvest", async () => {
      expect(await vault.calculateTotalPendingRewards()).to.equal(ether(5));
      expect(await vault.calculateHarvestRewards()).to.equal(ether(0.0125));
      const prevBalance = await token.balanceOf(tester2.address);
      await advanceBlock();
      await advanceBlock();
      await vault.connect(tester2).harvest();
      const afterBalance = await token.balanceOf(tester2.address);
      expect(afterBalance.sub(prevBalance)).to.equal(ether(0.0175));
      const treasuryBal = await token.balanceOf(treasury.address);
      expect(treasuryBal).to.equal(ether(0.14));
    });
    it("check pool values", async () => {
      expect(await vault.totalShares()).to.equal(ether(20));
      const blockTimestamp = await getLatestBlockTimestamp();
      expect(await vault.lastHarvestedTime()).to.equal(wei(blockTimestamp));
      expect(await vault.balanceOf()).to.equal(ether(26.8425));
      expect(await vault.calculateTotalPendingRewards()).to.equal(ZERO);
      expect(await vault.calculateHarvestRewards()).to.equal(ZERO);
      expect(await vault.getPricePerFullShare()).to.equal(ether(1.342125));
      expect(await vault.available()).to.equal(ZERO);
    });
    it("check tester1 info", async () => {
      const userInfo = await vault.userInfo(tester1.address);
      expect(userInfo.shares).to.equal(ether(10));
    });
    it("advance 3 blocks", async function () {
      await advanceBlock();
      await advanceBlock();
      await advanceBlock();
    });
  });

  describe("withdraw", function () {
    it("withdraw 5% fee", async () => {
      await expect(vault.connect(tester1).withdraw(0)).to.be.revertedWith("Nothing to withdraw");
      await expect(vault.connect(tester1).withdraw(ether(11))).to.be.revertedWith("Withdraw amount exceeds balance");
      const prevBalance = await token.balanceOf(tester1.address);
      await vault.connect(tester1).withdraw(ether(5));
      const afterBalance = await token.balanceOf(tester1.address);
      expect(afterBalance.sub(prevBalance)).to.equal(ether(6.37509375)); // 5% excluded
      const treasuryBal = await token.balanceOf(treasury.address);
      expect(treasuryBal).to.equal(ether(0.47553125));
    });
    it("withdraw 1% fee", async () => {
      await advanceTimeAndBlock(72 * 3600);
      await advanceBlock();

      const prevBalance = await token.balanceOf(tester1.address);
      await vault.connect(tester1).withdraw(ether(5));
      const afterBalance = await token.balanceOf(tester1.address);
      expect(afterBalance.sub(prevBalance)).to.equal(wei("8086095936665215425"));
    });
  });
});
