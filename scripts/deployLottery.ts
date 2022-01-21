import { Contract, ContractFactory } from "ethers";
// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import { waitSeconds } from "./utils";
import config from "./config";

async function main(): Promise<void> {
  // Hardhat always runs the compile task when running scripts through it.
  // If this runs in a standalone fashion you may want to call compile manually
  // to make sure everything is compiled
  // await run("compile");

  // We get the contract to deploy
  const params = config.bsct;

  // construction params

  const RandomNumberGenerator: ContractFactory = await ethers.getContractFactory("RandomNumberGenerator");
  const randomNumberGenerator: Contract = await RandomNumberGenerator.deploy(params.vrfCoordinator, params.linkToken);
  await randomNumberGenerator.deployed();

  console.log("RandomNumberGenerator deployed to:", randomNumberGenerator.address);

  await waitSeconds(10);

  const ArivaLottery: ContractFactory = await ethers.getContractFactory("ArivaLottery");
  const arivaLottery: Contract = await ArivaLottery.deploy(params.token, randomNumberGenerator.address);
  await arivaLottery.deployed();

  console.log("ArivaLottery deployed to:", arivaLottery.address);

  await randomNumberGenerator.setLotteryAddress(arivaLottery.address);

  await arivaLottery.setOperatorAndTreasuryAndInjectorAddresses(params.lotteryOperator, params.lotteryTreasury, params.lotteryInjector);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });