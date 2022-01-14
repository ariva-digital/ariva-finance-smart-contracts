const config = {
  bsc: {
    token: "0x6679eb24f59dfe111864aec72b443d1da666b360",
    lockupDuration: 3 * 24 * 3600,
    tokenPerBlock: 3 * 10 ** 18,
    startBlock: 30000,
    staking: "0xDaEaB0D03313B0cfe5881A155C0cFaE52013F9Fa",
    treasury: "0xDaEaB0D03313B0cfe5881A155C0cFaE52013F9Fa",
    farmingTreasury: "0xDaEaB0D03313B0cfe5881A155C0cFaE52013F9Fa",
  },
  bsct: {
    token: "0x40D72277A87ae721232893E863626bdf6240c206",
    lockupDuration: 3 * 24 * 3600,
    tokenPerBlock: 3 * 10 ** 18,
    startBlock: 30000,
    staking: "0xC2C28d7f58DEEDc674547B42aBE2F4EE2c49Ad9f",
    treasury: "0xb26B59977EED6756e73D0B3BA102780c06C54569",
    farmingTreasury: "0xDaEaB0D03313B0cfe5881A155C0cFaE52013F9Fa",
  },
  mainnet: { 
    token: "0x79c7ef95ad32dcd5ecadb231568bb03df7824815",
    lockupDuration: 3 * 24 * 3600, 
    tokenPerBlock: 3 * 10 ** 18,
    startBlock: 30000, 
    treasury: "0xb26B59977EED6756e73D0B3BA102780c06C54569",
    farmingTreasury: "0xDaEaB0D03313B0cfe5881A155C0cFaE52013F9Fa",
  },
};

export default config;
