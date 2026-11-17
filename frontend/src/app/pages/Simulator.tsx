import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fmtMusd, fmtPct, fmtPrice, fmtUsd } from "../lib/format";
import { E6, LIQ_BPS, OPEN_MIN_BPS, TARGET_BPS, parseUnits, ratioBps, collateralValueE6, repayPlan } from "../lib/math";
import { DEMO_POSITION, actions, useSim } from "../lib/store";
import { Card, Field, PageHead, Pill, RatioMeter, Row, RunLink, SimTag, StatusChip, ratioTone, useNotify } from "../components/ui";

const MIN = 500;
const MAX = 2500;
const PRESETS = [1800, 1400, 1350, 1200, 1000];
const CAP_TEXT = { gap: "repay = debt − target", limit: "capped by the repay limit", reserve: "capped by the reserve", none: "nothing to repay" };

export function Simulator() {
  const s = useSim();
  const notify = useNotify();
  const [price, setPrice] = useState(() => (Number(s.oracle.priceE6 / E6) > 1350 ? "1,350" : "1,200"));
  const priceE6 = parseUnits(price, 6);
  const live = s.position.open && s.position.debtE6 > 0n;
  const base = live ? s.position : { ...DEMO_POSITION, triggerE6: s.position.triggerE6, enabled: true };
  const trigger = s.position.triggerE6;
  const plan = priceE6 ? repayPlan({ ...base, priceE6 }) : null;
  const fires = priceE6 !== null && priceE6 <= trigger && priceE6 > 0n;
  const ratioAfter = fires && plan ? plan.ratioAfterBps : plan?.ratioBps ?? null;
  const last = s.runs[s.runs.length - 1];
  const sliderValue = priceE6 ? Math.min(MAX, Math.max(MIN, Number(priceE6 / E6))) : MIN;

  return (
    <>
      <PageHead
        eyebrow="Risk Simulator"
        title={
          <>
            What if the price <em>falls</em>?
          </>
        }
        lead="Pick a price and see the ratio, the repay the vault would make and where it leaves the position. Same integer math as the vault, rounded down."
      >
        <SimTag />
      </PageHead>

      <div className="grid grid--hero">
        <Card className="card--hero" title="Price" note={live ? "Using your open position" : "No open debt, so this uses the demo position: 1 mCOL, 1,000 mUSD debt, 150 reserve, 120 limit"}>
          <div className="sim-input">
            <Field id="sim-price" label="Collateral price" suffix="USD" value={price} onChange={setPrice} invalid={!priceE6} />
            <input
              className="range"
              type="range"
              min={MIN}
              max={MAX}
              step={10}
              value={sliderValue}
              aria-label="Collateral price"
              onChange={(e) => setPrice(Number(e.target.value).toLocaleString("en-US"))}
            />
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p} className={`preset ${priceE6 === BigInt(p) * E6 ? "is-on" : ""}`} onClick={() => setPrice(p.toLocaleString("en-US"))}>
                  ${p.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          </div>
          <RatioChart base={base} trigger={trigger} priceE6={priceE6} />
        </Card>

        <Card title="Outcome" actions={<Pill tone={fires ? "brand" : "muted"}>{fires ? "Trigger hit" : "Above trigger"}</Pill>}>
          {plan ? (
            <>
              <p className={`big mono big--${ratioTone(plan.ratioBps)}`}>{fmtPct(plan.ratioBps)}</p>
              <RatioMeter bps={plan.ratioBps} after={fires ? plan.ratioAfterBps : undefined} />
              <div className="kvs">
                <Row k="Collateral value" v={fmtUsd(plan.valueE6)} />
                <Row k="Target debt at 150%" v={`${fmtMusd(plan.targetDebtE6)} mUSD`} />
                <Row k="Repay" v={fires ? `${fmtMusd(plan.amountE6)} mUSD` : "no callback requested"} />
                <Row k="Why" v={fires ? CAP_TEXT[plan.cap] : `above the ${fmtPrice(trigger)} trigger`} mono={false} />
                <Row k="Debt after" v={`${fmtMusd(fires ? plan.debtAfterE6 : base.debtE6)} mUSD`} />
                <Row k="Reserve after" v={`${fmtMusd(fires ? plan.reserveAfterE6 : base.reserveE6)} mUSD`} />
                <Row k="Ratio after" v={<span className={`${ratioTone(ratioAfter)}-t`}>{fmtPct(ratioAfter)}</span>} />
              </div>
              {ratioAfter !== null && ratioAfter < LIQ_BPS && <p className="banner banner--bad">Even after the repay, the position is under the Simulated liquidation line.</p>}
            </>
          ) : (
            <p className="dim">Enter a price, for example 1,350.</p>
          )}
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Operator · push this price" note="Writes a new oracle version. On Base Sepolia only the oracle operator can do this.">
          <p className="big mono">{priceE6 ? fmtPrice(priceE6) : "—"}</p>
          <div className="btn-row">
            <button className="btn btn--primary" disabled={!priceE6} onClick={() => priceE6 && notify(actions.pushPrice(priceE6))}>
              Push price to the oracle
            </button>
          </div>
          {last && (
            <div className="card__foot">
              <span>
                Last run <b className="mono">v{last.version}</b> at <b className="mono">{fmtPrice(last.priceE6)}</b> <StatusChip status={last.status} />
              </span>
              <RunLink run={last}>Watch it →</RunLink>
            </div>
          )}
        </Card>

        <Card title="Acceptance scenario" note="$1,800 setup, then $1,400 with no request, then $1,350 repaid back to 150%">
          <div className="btn-row">
            <button className="btn btn--primary btn--sm" disabled={s.replaying} onClick={() => notify(actions.replay())}>
              {s.replaying ? "Replaying…" : "Replay live"}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => notify(actions.loadAcceptance())}>
              Load finished run
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => notify(actions.reset())}>
              Reset demo
            </button>
          </div>
          <p className="fine">
            Replay takes about fifteen seconds. Follow it on <Link to="/activity">Activity</Link> or in <Link to="/execution">Execution Details</Link>.
          </p>
        </Card>
      </div>
    </>
  );
}

/* Ratio across prices: without protection, and after one automatic repay at or under the trigger. */
function RatioChart({ base, trigger, priceE6 }: { base: typeof DEMO_POSITION; trigger: bigint; priceE6: bigint | null }) {
  const W = 640;
  const H = 260;
  const pad = { l: 44, r: 14, t: 14, b: 30 };
  const yMax = 250;
  const x = (p: number) => pad.l + ((p - MIN) / (MAX - MIN)) * (W - pad.l - pad.r);
  const y = (pct: number) => pad.t + (1 - Math.min(pct, yMax) / yMax) * (H - pad.t - pad.b);
  const toPct = (bps: bigint | null) => (bps === null ? yMax : Number(bps) / 100);

  const { raw, after } = useMemo(() => {
    const raw: string[] = [];
    const after: string[] = [];
    for (let p = MIN; p <= MAX; p += 25) {
      const pe6 = BigInt(p) * E6;
      const r = ratioBps(collateralValueE6(base.collateralE18, pe6), base.debtE6);
      raw.push(`${x(p).toFixed(1)},${y(toPct(r)).toFixed(1)}`);
      const plan = repayPlan({ ...base, priceE6: pe6 });
      after.push(`${x(p).toFixed(1)},${y(toPct(pe6 <= trigger ? plan.ratioAfterBps : r)).toFixed(1)}`);
    }
    return { raw: raw.join(" "), after: after.join(" ") };
  }, [base.collateralE18, base.debtE6, base.reserveE6, base.maxRepayE6, trigger]);

  const tx = x(Number(trigger / E6));
  const sel = priceE6 ? Math.min(MAX, Math.max(MIN, Number(priceE6 / E6))) : null;
  const guides: [bigint, string, string][] = [
    [LIQ_BPS, "120% Simulated liquidation line", "var(--danger)"],
    [TARGET_BPS, "150% target", "var(--success)"],
    [OPEN_MIN_BPS, "160% open minimum", "var(--muted)"],
  ];

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Collateral ratio by price, with and without the automatic repay">
        {[0, 50, 100, 150, 200, 250].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="chart__tick">{t}%</text>
          </g>
        ))}
        {[500, 1000, 1500, 2000, 2500].map((p) => (
          <text key={p} x={x(p)} y={H - 8} textAnchor={p === MAX ? "end" : "middle"} className="chart__tick">${p.toLocaleString("en-US")}</text>
        ))}
        {guides.map(([bps, label, color]) => (
          <g key={label}>
            <line x1={pad.l} x2={W - pad.r} y1={y(Number(bps) / 100)} y2={y(Number(bps) / 100)} stroke={color} strokeDasharray="4 5" strokeWidth="1" opacity=".7" />
            <text
              x={bps === TARGET_BPS ? pad.l + 6 : W - pad.r - 4}
              y={y(Number(bps) / 100) + (bps === TARGET_BPS ? 14 : -5)}
              textAnchor={bps === TARGET_BPS ? "start" : "end"}
              className="chart__label"
              fill={color}
            >
              {label}
            </text>
          </g>
        ))}
        <rect x={pad.l} y={pad.t} width={tx - pad.l} height={H - pad.t - pad.b} className="chart__zone" />
        <line x1={tx} x2={tx} y1={pad.t} y2={H - pad.b} className="chart__trigger" />
        <text x={tx + 6} y={pad.t + 12} className="chart__label" fill="var(--brand-soft)">trigger ${Number(trigger / E6).toLocaleString("en-US")}</text>
        <polyline points={raw} className="chart__raw" />
        <polyline points={after} className="chart__after" />
        {sel !== null && priceE6 !== null && (
          <g>
            <line x1={x(sel)} x2={x(sel)} y1={pad.t} y2={H - pad.b} className="chart__sel" />
            <circle cx={x(sel)} cy={y(toPct(ratioBps(collateralValueE6(base.collateralE18, priceE6), base.debtE6)))} r="4.5" className="chart__dot chart__dot--raw" />
            {priceE6 <= trigger && <circle cx={x(sel)} cy={y(toPct(repayPlan({ ...base, priceE6 }).ratioAfterBps))} r="4.5" className="chart__dot" />}
          </g>
        )}
      </svg>
      <figcaption className="legend">
        <span><i className="legend__raw" />Without protection</span>
        <span><i className="legend__after" />After one automatic repay</span>
      </figcaption>
    </figure>
  );
}
