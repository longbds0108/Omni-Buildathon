/**
 * Live data source: reads the deployed contracts on Base Sepolia and Reactive Lasna (or the local anvil pair) and
 * rebuilds the same state shape the in-browser simulation produces, so every page works on either.
 * Runs are joined by oracle version + origin tx hash: PriceUpdated (Base) → RepayRequested (Lasna) → AutoRepaid or
 * CallbackSkipped (Base).
 */
import { createPublicClient, defineChain, http, type Address, type Hex, type PublicClient } from "viem";
import { erc20Abi, oracleAbi, reactiveAbi, SKIP_CHECK_INDEX, SKIP_REASONS, vaultAbi } from "./abis";
import { fmtCol, fmtMusd, fmtPrice } from "./format";
import type { ChainKey, Manifest } from "./manifest";
import { collateralValueE6, DEMO_TRIGGER_E6, targetDebtE6 } from "./math";
import type { Check, LogEvent, Position, Run, RunStatus, SimState, TxRef } from "./sim";

export interface SourceStatus {
  kind: "local" | "testnet";
  syncing: boolean;
  error?: string;
  syncedAt?: number;
  baseHead?: number;
  lasnaHead?: number;
}

type DecodedLog = {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
};

const CHECKS: [string, string][] = [
  ["Sender is the Base Sepolia callback proxy", "msg.sender matched the immutable proxy address"],
  ["Injected sender is ReactiveRepay", "first payload argument matched the Lasna contract"],
  ["Position is open", "borrower has an open position"],
  ["Protection is enabled", "rule is on"],
  ["Price is fresh", "under 15 minutes old"],
  ["Price is at or under the vault trigger", "within the vault's trigger"],
  ["Callback carries the newest oracle version", "latest version"],
  ["Not paid yet for this borrower and version", "first callback for this version"],
  ["Version is newer than the last configuration", "newer than the last rule change"],
  ["Repay amount is above zero", "debt above the 150% target and reserve available"],
];

export function chainOf(c: Manifest["base"] | Manifest["lasna"], symbol: string) {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [c.rpc] } },
    blockExplorers: c.explorer ? { default: { name: "Explorer", url: c.explorer } } : undefined,
  });
}

const eventsOf = (abi: readonly { type: string }[]) => abi.filter((x) => x.type === "event");
const lc = (s: string) => s.toLowerCase();
const ref = (l: DecodedLog, ts: number): TxRef => ({ tx: l.transactionHash, block: Number(l.blockNumber), ts });

function formatField(key: string, v: unknown): string {
  if (typeof v === "bigint") {
    const k = key.toLowerCase();
    if (k.includes("price") || k.includes("trigger")) return fmtPrice(v);
    if (k === "collateral" || k === "collateralreturned") return `${fmtCol(v)} mCOL`;
    if (/amount|debt|reserve|liquidity/.test(k)) return `${fmtMusd(v)} mUSD`;
    if (k.includes("version")) return `v${v}`;
    return v.toString();
  }
  if (key === "reason" && typeof v === "number") return SKIP_REASONS[v] ?? String(v);
  return String(v);
}

export class LiveSource {
  readonly m: Manifest;
  readonly base: PublicClient;
  readonly lasna: PublicClient;
  state: SimState;
  private listeners = new Set<() => void>();
  private baseLogs: DecodedLog[] = [];
  private lasnaLogs: DecodedLog[] = [];
  private nextBase: bigint;
  private nextLasna: bigint;
  private times = new Map<string, number>();
  private routeTrigger: bigint | null = null;
  private busy = false;
  // eth_getLogs block ranges. Base Sepolia makes a block every ~0.2 s, so wide ranges matter: publicnode accepts
  // 50,000 blocks, the official sepolia.base.org only 200. Lasna takes 20,000+. A refused range halves the chunk.
  private chunkBase: bigint;
  private chunkLasna: bigint;

  constructor(m: Manifest) {
    this.m = m;
    this.base = createPublicClient({ chain: chainOf(m.base, "ETH"), transport: http(m.base.rpc) }) as PublicClient;
    this.lasna = createPublicClient({ chain: chainOf(m.lasna, m.network === "local" ? "ETH" : "lREACT"), transport: http(m.lasna.rpc) }) as PublicClient;
    this.chunkBase = m.network === "local" ? 10_000n : /\/\/sepolia\.base\.org/.test(m.base.rpc) ? 200n : 50_000n;
    this.chunkLasna = 20_000n;
    this.nextBase = BigInt(m.base.deployBlock);
    this.nextLasna = BigInt(m.lasna.deployBlock);
    this.state = {
      schema: 2,
      anchor: { ts: 0, base: 0, lasna: 0 },
      oracle: { priceE6: 0n, version: 0, updatedAt: 0 },
      routeTriggerE6: BigInt(m.triggerPriceE6 || DEMO_TRIGGER_E6),
      position: { open: false, collateralE18: 0n, debtE6: 0n, reserveE6: 0n, triggerE6: DEMO_TRIGGER_E6, maxRepayE6: 0n, enabled: false, configVersion: 0 },
      liquidityE6: 0n,
      wallet: { colE18: 0n, musdE6: 0n, colApproved: false, musdApproved: false },
      runs: [],
      events: [],
      paid: [],
      requested: [],
      replaying: false,
      nextId: 0,
      source: { kind: m.network, syncing: true },
    };
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  get = () => this.state;
  private emit() {
    this.listeners.forEach((l) => l());
  }

  start() {
    void this.tick();
    window.setInterval(() => void this.tick(), this.m.network === "local" ? 1500 : 4000);
  }
  refreshSoon() {
    window.setTimeout(() => void this.tick(), 400);
  }

  /** getLogs in chunks from `from` to `to`; halves the chunk when an RPC refuses the range. */
  private async scan(client: PublicClient, which: "base" | "lasna", address: Address[], events: readonly unknown[], from: bigint, to: bigint) {
    const out: DecodedLog[] = [];
    let start = from;
    while (start <= to) {
      const size = which === "base" ? this.chunkBase : this.chunkLasna;
      const end = start + size - 1n > to ? to : start + size - 1n;
      try {
        const logs = await client.getLogs({ address, events: events as never, fromBlock: start, toBlock: end, strict: false });
        out.push(...(logs as unknown as DecodedLog[]));
        start = end + 1n;
      } catch (e) {
        if (size <= 50n) throw e;
        if (which === "base") this.chunkBase = size / 2n;
        else this.chunkLasna = size / 2n;
      }
    }
    return out;
  }

  private async timestamps(chain: ChainKey, client: PublicClient, blocks: bigint[]) {
    const missing = [...new Set(blocks.map(String))].filter((b) => !this.times.has(`${chain}:${b}`));
    for (let i = 0; i < missing.length; i += 8) {
      await Promise.all(
        missing.slice(i, i + 8).map(async (b) => {
          const blk = await client.getBlock({ blockNumber: BigInt(b) });
          this.times.set(`${chain}:${b}`, Number(blk.timestamp));
        }),
      );
    }
  }
  private ts(chain: ChainKey, block: bigint) {
    return this.times.get(`${chain}:${block}`) ?? 0;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    const m = this.m;
    try {
      const [headB, headL] = await Promise.all([this.base.getBlockNumber(), this.lasna.getBlockNumber()]);
      if (headB >= this.nextBase) {
        const logs = await this.scan(this.base, "base", [m.base.oracle, m.base.vault], [...eventsOf(oracleAbi), ...eventsOf(vaultAbi)], this.nextBase, headB);
        this.baseLogs.push(...logs);
        this.nextBase = headB + 1n;
      }
      if (headL >= this.nextLasna) {
        const logs = await this.scan(this.lasna, "lasna", [m.lasna.reactiveRepay], eventsOf(reactiveAbi), this.nextLasna, headL);
        this.lasnaLogs.push(...logs);
        this.nextLasna = headL + 1n;
      }
      if (this.routeTrigger === null) {
        this.routeTrigger = await this.lasna
          .readContract({ address: m.lasna.reactiveRepay, abi: reactiveAbi, functionName: "triggerPriceE6" })
          .catch(() => BigInt(m.triggerPriceE6));
      }
      const borrower = m.borrower;
      const [latest, pos, liquidity, colBal, musdBal, colAllow, musdAllow] = await Promise.all([
        this.base.readContract({ address: m.base.oracle, abi: oracleAbi, functionName: "latest" }),
        this.base.readContract({ address: m.base.vault, abi: vaultAbi, functionName: "positionOf", args: [borrower] }),
        this.base.readContract({ address: m.base.vault, abi: vaultAbi, functionName: "liquidity" }),
        this.base.readContract({ address: m.base.collateral, abi: erc20Abi, functionName: "balanceOf", args: [borrower] }),
        this.base.readContract({ address: m.base.musd, abi: erc20Abi, functionName: "balanceOf", args: [borrower] }),
        this.base.readContract({ address: m.base.collateral, abi: erc20Abi, functionName: "allowance", args: [borrower, m.base.vault] }),
        this.base.readContract({ address: m.base.musd, abi: erc20Abi, functionName: "allowance", args: [borrower, m.base.vault] }),
      ]);
      await this.timestamps("base", this.base, this.baseLogs.filter((l) => l.eventName !== "PriceUpdated").map((l) => l.blockNumber));
      await this.timestamps("lasna", this.lasna, this.lasnaLogs.map((l) => l.blockNumber));

      this.state = this.build(latest, pos, liquidity, { colBal, musdBal, colAllow, musdAllow }, Number(headB), Number(headL));
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? "RPC error";
      this.state = { ...this.state, source: { ...this.state.source!, syncing: false, error: msg.split("\n")[0] } };
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private build(
    latest: readonly [bigint, bigint, bigint],
    pos: { collateral: bigint; debt: bigint; reserve: bigint; triggerPriceE6: bigint; maxRepayAmount: bigint; configVersion: bigint; open: boolean; enabled: boolean },
    liquidity: bigint,
    w: { colBal: bigint; musdBal: bigint; colAllow: bigint; musdAllow: bigint },
    headB: number,
    headL: number,
  ): SimState {
    const m = this.m;
    const borrower = lc(m.borrower);
    const routeTrigger = this.routeTrigger ?? BigInt(m.triggerPriceE6);
    const key = (version: unknown, origin: unknown) => `${String(version)}:${lc(String(origin))}`;

    const requests = new Map<string, DecodedLog>();
    for (const l of this.lasnaLogs) if (l.eventName === "RepayRequested" && lc(String(l.args.borrower)) === borrower) requests.set(key(l.args.oracleVersion, l.args.originTxHash), l);
    const callbacks = new Map<string, DecodedLog>();
    for (const l of this.baseLogs)
      if ((l.eventName === "AutoRepaid" || l.eventName === "CallbackSkipped") && lc(String(l.args.borrower)) === borrower)
        callbacks.set(key(l.args.oracleVersion, l.args.originTxHash), l);

    const position: Position = {
      open: pos.open,
      collateralE18: pos.collateral,
      debtE6: pos.debt,
      reserveE6: pos.reserve,
      triggerE6: pos.triggerPriceE6 > 0n ? pos.triggerPriceE6 : routeTrigger,
      maxRepayE6: pos.maxRepayAmount,
      enabled: pos.enabled,
      configVersion: Number(pos.configVersion),
    };

    const runs: Run[] = this.baseLogs
      .filter((l) => l.eventName === "PriceUpdated")
      .map((l) => {
        const version = Number(l.args.version);
        const priceE6 = l.args.priceE6 as bigint;
        const origin: TxRef = { tx: l.transactionHash, block: Number(l.blockNumber), ts: Number(l.args.updatedAt) };
        const k = key(l.args.version, l.transactionHash);
        const req = requests.get(k);
        const cb = callbacks.get(k);
        const routeTriggered = priceE6 <= routeTrigger;
        const status: RunStatus = cb ? (cb.eventName === "AutoRepaid" ? "repaid" : "skipped") : req ? "requested" : routeTriggered ? "waiting" : "above";
        const run: Run = {
          version,
          priceE6,
          routeTriggered,
          origin,
          request: req ? ref(req, this.ts("lasna", req.blockNumber)) : undefined,
          callback: cb ? ref(cb, this.ts("base", cb.blockNumber)) : undefined,
          status,
          before: { open: pos.open, collateralE18: pos.collateral, debtE6: pos.debt, reserveE6: pos.reserve, maxRepayE6: pos.maxRepayAmount, enabled: pos.enabled, triggerE6: position.triggerE6 },
          pushedAtMs: origin.ts * 1000,
        };
        if (cb?.eventName === "AutoRepaid") {
          const a = cb.args as Record<string, bigint>;
          const target = targetDebtE6(collateralValueE6(pos.collateral, priceE6));
          const gap = a.debtBefore > target ? a.debtBefore - target : 0n;
          run.repay = {
            amountE6: a.amount,
            cap: a.amount === gap ? "gap" : a.amount === a.reserveBefore ? "reserve" : "limit",
            debtBeforeE6: a.debtBefore,
            debtAfterE6: a.debtAfter,
            reserveBeforeE6: a.reserveBefore,
            reserveAfterE6: a.reserveAfter,
          };
          run.before = { ...run.before, debtE6: a.debtBefore, reserveE6: a.reserveBefore };
          run.checks = CHECKS.map(([label, detail]) => ({ label, detail, state: "ok" }) as Check);
        } else if (cb) {
          const reason = Number(cb.args.reason);
          const at = SKIP_CHECK_INDEX[reason] ?? 9;
          run.skipReason = SKIP_REASONS[reason] ?? `reason ${reason}`;
          run.checks = CHECKS.map(([label, detail], i) => ({
            label,
            detail: i === at ? run.skipReason! : detail,
            state: i < at ? "ok" : i === at ? "fail" : "unreached",
          }));
        }
        return run;
      });

    const events: LogEvent[] = [
      ...this.baseLogs.map((l) => ({ l, chain: "base" as ChainKey })),
      ...this.lasnaLogs.map((l) => ({ l, chain: "lasna" as ChainKey })),
    ]
      .map(({ l, chain }, i) => ({
        id: i,
        chain,
        name: l.eventName,
        tx: l.transactionHash,
        block: Number(l.blockNumber),
        ts: l.eventName === "PriceUpdated" ? Number(l.args.updatedAt) : this.ts(chain, l.blockNumber),
        version: l.args.oracleVersion !== undefined ? Number(l.args.oracleVersion) : l.args.version !== undefined ? Number(l.args.version) : undefined,
        fields: Object.entries(l.args).map(([k, v]) => [k, formatField(k, v)] as [string, string]),
      }))
      .sort((a, b) => a.ts - b.ts || a.id - b.id);

    const approved = (x: bigint) => x >= 10n ** 36n;
    return {
      ...this.state,
      oracle: { priceE6: latest[0], version: Number(latest[1]), updatedAt: Number(latest[2]) },
      routeTriggerE6: routeTrigger,
      position,
      liquidityE6: liquidity,
      wallet: { colE18: w.colBal, musdE6: w.musdBal, colApproved: approved(w.colAllow), musdApproved: approved(w.musdAllow) },
      runs,
      events,
      paid: runs.filter((r) => r.status === "repaid").map((r) => r.version),
      requested: runs.filter((r) => r.request).map((r) => r.version),
      source: { kind: m.network, syncing: false, syncedAt: Date.now(), baseHead: headB, lasnaHead: headL },
    };
  }
}
