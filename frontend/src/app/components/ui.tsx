import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Hex } from "viem";
import { fmtClock, fmtPct, fmtSeconds, shortHex } from "../lib/format";
import { CHAINS, isLocalSimulation, txUrl, type ChainKey } from "../lib/manifest";
import type { Outcome } from "../lib/store";
import type { Result } from "../lib/sim";
import { LIQ_BPS, OPEN_MIN_BPS, TARGET_BPS } from "../lib/math";
import { STATUS_LABEL, type Run, type RunStatus } from "../lib/sim";

/* ───────── Layout atoms ───────── */

export function PageHead({ eyebrow, title, lead, children }: { eyebrow: string; title: ReactNode; lead: ReactNode; children?: ReactNode }) {
  return (
    <header className="phead">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      {children && <div className="phead__actions">{children}</div>}
    </header>
  );
}

export function Card({ title, note, actions, className = "", children }: { title?: ReactNode; note?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card__head">
          <div>
            {title && <h2>{title}</h2>}
            {note && <p className="card__note">{note}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" | "brand" }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ""}`}>
      <span className="stat__label">{label}</span>
      <strong className="stat__value mono">{value}</strong>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

export function Row({ k, v, mono = true }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <b className={mono ? "mono" : ""}>{v}</b>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

/* ───────── Status ───────── */

const STATUS_TONE: Record<RunStatus, string> = { above: "muted", waiting: "warn", requested: "brand", repaid: "ok", skipped: "bad" };
export function StatusChip({ status }: { status: RunStatus }) {
  return (
    <span className={`pill pill--${STATUS_TONE[status]} ${status === "waiting" || status === "requested" ? "is-live" : ""}`}>
      <i />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Pill({ tone = "muted", live, children }: { tone?: "muted" | "ok" | "warn" | "bad" | "brand"; live?: boolean; children: ReactNode }) {
  return (
    <span className={`pill pill--${tone} ${live ? "is-live" : ""}`}>
      <i />
      {children}
    </span>
  );
}

export function SimTag() {
  return isLocalSimulation ? <span className="simtag" title="Same math and checks as the contracts. Nothing here is on chain.">Local simulation</span> : null;
}

/* ───────── Hashes ───────── */

export function TxHash({ hash, chain, full }: { hash?: Hex; chain: ChainKey; full?: boolean }) {
  if (!hash) return <span className="dim">not observed yet</span>;
  const text = full ? hash : shortHex(hash);
  const url = txUrl(chain, hash);
  if (!url)
    return (
      <span className="hash mono" title={`${CHAINS[chain].name}${isLocalSimulation ? " · Local simulation" : ""} · ${hash}`}>
        {text}
      </span>
    );
  return (
    <a className="hash mono" href={url} target="_blank" rel="noreferrer" title={`Open on ${CHAINS[chain].name} explorer`}>
      {text}&nbsp;↗
    </a>
  );
}

/* ───────── Ratio meter: 100% → 200%, with the three rule lines ───────── */

const LO = 10_000n;
const HI = 20_000n;
const pos = (bps: bigint) => Number(((bps < LO ? LO : bps > HI ? HI : bps) - LO) * 1000n / (HI - LO)) / 10;
export const ratioTone = (bps: bigint | null) => (bps === null ? "ok" : bps < LIQ_BPS ? "bad" : bps < TARGET_BPS ? "warn" : "ok");

export function RatioMeter({ bps, after }: { bps: bigint | null; after?: bigint | null }) {
  const marks: [bigint, string][] = [
    [LIQ_BPS, "Simulated liquidation line"],
    [TARGET_BPS, "Target"],
    [OPEN_MIN_BPS, "Open minimum"],
  ];
  return (
    <div className="meter" role="img" aria-label={`Collateral ratio ${fmtPct(bps)}`}>
      <div className="meter__track">
        <div className={`meter__fill meter__fill--${ratioTone(bps)}`} style={{ width: `${bps === null ? 100 : pos(bps)}%` }} />
        {after != null && after !== bps && <div className="meter__after" style={{ left: `${pos(after)}%` }} title={`After repay ${fmtPct(after)}`} />}
        {marks.map(([m, label]) => (
          <span key={label} className={`meter__mark ${m === LIQ_BPS ? "is-liq" : ""}`} style={{ left: `${pos(m)}%` }}>
            <em>{fmtPct(m).replace(".00", "")}</em>
          </span>
        ))}
      </div>
      <div className="meter__scale mono">
        <span>100%</span>
        <span className="meter__liq">120% Simulated liquidation line</span>
        <span>200%+</span>
      </div>
    </div>
  );
}

/* ───────── The three steps of a run ───────── */

export function RunSteps({ run, compact }: { run: Run; compact?: boolean }) {
  const reqState = !run.routeTriggered ? "none" : run.request ? "done" : "wait";
  const cbState = !run.routeTriggered ? "none" : run.callback ? (run.status === "repaid" ? "done" : "skip") : run.request ? "wait" : "idle";
  const steps = [
    { name: "Price update", chain: CHAINS.base.name, state: "done", hash: run.origin.tx, c: "base" as ChainKey, ts: run.origin.ts },
    { name: "Reactive request", chain: CHAINS.lasna.name, state: reqState, hash: run.request?.tx, c: "lasna" as ChainKey, ts: run.request?.ts },
    { name: "Callback", chain: CHAINS.base.name, state: cbState, hash: run.callback?.tx, c: "base" as ChainKey, ts: run.callback?.ts },
  ];
  const note = (st: string) =>
    st === "none" ? "no request: price above the route trigger" : st === "wait" ? "waiting…" : st === "idle" ? "not observed yet" : st === "skip" ? "skipped by the vault" : null;
  return (
    <ol className={`steps ${compact ? "steps--compact" : ""}`}>
      {steps.map((s) => (
        <li key={s.name} className={`step step--${s.state}`}>
          <span className="step__dot" />
          <div>
            <b>{s.name}</b>
            <span className="step__chain">{s.chain}</span>
            {s.hash ? (
              <span className="step__meta">
                <TxHash hash={s.hash} chain={s.c} /> {!compact && s.ts && <span className="dim">· {fmtClock(s.ts)}</span>}
              </span>
            ) : (
              <span className="step__meta dim">{note(s.state)}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export const latencyOf = (run: Run) => (run.callback ? run.callback.ts - run.origin.ts : null);
export const fmtLatency = (run: Run) => {
  const l = latencyOf(run);
  return l === null ? "—" : fmtSeconds(l);
};

export function RunLink({ run, children }: { run: Run; children?: ReactNode }) {
  return <Link to={`/execution/${run.version}`}>{children ?? `Open v${run.version} →`}</Link>;
}

/* ───────── Form field ───────── */

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  hint?: ReactNode;
  invalid?: boolean;
  id: string;
}) {
  return (
    <label className={`field ${props.invalid ? "is-invalid" : ""}`} htmlFor={props.id}>
      <span className="field__label">{props.label}</span>
      <span className="field__box">
        <input id={props.id} inputMode="decimal" autoComplete="off" spellCheck={false} value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-invalid={props.invalid} />
        {props.suffix && <span className="field__suffix">{props.suffix}</span>}
      </span>
      {props.hint && <span className="field__hint">{props.hint}</span>}
    </label>
  );
}

/* ───────── Toasts for action results ───────── */

type Toast = Result & { id: number; pending?: boolean };
const ToastCtx = createContext<(r: Outcome) => void>(() => {});
export const useNotify = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const drop = useCallback((id: number, ms: number) => window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms), []);
  const notify = useCallback(
    (r: Outcome) => {
      const id = Date.now() + Math.random();
      if (r instanceof Promise) {
        setToasts((t) => [...t.slice(-2), { id, ok: true, pending: true, message: "Confirm in your wallet, then wait for the block…" }]);
        void r.then((res) => {
          setToasts((t) => t.map((x) => (x.id === id ? { ...res, id } : x)));
          drop(id, res.ok ? 4200 : 6500);
        });
        return;
      }
      setToasts((t) => [...t.slice(-2), { ...r, id }]);
      drop(id, r.ok ? 3200 : 5200);
    },
    [drop],
  );
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.pending ? "toast--pending" : t.ok ? "toast--ok" : "toast--bad"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
