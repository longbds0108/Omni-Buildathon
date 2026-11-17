import { useEffect, useState, useSyncExternalStore } from "react";
import * as sim from "./sim";
import type { Result, SimState } from "./sim";
import { E18, E6 } from "./math";
import { manifest } from "./manifest";
import { LiveSource } from "./live";
import { liveActions, setOnMined } from "./liveActions";

export type Outcome = Result | Promise<Result>;

/** With a deploy manifest the dashboard reads the contracts; without one it runs the in-browser simulation. */
export const live = manifest ? new LiveSource(manifest) : null;
if (live) {
  live.start();
  setOnMined(() => live.refreshSoon());
}
const onChainOnly: Result = { ok: false, message: "Scenario controls only exist in the in-browser Local simulation." };

/* One simulation per tab. Runs advance on timers: Lasna reacts 1.4–2.6 s after the price log, the callback lands
   1.8–3.2 s later, roughly the pace of the real loop. */

let state: SimState = sim.load() ?? sim.acceptanceState(Date.now());
const listeners = new Set<() => void>();
let timers: number[] = [];

const emit = () => listeners.forEach((l) => l());
function replace(next: SimState) {
  state = next;
  sim.save(next);
  emit();
}
function commit<R>(fn: (draft: SimState) => R): R {
  const draft = structuredClone(state);
  const r = fn(draft);
  replace(draft);
  return r;
}
function schedule(fn: () => void, ms: number) {
  const id = window.setTimeout(() => {
    timers = timers.filter((t) => t !== id);
    fn();
  }, ms);
  timers.push(id);
}
function cancelAll() {
  timers.forEach(clearTimeout);
  timers = [];
}
const jitter = (a: number, b: number) => Math.round(a + Math.random() * (b - a));

function drive(version: number, reactIn = jitter(1400, 2600), callbackIn = jitter(1800, 3200)) {
  schedule(() => {
    commit((d) => sim.react(d, version, Date.now()));
    schedule(() => commit((d) => sim.callback(d, version, Date.now())), callbackIn);
  }, reactIn);
}

// A run left mid-flight by a reload finishes now.
for (const r of live ? [] : state.runs) {
  if (r.status === "waiting") drive(r.version, 500, 1500);
  if (r.status === "requested") schedule(() => commit((d) => sim.callback(d, r.version, Date.now())), 800);
}
if (!live && state.replaying) commit((d) => void (d.replaying = false));

const now = () => Date.now();
function pushPrice(priceE6: bigint): Result {
  const r = commit((d) => sim.pushPrice(d, priceE6, now()));
  const run = state.runs[state.runs.length - 1];
  if (r.ok && run.status === "waiting") drive(run.version);
  return r;
}

const simActions = {
  pushPrice,
  approve: (token: "collateral" | "musd") => commit((d) => sim.approve(d, token, now())),
  openPosition: (colE18: bigint, borrowE6: bigint) => commit((d) => sim.openPosition(d, colE18, borrowE6, now())),
  fundReserve: (a: bigint) => commit((d) => sim.fundReserve(d, a, now())),
  withdrawReserve: (a: bigint) => commit((d) => sim.withdrawReserve(d, a, now())),
  configureProtection: (maxRepayE6: bigint, enabled: boolean) => commit((d) => sim.configureProtection(d, maxRepayE6, enabled, now())),
  repay: (a: bigint) => commit((d) => sim.repay(d, a, now())),
  closePosition: () => commit((d) => sim.closePosition(d, now())),
};

export const actions: { [K in keyof typeof simActions]: (...args: Parameters<(typeof simActions)[K]>) => Outcome } & {
  reset: () => Result;
  loadAcceptance: () => Result;
  replay: () => Result;
} = {
  pushPrice: (p) => (live ? liveActions.pushPrice(p) : simActions.pushPrice(p)),
  approve: (t) => (live ? liveActions.approve(t) : simActions.approve(t)),
  openPosition: (c, b) => (live ? liveActions.openPosition(c, b) : simActions.openPosition(c, b)),
  fundReserve: (a) => (live ? liveActions.fundReserve(a) : simActions.fundReserve(a)),
  withdrawReserve: (a) => (live ? liveActions.withdrawReserve(a) : simActions.withdrawReserve(a)),
  configureProtection: (m, e) => (live ? liveActions.configureProtection(m, e) : simActions.configureProtection(m, e)),
  repay: (a) => (live ? liveActions.repay(a) : simActions.repay(a)),
  closePosition: () => (live ? liveActions.closePosition() : simActions.closePosition()),
  reset(): Result {
    if (live) return onChainOnly;
    cancelAll();
    replace(sim.freshState(now()));
    return { ok: true, message: "Demo reset: price $1,800, no position." };
  },
  loadAcceptance(): Result {
    if (live) return onChainOnly;
    cancelAll();
    replace(sim.acceptanceState(now()));
    return { ok: true, message: "Loaded the finished acceptance scenario." };
  },
  /** Plays the acceptance scenario live: setup at $1,800, then $1,400, then $1,350. */
  replay(): Result {
    if (live) return onChainOnly;
    cancelAll();
    const s = sim.freshState(now());
    s.replaying = true;
    replace(s);
    schedule(() => commit((d) => sim.setup(d, now())), 700);
    schedule(() => pushPrice(1_400n * E6), 3_500);
    schedule(() => pushPrice(1_350n * E6), 8_000);
    schedule(() => commit((d) => void (d.replaying = false)), 15_000);
    return { ok: true, message: "Replaying: setup, then $1,400, then $1,350." };
  },
};

export const DEMO_POSITION = { collateralE18: E18, debtE6: 1_000n * E6, reserveE6: 150n * E6, maxRepayE6: 120n * E6 };

const simSubscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export function useSim(): SimState {
  return useSyncExternalStore(live ? live.subscribe : simSubscribe, live ? live.get : () => state);
}

/** Seconds since epoch, re-rendering every second. */
export function useNow(): number {
  const [t, setT] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}
