import { Contract, ContractFactory } from "ethers";

// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre, { ethers, upgrades } from "hardhat";
import { waitSeconds } from "./utils";
import config from "./config";

async function getImplementationAddress(proxyAddress: string) {
  const implHex = await ethers.provider.getStorageAt(
    proxyAddress,
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  );
  return ethers.utils.hexStripZeros(implHex);
}

async function main(): Promise<void> {
  // Hardhat always runs the compile task when running scripts through it.
  // If this runs in a standalone fashion you may want to call compile manually
  // to make sure everything is compiled
  // await run("compile");

  // We get the contract to deploy

  // construction params
  const paramData = config.bsct;
  const params = [paramData.token, paramData.tokenPerBlock, paramData.startBlock, paramData.farmingTreasury];

  const FarmingFactory: ContractFactory = await ethers.getContractFactory("Farming");
  const farming: Contract = await upgrades.deployProxy(FarmingFactory, params, {
    initializer: "initialize",
  });
  await farming.deployed();
  console.log("Farming deployed to:", farming.address);
  const farmingImplementation = await getImplementationAddress(farming.address);

  await waitSeconds(25);

  await hre.run("verify:verify", {
    address: farmingImplementation,
    contract: "contracts/farming/Farming.sol:Farming",
    constructorArguments: [],
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
