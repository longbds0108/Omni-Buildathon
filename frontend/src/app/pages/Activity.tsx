import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtClock, fmtMusd, fmtPrice } from "../lib/format";
import { CHAINS } from "../lib/manifest";
import { STATUS_LABEL, type RunStatus } from "../lib/sim";
import { useSim } from "../lib/store";
import { Card, PageHead, RunLink, SimTag, StatusChip, TxHash, fmtLatency } from "../components/ui";

const FILTERS: (RunStatus | "all")[] = ["all", "above", "waiting", "requested", "repaid", "skipped"];

export function Activity() {
  const s = useSim();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"runs" | "log">("runs");
  const [filter, setFilter] = useState<RunStatus | "all">("all");
  const runs = [...s.runs].reverse().filter((r) => filter === "all" || r.status === filter);
  const count = (f: RunStatus | "all") => (f === "all" ? s.runs.length : s.runs.filter((r) => r.status === f).length);

  return (
    <>
      <PageHead
        eyebrow="Activity"
        title={
          <>
            Every price, every <em>answer</em>
          </>
        }
        lead="One row per oracle version: the price log on Base Sepolia, the request on Lasna and the callback back on Base Sepolia, linked by origin tx hash and oracle version."
      >
        <SimTag />
      </PageHead>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "runs"} className={tab === "runs" ? "is-on" : ""} onClick={() => setTab("runs")}>
          Runs <span className="mono dim">{s.runs.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "log"} className={tab === "log" ? "is-on" : ""} onClick={() => setTab("log")}>
          Event log <span className="mono dim">{s.events.length}</span>
        </button>
      </div>

      {tab === "runs" ? (
        <Card>
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f} className={`preset ${filter === f ? "is-on" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : STATUS_LABEL[f]} <span className="mono dim">{count(f)}</span>
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="table table--click">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Origin tx · Base</th>
                  <th>Request tx · Lasna</th>
                  <th>Callback tx · Base</th>
                  <th>Repaid</th>
                  <th>Latency</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.version} onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(`/execution/${r.version}`)}>
                    <td className="mono"><RunLink run={r}>v{r.version}</RunLink></td>
                    <td className="mono">{fmtPrice(r.priceE6)}</td>
                    <td><StatusChip status={r.status} /></td>
                    <td><TxHash hash={r.origin.tx} chain="base" /></td>
                    <td>{r.routeTriggered ? <TxHash hash={r.request?.tx} chain="lasna" /> : <span className="dim">no request</span>}</td>
                    <td>{r.routeTriggered ? <TxHash hash={r.callback?.tx} chain="base" /> : <span className="dim">—</span>}</td>
                    <td className="mono">{r.repay ? `${fmtMusd(r.repay.amountE6)} mUSD` : r.status === "skipped" ? <span className="bad-t" title={r.skipReason}>skipped</span> : "—"}</td>
                    <td className="mono">{fmtLatency(r)}</td>
                    <td className="mono dim">{fmtClock(r.origin.ts)}</td>
                  </tr>
                ))}
                {!runs.length && (
                  <tr>
                    <td colSpan={9} className="dim center">No runs with this status.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card note="Raw events, newest first">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Chain</th>
                  <th>Event</th>
                  <th>Block</th>
                  <th>Tx</th>
                  <th>Fields</th>
                </tr>
              </thead>
              <tbody>
                {[...s.events].reverse().map((e) => (
                  <tr key={e.id}>
                    <td className="mono dim">{fmtClock(e.ts)}</td>
                    <td><span className={`chain chain--${e.chain}`}>{CHAINS[e.chain].short}</span></td>
                    <td className="ev">{e.name}</td>
                    <td className="mono">{e.block.toLocaleString("en-US")}</td>
                    <td><TxHash hash={e.tx} chain={e.chain} /></td>
                    <td className="fields">
                      {e.fields.map(([k, v]) => (
                        <span key={k}>
                          <em>{k}</em> {v.startsWith("0x") && v.length > 20 ? `${v.slice(0, 10)}…${v.slice(-4)}` : v}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
