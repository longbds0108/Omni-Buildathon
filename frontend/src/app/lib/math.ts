/**
 * The vault's integer math, mirrored with BigInt. Every division rounds down, exactly like Solidity.
 * mUSD and prices carry 6 decimals, the collateral token 18.
 */

export const E6 = 1_000_000n;
export const E18 = 10n ** 18n;
export const BPS = 10_000n;

export const OPEN_MIN_BPS = 16_000n; // openPosition reverts under 160%
export const TARGET_BPS = 15_000n; // a repay brings the position back to 150%
export const LIQ_BPS = 12_000n; // display only: Simulated liquidation line
export const DEMO_TRIGGER_E6 = 1_350n * E6; // $1,350, both on the vault and on the Lasna route
export const FRESHNESS_S = 15 * 60; // a price older than 15 minutes is stale

export const collateralValueE6 = (collateralE18: bigint, priceE6: bigint) => (collateralE18 * priceE6) / E18;

/** null means No debt. */
export const ratioBps = (valueE6: bigint, debtE6: bigint): bigint | null => (debtE6 === 0n ? null : (valueE6 * BPS) / debtE6);

export const targetDebtE6 = (valueE6: bigint) => (valueE6 * BPS) / TARGET_BPS;

export const minBig = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

export type RepayCap = "gap" | "limit" | "reserve" | "none";

export interface RepayPlan {
  valueE6: bigint;
  ratioBps: bigint | null;
  targetDebtE6: bigint;
  gapE6: bigint;
  amountE6: bigint;
  cap: RepayCap;
  debtAfterE6: bigint;
  reserveAfterE6: bigint;
  ratioAfterBps: bigint | null;
}

/** amount = min(debt − targetDebt, reserve, maxRepayAmount) when debt is above the target, else 0. */
export function repayPlan(p: { collateralE18: bigint; debtE6: bigint; reserveE6: bigint; maxRepayE6: bigint; priceE6: bigint }): RepayPlan {
  const valueE6 = collateralValueE6(p.collateralE18, p.priceE6);
  const target = targetDebtE6(valueE6);
  const gap = p.debtE6 > target ? p.debtE6 - target : 0n;
  const amount = gap === 0n ? 0n : minBig(gap, p.reserveE6, p.maxRepayE6);
  const cap: RepayCap = amount === 0n ? "none" : amount === gap ? "gap" : amount === p.maxRepayE6 ? "limit" : "reserve";
  const debtAfter = p.debtE6 - amount;
  return {
    valueE6,
    ratioBps: ratioBps(valueE6, p.debtE6),
    targetDebtE6: target,
    gapE6: gap,
    amountE6: amount,
    cap,
    debtAfterE6: debtAfter,
    reserveAfterE6: p.reserveE6 - amount,
    ratioAfterBps: ratioBps(valueE6, debtAfter),
  };
}

/** The price (6 decimals) at which the position sits exactly at `bps`. */
export function priceAtRatioE6(collateralE18: bigint, debtE6: bigint, bps: bigint): bigint | null {
  if (collateralE18 === 0n || debtE6 === 0n) return null;
  return (debtE6 * bps * E18) / (BPS * collateralE18);
}

/** "1,350.5" -> 1350500000n for 6 decimals; null for anything that is not a non-negative decimal that fits. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const m = /^\s*(\d{0,15})(?:\.(\d*))?\s*$/.exec(text.replace(/,/g, ""));
  if (!m || (m[1] === "" && !m[2])) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
