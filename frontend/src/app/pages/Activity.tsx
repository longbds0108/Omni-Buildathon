import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtClock, fmtMusd, fmtPrice } from "../lib/format";
import { CHAINS, addressUrl, manifest } from "../lib/manifest";
import { shortHex } from "../lib/format";
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

      {manifest && <Deployment />}

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

/* Every address and deployment transaction from the manifest, linked to its explorer. */
function Deployment() {
  const m = manifest!;
  const rows: [string, "base" | "lasna", string][] = [
    ["MockOracle", "base", m.base.oracle],
    ["LendingVault", "base", m.base.vault],
    ["RepayReceiver", "base", m.base.receiver],
    ["Callback proxy", "base", m.base.callbackProxy],
    ["mCOL", "base", m.base.collateral],
    ["mUSD", "base", m.base.musd],
    ["ReactiveRepay", "lasna", m.lasna.reactiveRepay],
    ["System contract", "lasna", m.lasna.systemContract],
    ["Demo borrower", "base", m.borrower],
    ["Operator", "base", m.base.operator],
  ];
  return (
    <Card title="Contracts and deployment" note={`From the deploy manifest, ${new Date(m.generatedAt).toISOString().slice(0, 10)}`}>
      <div className="deploy">
        <ul className="deploy__list">
          {rows.map(([name, chain, addr]) => {
            const url = addressUrl(chain, addr as `0x${string}`);
            return (
              <li key={name}>
                <span>{name}</span>
                <span className={`chain chain--${chain}`}>{CHAINS[chain].short}</span>
                {url ? (
                  <a className="hash mono" href={url} target="_blank" rel="noreferrer">
                    {shortHex(addr)}&nbsp;↗
                  </a>
                ) : (
                  <span className="hash mono" title={addr}>{shortHex(addr)}</span>
                )}
              </li>
            );
          })}
        </ul>
        <details className="deploy__txs">
          <summary>{m.transactions.length} deployment and funding transactions</summary>
          <ul>
            {m.transactions.map((t) => (
              <li key={t.hash}>
                <span>{t.label}</span>
                <span className={`chain chain--${t.chain}`}>{CHAINS[t.chain].short}</span>
                <TxHash hash={t.hash} chain={t.chain} />
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  );
}
