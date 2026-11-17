import { Link, useParams } from "react-router-dom";
import type { Hex } from "viem";
import { fmtDate, fmtMusd, fmtPct, fmtPrice, fmtSeconds } from "../lib/format";
import { CHAINS, callbackPayload, contracts, type ChainKey } from "../lib/manifest";
import { collateralValueE6, ratioBps } from "../lib/math";
import type { Run, TxRef } from "../lib/sim";
import { useSim } from "../lib/store";
import { Card, Empty, PageHead, Pill, Row, RunSteps, SimTag, StatusChip, TxHash, latencyOf } from "../components/ui";

export function Execution() {
  const s = useSim();
  const { version } = useParams();
  const fallback = [...s.runs].reverse().find((r) => r.routeTriggered) ?? s.runs[s.runs.length - 1];
  const run = version ? s.runs.find((r) => r.version === Number(version)) : fallback;

  return (
    <>
      <PageHead
        eyebrow="Execution Details"
        title={
          run ? (
            <>
              Oracle <em>v{run.version}</em> at {fmtPrice(run.priceE6)}
            </>
          ) : (
            "Execution details"
          )
        }
        lead="The proof for one price update: three transactions on two chains, the payload the proxy delivered, the checks the vault ran and the balances it changed."
      >
        <SimTag />
      </PageHead>

      <nav className="versions" aria-label="Oracle versions">
        {[...s.runs].reverse().map((r) => (
          <Link key={r.version} to={`/execution/${r.version}`} className={`preset ${run?.version === r.version ? "is-on" : ""}`}>
            v{r.version} · {fmtPrice(r.priceE6)}
          </Link>
        ))}
      </nav>

      {run ? <Detail run={run} /> : <Card><Empty title={`No run for v${version}`} body="Pick a version above." /></Card>}
    </>
  );
}

function Detail({ run }: { run: Run }) {
  const routeTrigger = useSim().routeTriggerE6;
  const latency = latencyOf(run);
  const observed = run.callbackAtMs ? ((run.callbackAtMs - run.pushedAtMs) / 1000).toFixed(2) : null;
  const before = ratioBps(collateralValueE6(run.before.collateralE18, run.priceE6), run.repay?.debtBeforeE6 ?? run.before.debtE6);
  const after = run.repay ? ratioBps(collateralValueE6(run.before.collateralE18, run.priceE6), run.repay.debtAfterE6) : null;
  const payload = callbackPayload(run.version, run.origin.tx);

  return (
    <>
      <Card title="Price update → Reactive request → Callback" note="Linked by origin tx hash and oracle version" actions={<StatusChip status={run.status} />}>
        <RunSteps run={run} />
      </Card>

      <div className="grid grid--3">
        <TxCard title="1 · Price update" chain="base" at={run.origin} rows={[["Event", "PriceUpdated"], ["oracleVersion", `v${run.version}`], ["priceE6", run.priceE6.toString()]]} />
        <TxCard
          title="2 · Reactive request"
          chain="lasna"
          at={run.request}
          empty={run.routeTriggered ? "Waiting for Lasna to react." : `No request. ${fmtPrice(run.priceE6)} is above the ${fmtPrice(routeTrigger)} route trigger.`}
          rows={[["Event", "RepayRequested"], ["originTxHash", run.origin.tx], ["oracleVersion", `v${run.version}`]]}
        />
        <TxCard
          title="3 · Callback"
          chain="base"
          at={run.callback}
          empty={!run.routeTriggered ? "No callback, since nothing was requested." : "Waiting for the callback."}
          rows={[["Event", run.status === "repaid" ? "AutoRepaid" : "CallbackSkipped"], ["originTxHash", run.origin.tx], ["oracleVersion", `v${run.version}`]]}
        />
      </div>

      <div className="grid grid--2">
        <Card title="Latency" actions={latency !== null ? <Pill tone="ok">{fmtSeconds(latency)}</Pill> : <Pill tone="muted">not measured</Pill>}>
          <div className="kvs">
            <Row k={`Price block timestamp · ${CHAINS.base.name}`} v={fmtDate(run.origin.ts)} />
            <Row k={`Callback block timestamp · ${CHAINS.base.name}`} v={run.callback ? fmtDate(run.callback.ts) : "—"} />
            <Row k="End to end, callback block − price block" v={latency !== null ? fmtSeconds(latency) : "—"} />
            <Row k="Local clock, observed" v={observed ? `${observed} s` : "—"} />
          </div>
          <p className="fine">
            Both timestamps come from {CHAINS.base.name} blocks, so they share one clock. Block timestamps count whole seconds and a block lands every 2 seconds, so the figure is accurate to about 2 seconds. The local clock figure is measured in this browser and kept separate.
          </p>
        </Card>

        <Card title="Balances" note="As emitted by AutoRepaid">
          {run.repay ? (
            <div className="kvs">
              <Row k="Repaid from reserve" v={`${fmtMusd(run.repay.amountE6)} mUSD`} />
              <Row k="Debt" v={`${fmtMusd(run.repay.debtBeforeE6)} → ${fmtMusd(run.repay.debtAfterE6)} mUSD`} />
              <Row k="Reserve" v={`${fmtMusd(run.repay.reserveBeforeE6)} → ${fmtMusd(run.repay.reserveAfterE6)} mUSD`} />
              <Row k="Ratio" v={<>{fmtPct(before)} → <span className="ok-t">{fmtPct(after)}</span></>} />
              <Row k="Limited by" v={{ gap: "the 150% target", limit: "the repay limit", reserve: "the reserve", none: "—" }[run.repay.cap]} mono={false} />
            </div>
          ) : run.status === "skipped" ? (
            <Empty title="Callback ran, debt unchanged" body={<>The callback transaction succeeded, but the vault skipped the repay: {run.skipReason}.</>} />
          ) : (
            <Empty title="No balance change" body={run.routeTriggered ? "The callback has not landed yet." : `The price stayed above the trigger. Ratio at this price: ${fmtPct(before)}.`} />
          )}
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Callback payload" note="executeRepay(address reactiveSender, uint256 oracleVersion, bytes32 originTxHash)">
          <Calldata label="Encoded on Lasna, sender = address(0)" data={payload.requested} highlight={false} />
          <Calldata label={`Delivered by the proxy, sender = ReactiveRepay`} data={payload.delivered} highlight />
          <div className="kvs">
            <Row k={`Callback proxy · ${CHAINS.base.name}`} v={<span title={contracts.callbackProxy}>{contracts.callbackProxy.slice(0, 10)}…{contracts.callbackProxy.slice(-4)}</span>} />
            <Row k="Injected ReactiveRepay" v={<span title={contracts.reactiveRepay}>{contracts.reactiveRepay.slice(0, 10)}…{contracts.reactiveRepay.slice(-4)}</span>} />
          </div>
        </Card>

        <Card title="Vault checks" note="autoRepay stops at the first failing check and emits CallbackSkipped">
          {run.checks ? (
            <ul className="checks">
              {run.checks.map((c) => (
                <li key={c.label} className={`check check--${c.state}`}>
                  <span className="check__mark" aria-hidden="true">{c.state === "ok" ? "✓" : c.state === "fail" ? "✕" : "·"}</span>
                  <div>
                    <b>{c.label}</b>
                    <span>{c.state === "unreached" ? "not reached" : c.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No callback yet" body={run.routeTriggered ? "The checks run when the callback lands." : "The route never asked for a callback at this price."} />
          )}
        </Card>
      </div>
    </>
  );
}

function TxCard({ title, chain, at, rows, empty }: { title: string; chain: ChainKey; at?: TxRef; rows: [string, string][]; empty?: string }) {
  return (
    <Card title={title} note={CHAINS[chain].name} className={at ? "" : "card--muted"}>
      {at ? (
        <div className="kvs">
          <Row k="Tx" v={<TxHash hash={at.tx} chain={chain} />} />
          <Row k="Block" v={at.block.toLocaleString("en-US")} />
          <Row k="Timestamp" v={fmtDate(at.ts)} />
          {rows.map(([k, v]) => (
            <Row key={k} k={k} v={v.startsWith("0x") ? <TxHash hash={v as Hex} chain="base" /> : v} />
          ))}
        </div>
      ) : (
        <p className="dim">{empty}</p>
      )}
    </Card>
  );
}

/** Calldata split into the 4-byte selector and 32-byte words; the first word is the reactive sender. */
function Calldata({ label, data, highlight }: { label: string; data: Hex; highlight: boolean }) {
  const body = data.slice(10);
  const words = Array.from({ length: body.length / 64 }, (_, i) => body.slice(i * 64, i * 64 + 64));
  return (
    <div className="calldata">
      <span className="calldata__label">{label}</span>
      <code>
        <span className="calldata__sel">{data.slice(0, 10)}</span>
        {words.map((w, i) => (
          <span key={i} className={i === 0 ? (highlight ? "calldata__sender is-injected" : "calldata__sender") : ""}>
            {w}
          </span>
        ))}
      </code>
    </div>
  );
}
