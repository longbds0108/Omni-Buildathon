import { encodeFunctionData, getAddress, isAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";

/**
 * Deploy manifest, written by contracts/scripts/build-manifest.mjs to frontend/public/manifest.json.
 * - none: the dashboard runs the in-browser Local simulation (same math and checks, nothing on chain).
 * - "local": two anvil chains with a relayer standing in for Reactive Network, still labeled Local simulation.
 * - "testnet": Base Sepolia (84532) and Reactive Lasna (5318007), real data.
 */
export interface Manifest {
  network: "testnet" | "local";
  generatedAt: string;
  base: {
    name: string;
    chainId: number;
    rpc: string;
    explorer: string | null;
    deployBlock: number;
    operator: Address;
    collateral: Address;
    musd: Address;
    oracle: Address;
    vault: Address;
    receiver: Address;
    callbackProxy: Address;
  };
  lasna: { name: string; chainId: number; rpc: string; explorer: string | null; deployBlock: number; reactiveRepay: Address; systemContract: Address };
  borrower: Address;
  triggerPriceE6: string;
  callbackGasLimit: number;
  funding: { receiverWei: string; reactiveWei: string };
  transactions: { chain: "base" | "lasna"; label: string; hash: Hex; block: number }[];
}

export type DataMode = "sim" | "local" | "testnet";
/** Developer switch for the in-browser simulation and the local anvil pair. Off by default: the app shows real data only. */
export const devSimulation = import.meta.env.VITE_DEV_SIMULATION === "1";
export let manifest: Manifest | null = null;
export let dataMode: DataMode = "sim";
/** True for anything that is not real testnet data. Every such screen carries the Local simulation label. */
export let isLocalSimulation = true;

export const CHAINS = {
  base: { id: 84532, name: "Base Sepolia", short: "Base", explorer: "https://sepolia.basescan.org" as string | null },
  lasna: { id: 5318007, name: "Reactive Lasna", short: "Lasna", explorer: "https://lasna.reactscan.net" as string | null },
};
export type ChainKey = keyof typeof CHAINS;

export const CALLBACK_PROXY: Address = "0x476F44b11F5C942c58f4c8E3d0300E5710743585";
export const SYSTEM_CONTRACT: Address = "0x8888888888888888888888888888888888888888";

/** Explorer links exist only for deployed contracts: simulated hashes are never on chain. */
export const txUrl = (chain: ChainKey, hash: Hex) =>
  dataMode !== "sim" && CHAINS[chain].explorer ? `${CHAINS[chain].explorer}/tx/${hash}` : null;
export const addressUrl = (chain: ChainKey, address: Address) =>
  dataMode !== "sim" && CHAINS[chain].explorer ? `${CHAINS[chain].explorer}/address/${address}` : null;

/** Stand-in addresses for the in-browser simulation, derived from a label so they stay the same across reloads. */
const simAddress = (label: string) => getAddress(`0x${keccak256(toHex(`xlmflow/local-simulation/${label}`)).slice(-40)}`);

export const contracts = {
  borrower: simAddress("borrower"),
  operator: simAddress("operator"),
  oracle: simAddress("MockOracle"),
  vault: simAddress("LendingVault"),
  receiver: simAddress("RepayReceiver"),
  reactiveRepay: simAddress("ReactiveRepay"),
  callbackProxy: CALLBACK_PROXY,
  collateral: simAddress("mCOL"),
  musd: simAddress("mUSD"),
};

function valid(m: unknown): m is Manifest {
  const x = m as Manifest;
  return (
    !!x &&
    (x.network === "testnet" || x.network === "local") &&
    [x.base?.oracle, x.base?.vault, x.base?.receiver, x.base?.collateral, x.base?.musd, x.lasna?.reactiveRepay, x.borrower].every(
      (a) => typeof a === "string" && isAddress(a),
    )
  );
}

/** Loads /manifest.json once at startup. Any problem leaves the dashboard in the in-browser simulation. */
export async function loadManifest(): Promise<void> {
  try {
    const res = await fetch("/manifest.json", { cache: "no-store" });
    if (!res.ok) return;
    const m = await res.json();
    if (!valid(m)) {
      console.warn("manifest.json is incomplete; the dashboard waits for a testnet deployment");
      return;
    }
    // Only real testnet data reaches the dashboard, unless a developer turns the simulations on explicitly.
    if (m.network !== "testnet" && !devSimulation) {
      console.warn("manifest.json is a local deployment; ignored (set VITE_DEV_SIMULATION=1 to use it)");
      return;
    }
    manifest = m;
    dataMode = m.network;
    isLocalSimulation = m.network !== "testnet";
    CHAINS.base = { id: m.base.chainId, name: m.base.name, short: m.network === "local" ? "Base (local)" : "Base", explorer: m.base.explorer };
    CHAINS.lasna = { id: m.lasna.chainId, name: m.lasna.name, short: m.network === "local" ? "Lasna (local)" : "Lasna", explorer: m.lasna.explorer };
    Object.assign(contracts, {
      borrower: m.borrower,
      operator: m.base.operator,
      oracle: m.base.oracle,
      vault: m.base.vault,
      receiver: m.base.receiver,
      reactiveRepay: m.lasna.reactiveRepay,
      callbackProxy: m.base.callbackProxy,
      collateral: m.base.collateral,
      musd: m.base.musd,
    });
  } catch {
    /* no manifest: Local simulation */
  }
}

const receiverAbi = parseAbi(["function executeRepay(address reactiveSender, uint256 oracleVersion, bytes32 originTxHash)"]);

/** The callback payload as ReactiveRepay encodes it (sender = address(0)) and as the proxy delivers it. */
export function callbackPayload(version: number, originTx: Hex) {
  const encode = (sender: Address) =>
    encodeFunctionData({ abi: receiverAbi, functionName: "executeRepay", args: [sender, BigInt(version), originTx] });
  return { requested: encode("0x0000000000000000000000000000000000000000"), delivered: encode(contracts.reactiveRepay) };
}
