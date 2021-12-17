export const waitSeconds = (seconds: number): Promise<unknown> => {
  console.log(`\tWaiting ${seconds} seconds...`);
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
};
