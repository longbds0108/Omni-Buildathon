import { Link } from "react-router-dom";
import { fmtAgo, fmtClock, fmtCol, fmtMusd, fmtPct, fmtPrice, fmtUsd } from "../lib/format";
import { LIQ_BPS, collateralValueE6, priceAtRatioE6, ratioBps, repayPlan } from "../lib/math";
import { isFresh } from "../lib/sim";
import { useNow, useSim } from "../lib/store";
import { Card, Empty, PageHead, Pill, Row, RunLink, RunSteps, SimTag, Stat, StatusChip, fmtLatency } from "../components/ui";
import { PriceChart, RatioGauge } from "../components/visuals";

export function Overview() {
  const s = useSim();
  const now = useNow();
  const p = s.position;
  const value = collateralValueE6(p.collateralE18, s.oracle.priceE6);
  const ratio = ratioBps(value, p.debtE6);
  const fresh = isFresh(s, now);
  const atTrigger = repayPlan({ ...p, priceE6: p.triggerE6 });
  const liqPrice = priceAtRatioE6(p.collateralE18, p.debtE6, LIQ_BPS);
  const latest = [...s.runs].reverse().find((r) => r.routeTriggered) ?? s.runs[s.runs.length - 1];
  const recent = [...s.runs].reverse().slice(0, 6);
  const prev = s.runs.length > 1 ? s.runs[s.runs.length - 2].priceE6 : null;
  const change = prev ? (Number(s.oracle.priceE6 - prev) / Number(prev)) * 100 : null;
  const toTrigger = s.oracle.priceE6 > p.triggerE6 ? (Number(s.oracle.priceE6 - p.triggerE6) / Number(s.oracle.priceE6)) * 100 : 0;

  const state = !p.open
    ? { tone: "muted" as const, text: "No position" }
    : p.debtE6 === 0n
      ? { tone: "ok" as const, text: "No debt" }
      : p.enabled
        ? { tone: "ok" as const, text: "Protected" }
        : { tone: "warn" as const, text: "Protection off" };

  return (
    <>
      <PageHead eyebrow="Dashboard" title="Overview" lead="The demo position on Base Sepolia and the reactive route on Lasna that answers every price log.">
        <SimTag />
      </PageHead>

      <div className="grid grid--desk">
        <div className="col">
          <Card className="card--chart">
            <div className="hero-top">
              <div>
                <span className="label">Oracle price</span>
                <div className="hero-val">
                  <strong className="mono">{fmtPrice(s.oracle.priceE6)}</strong>
                  {change !== null && <span className={`delta ${change >= 0 ? "ok-t" : "bad-t"}`}>{`${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)}% vs v${s.oracle.version - 1}`}</span>}
                </div>
                <p className="hero-sub">
                  v{s.oracle.version} · updated {fmtAgo(s.oracle.updatedAt, now)} · {p.open && p.debtE6 > 0n ? (toTrigger > 0 ? `${toTrigger.toFixed(2)}% above the trigger` : "at or under the trigger") : "no open debt"}
                </p>
              </div>
              <Pill tone={fresh ? "ok" : "warn"}>{fresh ? "Fresh" : "Stale · over 15 min"}</Pill>
            </div>
            <PriceChart runs={s.runs} triggerE6={s.routeTriggerE6} />
          </Card>

          <div className="stats">
            <Stat label="Debt" value={fmtMusd(p.debtE6)} sub="mUSD" />
            <Stat label="Collateral value" value={fmtUsd(value)} sub={`${fmtCol(p.collateralE18)} mCOL`} />
            <Stat label="Reserve" value={fmtMusd(p.reserveE6)} sub="mUSD for repays" />
            <Stat label="Max per repay" value={fmtMusd(p.maxRepayE6)} sub="mUSD per callback" />
            <Stat label="Vault trigger" value={fmtPrice(p.triggerE6)} sub="Base Sepolia" />
            <Stat label="Route trigger" value={fmtPrice(s.routeTriggerE6)} sub="Lasna" />
            <Stat label="Protection" value={p.enabled ? "On" : "Off"} sub={`configured at v${p.configVersion}`} tone={p.enabled ? "ok" : "warn"} />
            <Stat label="Vault liquidity" value={fmtMusd(s.liquidityE6)} sub="mUSD to lend" />
          </div>

          <Card title="Recent activity" actions={<Link to="/activity">All activity →</Link>}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th className="right">Price</th>
                    <th>Status</th>
                    <th className="right">Repaid</th>
                    <th className="right">Latency</th>
                    <th>Time</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.version}>
                      <td className="mono">v{r.version}</td>
                      <td className="mono right">{fmtPrice(r.priceE6)}</td>
                      <td>
                        <StatusChip status={r.status} />
                      </td>
                      <td className="mono right">{r.repay ? `${fmtMusd(r.repay.amountE6)} mUSD` : "—"}</td>
                      <td className="mono right">{fmtLatency(r)}</td>
                      <td className="mono dim">{fmtClock(r.origin.ts)}</td>
                      <td className="right">
                        <RunLink run={r}>Details →</RunLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="col col--side">
          <Card title="Collateral ratio" actions={<Pill tone={state.tone}>{state.text}</Pill>}>
            {p.open ? (
              <>
                <RatioGauge bps={ratio} />
                <div className="kvs">
                  <Row k="Repay fires at" v={fmtPrice(p.triggerE6)} />
                  <Row k="Target after repay" v="150%" />
                  <Row k="Simulated liquidation line" v={liqPrice === null ? "—" : fmtPrice(liqPrice)} />
                </div>
              </>
            ) : (
              <Empty
                title="No open position"
                body="Open the demo position to start: 1 mCOL against 1,000 mUSD."
                action={
                  <Link className="btn btn--primary btn--sm" to="/position">
                    Open a position
                  </Link>
                }
              />
            )}
          </Card>

          <Card title="Latest run" note={latest ? `Oracle v${latest.version} at ${fmtPrice(latest.priceE6)}` : undefined} actions={latest && <StatusChip status={latest.status} />}>
            {latest ? (
              <>
                <RunSteps run={latest} compact />
                <div className="card__foot">
                  <span>
                    Latency <b className="mono">{fmtLatency(latest)}</b>
                  </span>
                  <RunLink run={latest}>Execution details →</RunLink>
                </div>
              </>
            ) : (
              <Empty title="No price updates yet" body="Push a price from the top bar." />
            )}
          </Card>

          <Card title={`At ${fmtPrice(p.triggerE6)}`} note="What the next callback would do">
            {p.open && p.debtE6 > 0n ? (
              <div className="kvs">
                <Row k="Ratio at trigger" v={fmtPct(atTrigger.ratioBps)} />
                <Row k="Repay" v={`${fmtMusd(atTrigger.amountE6)} mUSD`} />
                <Row k="Debt after" v={`${fmtMusd(atTrigger.debtAfterE6)} mUSD`} />
                <Row k="Reserve after" v={`${fmtMusd(atTrigger.reserveAfterE6)} mUSD`} />
                <Row k="Limited by" v={{ gap: "the 150% target", limit: "your repay limit", reserve: "your reserve", none: "nothing to repay" }[atTrigger.cap]} mono={false} />
              </div>
            ) : (
              <Empty title="Nothing to protect" body="There is no open debt right now." />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
