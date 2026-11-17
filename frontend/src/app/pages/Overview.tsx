import { Link } from "react-router-dom";
import { fmtAgo, fmtClock, fmtCol, fmtMusd, fmtPct, fmtPrice, fmtUsd } from "../lib/format";
import { collateralValueE6, priceAtRatioE6, ratioBps, repayPlan, LIQ_BPS } from "../lib/math";
import { isFresh } from "../lib/sim";
import { useNow, useSim } from "../lib/store";
import { Card, Empty, PageHead, Pill, RatioMeter, RunLink, RunSteps, SimTag, Stat, StatusChip, fmtLatency, ratioTone } from "../components/ui";

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
  const recent = [...s.runs].reverse().slice(0, 5);
  const tone = ratioTone(ratio);

  const state = !p.open
    ? { tone: "muted" as const, text: "No position" }
    : p.debtE6 === 0n
      ? { tone: "ok" as const, text: "No debt" }
      : p.enabled
        ? { tone: "ok" as const, text: "Protected" }
        : { tone: "warn" as const, text: "Protection off" };

  return (
    <>
      <PageHead
        eyebrow="Overview"
        title={
          <>
            One position, <em>watched</em> every block
          </>
        }
        lead="Price, debt, reserve and the repay rule for the demo position on Base Sepolia. A reactive route on Lasna answers every price log."
      >
        <SimTag />
      </PageHead>

      <div className="grid grid--hero">
        <Card className="card--hero" title="Collateral ratio" actions={<Pill tone={state.tone}>{state.text}</Pill>}>
          {p.open ? (
            <>
              <p className={`big mono big--${tone}`}>{fmtPct(ratio)}</p>
              <RatioMeter bps={ratio} />
              <p className="fine">
                Repay fires at or under {fmtPrice(p.triggerE6)} and brings the ratio back to 150%.
                {liqPrice !== null && <> The Simulated liquidation line sits at {fmtPrice(liqPrice)}.</>}
              </p>
            </>
          ) : (
            <Empty title="No open position" body="Open the demo position to start: 1 mCOL against 1,000 mUSD." action={<Link className="btn btn--primary btn--sm" to="/position">Open a position</Link>} />
          )}
        </Card>

        <Card title="Oracle" actions={<Pill tone={fresh ? "ok" : "warn"}>{fresh ? "Fresh" : "Stale"}</Pill>}>
          <p className="big mono">{fmtPrice(s.oracle.priceE6)}</p>
          <div className="kvs">
            <div className="kv"><span>Version</span><b className="mono">v{s.oracle.version}</b></div>
            <div className="kv"><span>Updated</span><b className="mono">{fmtClock(s.oracle.updatedAt)}</b></div>
            <div className="kv"><span>Age</span><b className="mono">{fmtAgo(s.oracle.updatedAt, now)}</b></div>
            <div className="kv"><span>Freshness limit</span><b className="mono">15 min</b></div>
          </div>
          <Link className="btn btn--ghost btn--sm btn--block" to="/simulator">Simulate or push a price</Link>
        </Card>
      </div>

      <div className="stats">
        <Stat label="Debt" value={`${fmtMusd(p.debtE6)}`} sub="mUSD" />
        <Stat label="Collateral value" value={fmtUsd(value)} sub={`${fmtCol(p.collateralE18)} mCOL`} />
        <Stat label="Reserve" value={fmtMusd(p.reserveE6)} sub="mUSD set aside for repays" tone="brand" />
        <Stat label="Max per repay" value={fmtMusd(p.maxRepayE6)} sub="mUSD per callback" />
        <Stat label="Vault trigger" value={fmtPrice(p.triggerE6)} sub="checked on Base Sepolia" />
        <Stat label="Route trigger" value={fmtPrice(s.routeTriggerE6)} sub="checked on Lasna" />
        <Stat label="Protection" value={p.enabled ? "On" : "Off"} sub={`configured at oracle v${p.configVersion}`} tone={p.enabled ? "ok" : "warn"} />
        <Stat label="Vault liquidity" value={fmtMusd(s.liquidityE6)} sub="mUSD available to lend" />
      </div>

      <div className="grid grid--2">
        <Card title="Latest run" note={latest ? `Oracle v${latest.version} at ${fmtPrice(latest.priceE6)}` : undefined} actions={latest && <StatusChip status={latest.status} />}>
          {latest ? (
            <>
              <RunSteps run={latest} />
              <div className="card__foot">
                <span className="dim">End-to-end latency <b className="mono">{fmtLatency(latest)}</b></span>
                <RunLink run={latest}>Execution details →</RunLink>
              </div>
            </>
          ) : (
            <Empty title="No price updates yet" body="Push a price from the Risk Simulator." />
          )}
        </Card>

        <Card title={`If the price reaches ${fmtPrice(p.triggerE6)}`} note="What the next callback would do, with today's balances">
          {p.open && p.debtE6 > 0n ? (
            <div className="kvs">
              <div className="kv"><span>Ratio at trigger</span><b className="mono">{fmtPct(atTrigger.ratioBps)}</b></div>
              <div className="kv"><span>Repay</span><b className="mono">{fmtMusd(atTrigger.amountE6)} mUSD</b></div>
              <div className="kv"><span>Debt after</span><b className="mono">{fmtMusd(atTrigger.debtAfterE6)} mUSD</b></div>
              <div className="kv"><span>Reserve after</span><b className="mono">{fmtMusd(atTrigger.reserveAfterE6)} mUSD</b></div>
              <div className="kv"><span>Ratio after</span><b className="mono ok-t">{fmtPct(atTrigger.ratioAfterBps)}</b></div>
              <div className="kv">
                <span>Limited by</span>
                <b>{{ gap: "the 150% target", limit: "your repay limit", reserve: "your reserve", none: "nothing to repay" }[atTrigger.cap]}</b>
              </div>
            </div>
          ) : (
            <Empty title="Nothing to protect" body="There is no open debt right now." />
          )}
        </Card>
      </div>

      <Card title="Recent activity" actions={<Link to="/activity">All activity →</Link>}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Version</th><th>Price</th><th>Status</th><th>Repaid</th><th>Latency</th><th>Time</th><th /></tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.version}>
                  <td className="mono">v{r.version}</td>
                  <td className="mono">{fmtPrice(r.priceE6)}</td>
                  <td><StatusChip status={r.status} /></td>
                  <td className="mono">{r.repay ? `${fmtMusd(r.repay.amountE6)} mUSD` : "—"}</td>
                  <td className="mono">{fmtLatency(r)}</td>
                  <td className="mono dim">{fmtClock(r.origin.ts)}</td>
                  <td className="right"><RunLink run={r}>Details →</RunLink></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
