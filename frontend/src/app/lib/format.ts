import { E6 } from "./math";

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Fixed-point bigint to a grouped decimal string, truncated (never rounded up) to `frac` digits. */
export function fmtUnits(v: bigint, decimals: number, frac = 2): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = group((abs / base).toString());
  const f = frac > 0 ? "." + (abs % base).toString().padStart(decimals, "0").slice(0, frac) : "";
  return (neg ? "−" : "") + whole + f;
}

export const fmtMusd = (e6: bigint) => fmtUnits(e6, 6, 2);
export const fmtCol = (e18: bigint) => fmtUnits(e18, 18, 4).replace(/\.?0+$/, "") || "0";
/** $1,350 for whole prices, $1,350.25 otherwise. */
export const fmtPrice = (e6: bigint) => "$" + fmtUnits(e6, 6, e6 % E6 === 0n ? 0 : 2);
export const fmtUsd = (e6: bigint) => "$" + fmtUnits(e6, 6, 2);
export const fmtPct = (bps: bigint | null) => (bps === null ? "No debt" : `${fmtUnits(bps, 2, 2)}%`);
export const fmtPctShort = (bps: bigint | null) => (bps === null ? "No debt" : `${fmtUnits(bps, 2, 0)}%`);

export const shortHex = (h: string, head = 6, tail = 4) => (h.length <= head + tail + 2 ? h : `${h.slice(0, head + 2)}…${h.slice(-tail)}`);

export const fmtClock = (ts: number) => new Date(ts * 1000).toISOString().slice(11, 19) + " UTC";
export const fmtDate = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";

export function fmtAgo(ts: number, nowS: number): string {
  const d = Math.max(0, Math.floor(nowS - ts));
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ${d % 60}s ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export const fmtSeconds = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)}m ${s % 60}s`);
