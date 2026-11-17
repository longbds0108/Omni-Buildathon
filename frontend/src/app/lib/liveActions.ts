/**
 * Transactions against the deployed contracts, sent from the connected wallet through wagmi. Each resolves to the
 * same Result the simulation returns, once the transaction is mined (or with the reason it failed).
 */
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Abi, type Address } from "viem";
import { getAccount, getPublicClient, switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { erc20Abi, oracleAbi, vaultAbi } from "./abis";
import { fmtMusd, fmtPct, fmtPrice, shortHex } from "./format";
import { CHAINS, manifest } from "./manifest";
import type { Result } from "./sim";
import { wagmiConfig } from "./wagmi";

let onMined: () => void = () => {};
export const setOnMined = (fn: () => void) => void (onMined = fn);

const MAX = 2n ** 256n - 1n;
const ok = (message: string): Result => ({ ok: true, message });
const fail = (message: string): Result => ({ ok: false, message });

const REVERTS: Record<string, (args: readonly unknown[]) => string> = {
  RatioTooLow: (a) => `Opening ratio would be ${fmtPct(a[0] as bigint)}. It must be at least 160%.`,
  StalePrice: () => "The oracle price is older than 15 minutes. The operator has to push a new price first.",
  InsufficientLiquidity: (a) => `The vault has only ${fmtMusd(a[1] as bigint)} mUSD to lend.`,
  PositionAlreadyOpen: () => "This wallet already has an open position.",
  NoOpenPosition: () => "There is no open position for this wallet.",
  AmountExceedsReserve: (a) => `That is more than the reserve of ${fmtMusd(a[1] as bigint)} mUSD.`,
  AmountExceedsDebt: (a) => `That is more than the debt of ${fmtMusd(a[1] as bigint)} mUSD.`,
  DebtOutstanding: (a) => `Repay the remaining ${fmtMusd(a[0] as bigint)} mUSD before closing.`,
  InvalidConfiguration: () => "Set a repay limit above zero before enabling protection.",
  ZeroAmount: () => "Enter an amount above zero.",
  ZeroPrice: () => "The oracle only accepts a positive price.",
  OwnableUnauthorizedAccount: () => "Only the oracle operator can push prices.",
  ERC20InsufficientAllowance: () => "Approve the token for the vault first.",
  ERC20InsufficientBalance: () => "Not enough tokens in the wallet.",
};

function explain(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name && REVERTS[name]) return REVERTS[name](rev?.data?.args ?? []);
    if (name) return `The contract rejected the call: ${name}.`;
    return e.shortMessage.split("\n")[0];
  }
  return (e as Error)?.message?.split("\n")[0] ?? "Transaction failed.";
}

type Who = "borrower" | "operator";
async function send(label: string, who: Who, req: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<Result> {
  const m = manifest;
  if (!m) return fail("No deployment loaded.");
  const acct = getAccount(wagmiConfig);
  if (!acct.address) return fail("Connect a wallet first.");
  const need = who === "borrower" ? m.borrower : m.base.operator;
  if (acct.address.toLowerCase() !== need.toLowerCase())
    return fail(
      who === "borrower"
        ? `This demo loan belongs to ${shortHex(m.borrower)}. Connect that wallet to act on it.`
        : `Only the oracle operator ${shortHex(m.base.operator)} can push prices.`,
    );
  if (acct.chainId !== m.base.chainId) {
    try {
      await switchChain(wagmiConfig, { chainId: m.base.chainId });
    } catch {
      return fail(`Switch your wallet to ${CHAINS.base.name} first.`);
    }
  }
  try {
    // Estimate first: a revert surfaces here with its reason, before the wallet asks for a signature. The 30% margin
    // covers estimates taken against the previous block (a node can price an SSTORE of the same timestamp as a no-op).
    const client = getPublicClient(wagmiConfig, { chainId: m.base.chainId });
    if (!client) return fail(`No RPC for ${CHAINS.base.name}.`);
    const gas = await client.estimateContractGas({ ...req, account: acct.address } as never);
    const hash = await writeContract(wagmiConfig, { ...req, chainId: m.base.chainId, gas: (gas * 13n) / 10n } as never);
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: m.base.chainId });
    onMined();
    return receipt.status === "success" ? ok(`${label} · confirmed in ${shortHex(hash)}`) : fail(`${label} reverted (${shortHex(hash)}).`);
  } catch (e) {
    return fail(explain(e));
  }
}

const vault = () => manifest!.base.vault;

export const liveActions = {
  pushPrice: (priceE6: bigint) =>
    send(`Price ${fmtPrice(priceE6)} pushed`, "operator", { address: manifest!.base.oracle, abi: oracleAbi, functionName: "setPrice", args: [priceE6] }),
  approve: (token: "collateral" | "musd") =>
    send(`${token === "collateral" ? "mCOL" : "mUSD"} approved`, "borrower", {
      address: token === "collateral" ? manifest!.base.collateral : manifest!.base.musd,
      abi: erc20Abi,
      functionName: "approve",
      args: [vault(), MAX],
    }),
  openPosition: (colE18: bigint, borrowE6: bigint) =>
    send("Position opened", "borrower", { address: vault(), abi: vaultAbi, functionName: "openPosition", args: [colE18, borrowE6] }),
  fundReserve: (a: bigint) => send(`Reserve funded with ${fmtMusd(a)} mUSD`, "borrower", { address: vault(), abi: vaultAbi, functionName: "fundReserve", args: [a] }),
  withdrawReserve: (a: bigint) =>
    send(`Withdrew ${fmtMusd(a)} mUSD`, "borrower", { address: vault(), abi: vaultAbi, functionName: "withdrawReserve", args: [a] }),
  configureProtection: (maxRepayE6: bigint, enabled: boolean) =>
    send(enabled ? "Protection on" : "Protection off", "borrower", {
      address: vault(),
      abi: vaultAbi,
      functionName: "configureProtection",
      args: [BigInt(manifest!.triggerPriceE6), maxRepayE6, enabled],
    }),
  repay: (a: bigint) => send(`Repaid ${fmtMusd(a)} mUSD`, "borrower", { address: vault(), abi: vaultAbi, functionName: "repay", args: [a] }),
  closePosition: () => send("Position closed", "borrower", { address: vault(), abi: vaultAbi, functionName: "closePosition" }),
};
