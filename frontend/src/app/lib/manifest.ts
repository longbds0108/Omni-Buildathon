import { encodeFunctionData, getAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";

/**
 * Deploy manifest. The deploy script writes chain IDs, addresses and deploy blocks here. While it is null the
 * dashboard runs the Local simulation: same math and checks as the contracts, nothing is sent on chain.
 */
export interface Manifest {
  base: { chainId: 84532; deployBlock: number; oracle: Address; collateral: Address; musd: Address; vault: Address; receiver: Address };
  lasna: { chainId: 5318007; deployBlock: number; reactiveRepay: Address };
}
export const manifest: Manifest | null = null;
export const isLocalSimulation = manifest === null;

export const CHAINS = {
  base: { id: 84532, name: "Base Sepolia", short: "Base", explorer: "https://sepolia.basescan.org" },
  lasna: { id: 5318007, name: "Reactive Lasna", short: "Lasna", explorer: "https://lasna.reactscan.net" },
} as const;
export type ChainKey = keyof typeof CHAINS;

export const CALLBACK_PROXY: Address = "0x476F44b11F5C942c58f4c8E3d0300E5710743585";
export const SYSTEM_CONTRACT: Address = "0x8888888888888888888888888888888888888888";

export const txUrl = (chain: ChainKey, hash: Hex) => `${CHAINS[chain].explorer}/tx/${hash}`;
export const addressUrl = (chain: ChainKey, address: Address) => `${CHAINS[chain].explorer}/address/${address}`;

/** Stand-in addresses for the Local simulation, derived from a label so they stay the same across reloads. */
const simAddress = (label: string) => getAddress(`0x${keccak256(toHex(`repay-relay/local-simulation/${label}`)).slice(-40)}`);
export const SIM = {
  borrower: simAddress("borrower"),
  oracle: simAddress("MockOracle"),
  vault: simAddress("LendingVault"),
  receiver: simAddress("RepayReceiver"),
  reactiveRepay: simAddress("ReactiveRepay"),
};

export const contracts = {
  borrower: SIM.borrower,
  oracle: SIM.oracle,
  vault: SIM.vault,
  receiver: SIM.receiver,
  reactiveRepay: SIM.reactiveRepay,
};

const receiverAbi = parseAbi(["function executeRepay(address reactiveSender, uint256 oracleVersion, bytes32 originTxHash)"]);

/** The callback payload as ReactiveRepay encodes it (sender = address(0)) and as the proxy delivers it. */
export function callbackPayload(version: number, originTx: Hex) {
  const encode = (sender: Address) =>
    encodeFunctionData({ abi: receiverAbi, functionName: "executeRepay", args: [sender, BigInt(version), originTx] });
  return { requested: encode("0x0000000000000000000000000000000000000000"), delivered: encode(contracts.reactiveRepay) };
}
