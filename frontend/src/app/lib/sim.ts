/**
 * Local simulation of the whole loop: MockOracle and LendingVault on Base Sepolia, ReactiveRepay on Lasna, the
 * callback through the proxy and RepayReceiver. It applies the vault's rules in the vault's order, so every number on
 * the dashboard is what the contracts would produce. Everything it creates is labeled Local simulation.
 */
import type { Hex } from "viem";
import { DEMO_TRIGGER_E6, E18, E6, FRESHNESS_S, OPEN_MIN_BPS, collateralValueE6, ratioBps, repayPlan, type RepayCap } from "./math";
import { fmtCol, fmtMusd, fmtPct, fmtPrice } from "./format";
import { contracts, type ChainKey } from "./manifest";
import type { SourceStatus } from "./live";

export type RunStatus = "above" | "waiting" | "requested" | "repaid" | "skipped";
export const STATUS_LABEL: Record<RunStatus, string> = {
  above: "Above trigger",
  waiting: "Waiting for reaction",
  requested: "Callback requested",
  repaid: "Debt repaid",
  skipped: "Callback skipped",
};

export interface TxRef { tx: Hex; block: number; ts: number }
export type CheckState = "ok" | "fail" | "unreached";
export interface Check { label: string; state: CheckState; detail: string }

export interface Snapshot {
  open: boolean;
  collateralE18: bigint;
  debtE6: bigint;
  reserveE6: bigint;
  maxRepayE6: bigint;
  enabled: boolean;
  triggerE6: bigint;
}

export interface Run {
  version: number;
  priceE6: bigint;
  routeTriggered: boolean;
  origin: TxRef;
  request?: TxRef;
  callback?: TxRef;
  status: RunStatus;
  before: Snapshot;
  repay?: { amountE6: bigint; cap: RepayCap; debtBeforeE6: bigint; debtAfterE6: bigint; reserveBeforeE6: bigint; reserveAfterE6: bigint };
  skipReason?: string;
  checks?: Check[];
  pushedAtMs: number;
  requestAtMs?: number;
  callbackAtMs?: number;
}

export interface LogEvent { id: number; chain: ChainKey; name: string; tx: Hex; block: number; ts: number; version?: number; fields: [string, string][] }

export interface Position {
  open: boolean;
  collateralE18: bigint;
  debtE6: bigint;
  reserveE6: bigint;
  triggerE6: bigint;
  maxRepayE6: bigint;
  enabled: boolean;
  configVersion: number;
}

export interface SimState {
  schema: 2;
  anchor: { ts: number; base: number; lasna: number };
  oracle: { priceE6: bigint; version: number; updatedAt: number };
  routeTriggerE6: bigint;
  position: Position;
  liquidityE6: bigint;
  wallet: { colE18: bigint; musdE6: bigint; colApproved: boolean; musdApproved: boolean };
  runs: Run[];
  events: LogEvent[];
  paid: number[];
  requested: number[];
  replaying: boolean;
  nextId: number;
  /** Present when the state comes from deployed contracts rather than the in-browser simulation. */
  source?: SourceStatus;
}

export type Result = { ok: true; message: string } | { ok: false; message: string };
const ok = (message: string): Result => ({ ok: true, message });
const fail = (message: string): Result => ({ ok: false, message });

/* ───────── Clock: Base Sepolia makes a block every 2 seconds; the Lasna clock here ticks once a second ───────── */

const BASE_BLOCK_S = 2;
function ref(s: SimState, chain: ChainKey, ms: number): TxRef {
  const ts = Math.floor(ms / 1000);
  const step = chain === "base" ? BASE_BLOCK_S : 1;
  const n = Math.floor((ts - s.anchor.ts) / step);
  return { tx: randomHash(), block: s.anchor[chain] + n, ts: s.anchor.ts + n * step };
}
function randomHash(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function log(s: SimState, chain: ChainKey, name: string, at: TxRef, fields: [string, string][], version?: number) {
  s.events.push({ id: s.nextId++, chain, name, tx: at.tx, block: at.block, ts: at.ts, version, fields });
}

const snapshot = (p: Position): Snapshot => ({
  open: p.open,
  collateralE18: p.collateralE18,
  debtE6: p.debtE6,
  reserveE6: p.reserveE6,
  maxRepayE6: p.maxRepayE6,
  enabled: p.enabled,
  triggerE6: p.triggerE6,
});

const emptyPosition = (configVersion: number): Position => ({
  open: false,
  collateralE18: 0n,
  debtE6: 0n,
  reserveE6: 0n,
  triggerE6: DEMO_TRIGGER_E6,
  maxRepayE6: 0n,
  enabled: false,
  configVersion,
});

export const isFresh = (s: SimState, nowS: number) => nowS - s.oracle.updatedAt <= FRESHNESS_S;

/* ───────── Base Sepolia: operator, token and vault calls ───────── */

export function pushPrice(s: SimState, priceE6: bigint, ms: number): Result {
  if (priceE6 <= 0n) return fail("The oracle only accepts a positive price.");
  const at = ref(s, "base", ms);
  const version = s.oracle.version + 1;
  s.oracle = { priceE6, version, updatedAt: at.ts };
  log(s, "base", "PriceUpdated", at, [["version", String(version)], ["priceE6", priceE6.toString()], ["updatedAt", String(at.ts)]], version);
  const routeTriggered = priceE6 <= s.routeTriggerE6;
  s.runs.push({
    version,
    priceE6,
    routeTriggered,
    origin: at,
    status: routeTriggered ? "waiting" : "above",
    before: snapshot(s.position),
    pushedAtMs: ms,
  });
  return ok(`Oracle v${version} set to ${fmtPrice(priceE6)}.`);
}

export function approve(s: SimState, token: "collateral" | "musd", ms: number): Result {
  const at = ref(s, "base", ms);
  if (token === "collateral") s.wallet.colApproved = true;
  else s.wallet.musdApproved = true;
  log(s, "base", "Approval", at, [["token", token === "collateral" ? "mCOL" : "mUSD"], ["spender", "LendingVault"], ["amount", "max"]]);
  return ok(`${token === "collateral" ? "mCOL" : "mUSD"} approved for the vault.`);
}

export function openPosition(s: SimState, collateralE18: bigint, borrowE6: bigint, ms: number): Result {
  const p = s.position;
  if (p.open) return fail("A position is already open.");
  if (collateralE18 === 0n || borrowE6 === 0n) return fail("Collateral and borrow amount must be above zero.");
  if (!s.wallet.colApproved) return fail("Approve mCOL first.");
  if (collateralE18 > s.wallet.colE18) return fail("Not enough mCOL in the wallet.");
  if (borrowE6 > s.liquidityE6) return fail("The vault does not have that much mUSD to lend.");
  if (!isFresh(s, ms / 1000)) return fail("The oracle price is older than 15 minutes. Push a new price first.");
  const r = ratioBps(collateralValueE6(collateralE18, s.oracle.priceE6), borrowE6)!;
  if (r < OPEN_MIN_BPS) return fail(`Opening ratio would be ${fmtPct(r)}. It must be at least 160%.`);
  s.wallet.colE18 -= collateralE18;
  s.wallet.musdE6 += borrowE6;
  s.liquidityE6 -= borrowE6;
  Object.assign(p, { open: true, collateralE18, debtE6: borrowE6, configVersion: s.oracle.version });
  const at = ref(s, "base", ms);
  log(s, "base", "PositionOpened", at, [["borrower", contracts.borrower], ["collateral", `${fmtCol(collateralE18)} mCOL`], ["debt", `${fmtMusd(borrowE6)} mUSD`], ["ratio", fmtPct(r)]]);
  return ok(`Position opened at ${fmtPct(r)}.`);
}

export function fundReserve(s: SimState, amountE6: bigint, ms: number): Result {
  if (amountE6 === 0n) return fail("Enter an amount above zero.");
  if (!s.wallet.musdApproved) return fail("Approve mUSD first.");
  if (amountE6 > s.wallet.musdE6) return fail("Not enough mUSD in the wallet.");
  s.wallet.musdE6 -= amountE6;
  s.position.reserveE6 += amountE6;
  log(s, "base", "ReserveFunded", ref(s, "base", ms), [["borrower", contracts.borrower], ["amount", `${fmtMusd(amountE6)} mUSD`], ["reserve", `${fmtMusd(s.position.reserveE6)} mUSD`]]);
  return ok(`Reserve is now ${fmtMusd(s.position.reserveE6)} mUSD.`);
}

export function withdrawReserve(s: SimState, amountE6: bigint, ms: number): Result {
  if (amountE6 === 0n) return fail("Enter an amount above zero.");
  if (amountE6 > s.position.reserveE6) return fail("That is more than your reserve.");
  s.position.reserveE6 -= amountE6;
  s.wallet.musdE6 += amountE6;
  log(s, "base", "ReserveWithdrawn", ref(s, "base", ms), [["borrower", contracts.borrower], ["amount", `${fmtMusd(amountE6)} mUSD`], ["reserve", `${fmtMusd(s.position.reserveE6)} mUSD`]]);
  return ok(`Withdrew ${fmtMusd(amountE6)} mUSD. Reserve is ${fmtMusd(s.position.reserveE6)} mUSD.`);
}

export function configureProtection(s: SimState, maxRepayE6: bigint, enabled: boolean, ms: number): Result {
  const p = s.position;
  if (!p.open) return fail("Open a position before configuring protection.");
  if (enabled && maxRepayE6 === 0n) return fail("Set a repay limit above zero before enabling protection.");
  Object.assign(p, { maxRepayE6, enabled, triggerE6: DEMO_TRIGGER_E6, configVersion: Math.max(p.configVersion, s.oracle.version) });
  log(s, "base", "ProtectionConfigured", ref(s, "base", ms), [
    ["borrower", contracts.borrower],
    ["triggerPriceE6", p.triggerE6.toString()],
    ["maxRepayAmount", `${fmtMusd(maxRepayE6)} mUSD`],
    ["enabled", String(enabled)],
    ["configVersion", String(p.configVersion)],
  ]);
  return ok(enabled ? `Protection on. Up to ${fmtMusd(maxRepayE6)} mUSD per callback.` : "Protection off.");
}

export function repay(s: SimState, amountE6: bigint, ms: number): Result {
  const p = s.position;
  if (!p.open) return fail("No open position.");
  if (amountE6 === 0n) return fail("Enter an amount above zero.");
  if (!s.wallet.musdApproved) return fail("Approve mUSD first.");
  if (amountE6 > p.debtE6) return fail("That is more than the debt.");
  if (amountE6 > s.wallet.musdE6) return fail("Not enough mUSD in the wallet.");
  s.wallet.musdE6 -= amountE6;
  p.debtE6 -= amountE6;
  s.liquidityE6 += amountE6;
  log(s, "base", "Repaid", ref(s, "base", ms), [["borrower", contracts.borrower], ["amount", `${fmtMusd(amountE6)} mUSD`], ["debt", `${fmtMusd(p.debtE6)} mUSD`]]);
  return ok(`Repaid ${fmtMusd(amountE6)} mUSD. Debt is ${fmtMusd(p.debtE6)} mUSD.`);
}

export function closePosition(s: SimState, ms: number): Result {
  const p = s.position;
  if (!p.open) return fail("No open position.");
  if (p.debtE6 !== 0n) return fail("Repay the whole debt before closing.");
  s.wallet.colE18 += p.collateralE18;
  s.wallet.musdE6 += p.reserveE6;
  log(s, "base", "PositionClosed", ref(s, "base", ms), [["borrower", contracts.borrower], ["collateralReturned", `${fmtCol(p.collateralE18)} mCOL`], ["reserveReturned", `${fmtMusd(p.reserveE6)} mUSD`]]);
  s.position = emptyPosition(Math.max(p.configVersion, s.oracle.version));
  return ok("Position closed. Collateral and reserve are back in the wallet.");
}

/* ───────── Lasna: ReactiveRepay.react() ───────── */

export function react(s: SimState, version: number, ms: number): void {
  const run = s.runs.find((r) => r.version === version);
  if (!run || run.status !== "waiting") return;
  if (s.requested.includes(version)) return; // one request per oracle version
  const at = ref(s, "lasna", ms);
  s.requested.push(version);
  run.request = at;
  run.requestAtMs = ms;
  run.status = "requested";
  log(s, "lasna", "RepayRequested", at, [["originTxHash", run.origin.tx], ["oracleVersion", String(version)], ["borrower", contracts.borrower]], version);
}

/* ───────── Base Sepolia: proxy → RepayReceiver.executeRepay → LendingVault.autoRepay ───────── */

export function callback(s: SimState, version: number, ms: number): void {
  const run = s.runs.find((r) => r.version === version);
  if (!run || run.status !== "requested") return;
  const at = ref(s, "base", ms);
  const p = s.position;
  const plan = repayPlan({ collateralE18: p.collateralE18, debtE6: p.debtE6, reserveE6: p.reserveE6, maxRepayE6: p.maxRepayE6, priceE6: s.oracle.priceE6 });
  const age = at.ts - s.oracle.updatedAt;
  const raw: [string, boolean, string][] = [
    ["Sender is the Base Sepolia callback proxy", true, "msg.sender matches the immutable proxy address"],
    ["Injected sender is ReactiveRepay", true, "first payload argument matches the Lasna contract"],
    ["Position is open", p.open, p.open ? "borrower has an open position" : "no open position"],
    ["Protection is enabled", p.enabled, p.enabled ? "rule is on" : "rule is off"],
    ["Price is fresh", age <= FRESHNESS_S, `updated ${age}s before the callback, limit ${FRESHNESS_S}s`],
    ["Price is at or under the vault trigger", s.oracle.priceE6 <= p.triggerE6, `${fmtPrice(s.oracle.priceE6)} vs ${fmtPrice(p.triggerE6)}`],
    ["Callback carries the newest oracle version", version === s.oracle.version, version === s.oracle.version ? `v${version} is the latest` : `oracle is already at v${s.oracle.version}`],
    ["Not paid yet for this borrower and version", !s.paid.includes(version), s.paid.includes(version) ? `v${version} was already paid` : "first callback for this version"],
    ["Version is newer than the last configuration", version > p.configVersion, `v${version} vs configuration at v${p.configVersion}`],
    [
      "Repay amount is above zero",
      plan.amountE6 > 0n,
      plan.amountE6 > 0n ? `${fmtMusd(plan.amountE6)} mUSD` : plan.gapE6 === 0n ? "debt is at or under the 150% target" : "reserve is empty",
    ],
  ];
  const firstFail = raw.findIndex(([, pass]) => !pass);
  run.checks = raw.map(([label, pass, detail], i) => ({
    label,
    detail,
    state: firstFail === -1 || i < firstFail ? "ok" : i === firstFail ? (pass ? "ok" : "fail") : "unreached",
  }));
  run.callback = at;
  run.callbackAtMs = ms;

  if (firstFail !== -1) {
    run.status = "skipped";
    run.skipReason = raw[firstFail][2];
    log(s, "base", "CallbackSkipped", at, [["borrower", contracts.borrower], ["originTxHash", run.origin.tx], ["oracleVersion", String(version)], ["reason", run.skipReason]], version);
    return;
  }
  const before = { debt: p.debtE6, reserve: p.reserveE6 };
  p.debtE6 -= plan.amountE6;
  p.reserveE6 -= plan.amountE6;
  s.liquidityE6 += plan.amountE6;
  s.paid.push(version);
  run.status = "repaid";
  run.repay = { amountE6: plan.amountE6, cap: plan.cap, debtBeforeE6: before.debt, debtAfterE6: p.debtE6, reserveBeforeE6: before.reserve, reserveAfterE6: p.reserveE6 };
  log(s, "base", "AutoRepaid", at, [
    ["borrower", contracts.borrower],
    ["originTxHash", run.origin.tx],
    ["oracleVersion", String(version)],
    ["priceE6", s.oracle.priceE6.toString()],
    ["amount", `${fmtMusd(plan.amountE6)} mUSD`],
    ["debtBefore → after", `${fmtMusd(before.debt)} → ${fmtMusd(p.debtE6)}`],
    ["reserveBefore → after", `${fmtMusd(before.reserve)} → ${fmtMusd(p.reserveE6)}`],
  ], version);
}

/* ───────── Starting states ───────── */

/** Price at $1,800 (v1), vault liquidity seeded, demo wallet holding 5 mCOL and 1,000 mUSD, no position. */
export function freshState(ms: number): SimState {
  const ts = Math.floor(ms / 1000) - 600;
  const s: SimState = {
    schema: 2,
    anchor: { ts: ts - (ts % 2), base: 18_420_000, lasna: 2_150_000 },
    oracle: { priceE6: 0n, version: 0, updatedAt: 0 },
    routeTriggerE6: DEMO_TRIGGER_E6,
    position: emptyPosition(0),
    liquidityE6: 0n,
    wallet: { colE18: 5n * E18, musdE6: 1_000n * E6, colApproved: false, musdApproved: false },
    runs: [],
    events: [],
    paid: [],
    requested: [],
    replaying: false,
    nextId: 1,
  };
  s.liquidityE6 = 10_000n * E6;
  log(s, "base", "LiquiditySeeded", ref(s, "base", ms), [["operator", "deployer"], ["amount", "10,000.00 mUSD"]]);
  pushPrice(s, 1_800n * E6, ms);
  return s;
}

/** The acceptance scenario, already played: setup at $1,800, $1,400 with no request, $1,350 repaid to 150%. */
export function acceptanceState(nowMs: number): SimState {
  const t0 = nowMs - 9 * 60_000;
  const s = freshState(t0);
  setup(s, t0 + 20_000);
  pushPrice(s, 1_400n * E6, nowMs - 6 * 60_000);
  const t3 = nowMs - 3 * 60_000;
  pushPrice(s, 1_350n * E6, t3);
  react(s, s.oracle.version, t3 + 2_100);
  callback(s, s.oracle.version, t3 + 4_300);
  return s;
}

export function setup(s: SimState, ms: number) {
  approve(s, "collateral", ms);
  openPosition(s, E18, 1_000n * E6, ms + 2_000);
  approve(s, "musd", ms + 4_000);
  fundReserve(s, 150n * E6, ms + 6_000);
  configureProtection(s, 120n * E6, true, ms + 8_000);
}

/* ───────── Persistence (BigInt-safe JSON) ───────── */

const KEY = "xlmflow.local-simulation.v2";
export function save(s: SimState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? `big:${v}` : v)));
  } catch {
    /* storage unavailable: the simulation still runs for this visit */
  }
}
export function load(): SimState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw, (_k, v) => (typeof v === "string" && /^big:-?\d+$/.test(v) ? BigInt(v.slice(4)) : v)) as SimState;
    return s.schema === 2 ? s : null;
  } catch {
    return null;
  }
}
