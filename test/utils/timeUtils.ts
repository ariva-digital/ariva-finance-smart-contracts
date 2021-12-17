import { network } from "hardhat";

export const advanceTime = async (time: number): Promise<void> =>
  new Promise((resolve, reject) => {
    network.provider.send("evm_increaseTime", [time]).then(resolve).catch(reject);
  });

export const advanceBlock = (): Promise<void> =>
  new Promise((resolve, reject) => {
    network.provider.send("evm_mine").then(resolve).catch(reject);
  });

export const advanceTimeAndBlock = async (time: number): Promise<void> => {
  await advanceTime(time);
  await advanceBlock();
};
