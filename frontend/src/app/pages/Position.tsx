import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtClock, fmtCol, fmtMusd, fmtPct, fmtPrice, fmtUsd } from "../lib/format";
import { collateralValueE6, parseUnits, priceAtRatioE6, ratioBps, BPS, LIQ_BPS, OPEN_MIN_BPS, TARGET_BPS } from "../lib/math";
import { isFresh } from "../lib/sim";
import { actions, useNow, useSim } from "../lib/store";
import { contracts, dataMode } from "../lib/manifest";
import { shortHex } from "../lib/format";
import { Card, Field, PageHead, Pill, RatioMeter, Row, SimTag, Stat, TxHash, useNotify, ratioTone } from "../components/ui";

const POSITION_EVENTS = new Set(["PositionOpened", "Repaid", "AutoRepaid", "PositionClosed", "Approval"]);

export function PositionPage() {
  const s = useSim();
  const p = s.position;
  const value = collateralValueE6(p.collateralE18, s.oracle.priceE6);
  const ratio = ratioBps(value, p.debtE6);
  const events = s.events.filter((e) => POSITION_EVENTS.has(e.name)).reverse();

  return (
    <>
      <PageHead
        eyebrow="Position"
        title={p.open ? <>Your <em>loan</em></> : <>Open a <em>loan</em></>}
        lead={
          <>
            Collateral goes into the vault, mUSD comes out. Interest is zero. Opening needs at least 160% and a price younger than 15 minutes.
            {dataMode !== "sim" && <> This demo loan belongs to {shortHex(contracts.borrower)}: connect that wallet to act on it.</>}
          </>
        }
      >
        <SimTag />
      </PageHead>

      {p.open ? <OpenPosition ratio={ratio} value={value} /> : <OpenForm />}

      <div className="grid grid--2">
        <Card title="Wallet" note="Balances of the demo borrower">
          <div className="kvs">
            <Row k="mCOL" v={fmtCol(s.wallet.colE18)} />
            <Row k="mUSD" v={fmtMusd(s.wallet.musdE6)} />
            <Row k="mCOL allowance for the vault" v={s.wallet.colApproved ? "approved" : "none"} />
            <Row k="mUSD allowance for the vault" v={s.wallet.musdApproved ? "approved" : "none"} />
          </div>
        </Card>
        <Card title="Position history">
          {events.length ? (
            <ul className="feed">
              {events.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <span className="feed__name">{e.name}</span>
                  <span className="dim mono">{fmtClock(e.ts)}</span>
                  <span className="feed__body">{e.fields.filter(([k]) => k !== "borrower" && k !== "originTxHash").map(([k, v]) => `${k} ${v}`).join(" · ")}</span>
                  <TxHash hash={e.tx} chain={e.chain} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="dim">Nothing yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function OpenForm() {
  const s = useSim();
  const now = useNow();
  const notify = useNotify();
  const [col, setCol] = useState("1");
  const [borrow, setBorrow] = useState("1,000");
  const colE18 = parseUnits(col, 18);
  const borrowE6 = parseUnits(borrow, 6);
  const value = colE18 === null ? null : collateralValueE6(colE18, s.oracle.priceE6);
  const ratio = value !== null && borrowE6 ? ratioBps(value, borrowE6) : null;
  const maxBorrow = value === null ? null : (value * BPS) / OPEN_MIN_BPS;
  const fresh = isFresh(s, now);
  const okRatio = ratio !== null && ratio >= OPEN_MIN_BPS;

  return (
    <div className="grid grid--form">
      <Card title="New position" note={`At the oracle price of ${fmtPrice(s.oracle.priceE6)}`}>
        <div className="form">
          <Field id="open-col" label="Collateral" suffix="mCOL" value={col} onChange={setCol} invalid={colE18 === null} hint={`Wallet holds ${fmtCol(s.wallet.colE18)} mCOL`} />
          <Field id="open-borrow" label="Borrow" suffix="mUSD" value={borrow} onChange={setBorrow} invalid={borrowE6 === null} hint={maxBorrow !== null ? `Up to ${fmtMusd(maxBorrow)} mUSD keeps 160%` : undefined} />
          <div className="btn-row">
            {!s.wallet.colApproved && (
              <button className="btn btn--ghost" onClick={() => notify(actions.approve("collateral"))}>
                1. Approve mCOL
              </button>
            )}
            <button
              className="btn btn--primary"
              disabled={!s.wallet.colApproved || colE18 === null || borrowE6 === null}
              onClick={() => colE18 !== null && borrowE6 !== null && notify(actions.openPosition(colE18, borrowE6))}
            >
              {s.wallet.colApproved ? "Open position" : "2. Open position"}
            </button>
          </div>
        </div>
      </Card>
      <Card title="Preview" actions={<Pill tone={okRatio ? "ok" : "bad"}>{okRatio ? "Meets 160%" : "Under 160%"}</Pill>}>
        <p className={`big mono big--${ratioTone(ratio)}`}>{ratio === null ? "—" : fmtPct(ratio)}</p>
        <RatioMeter bps={ratio} />
        <div className="kvs">
          <Row k="Collateral value" v={value === null ? "—" : fmtUsd(value)} />
          <Row k="Vault liquidity" v={`${fmtMusd(s.liquidityE6)} mUSD`} />
          <Row k="Oracle price" v={<span className={fresh ? "" : "warn-t"}>{fmtPrice(s.oracle.priceE6)} · {fresh ? "fresh" : "stale, push a new price"}</span>} />
        </div>
      </Card>
    </div>
  );
}

function OpenPosition({ ratio, value }: { ratio: bigint | null; value: bigint }) {
  const s = useSim();
  const notify = useNotify();
  const p = s.position;
  const [amount, setAmount] = useState("");
  const amountE6 = parseUnits(amount, 6);
  const triggerDistance = s.oracle.priceE6 > p.triggerE6 ? Number(((s.oracle.priceE6 - p.triggerE6) * 10000n) / s.oracle.priceE6) / 100 : 0;
  const liqPrice = priceAtRatioE6(p.collateralE18, p.debtE6, LIQ_BPS);
  const targetPrice = priceAtRatioE6(p.collateralE18, p.debtE6, TARGET_BPS);

  return (
    <>
      <div className="grid grid--hero">
        <Card className="card--hero" title="Collateral ratio" actions={<Link to="/protection">Protection settings →</Link>}>
          <p className={`big mono big--${ratioTone(ratio)}`}>{fmtPct(ratio)}</p>
          <RatioMeter bps={ratio} />
          <p className="fine">
            {s.oracle.priceE6 > p.triggerE6 ? (
              <>The price can fall {triggerDistance.toFixed(2)}% before the {fmtPrice(p.triggerE6)} trigger.</>
            ) : (
              <>The price is at or under the {fmtPrice(p.triggerE6)} trigger.</>
            )}
          </p>
        </Card>
        <Card title="Repay by hand" note="From your wallet, any amount up to the debt">
          <div className="form">
            <Field id="repay-amt" label="Amount" suffix="mUSD" value={amount} onChange={setAmount} invalid={amount !== "" && amountE6 === null} hint={<button className="linkish" onClick={() => setAmount(fmtMusd(p.debtE6))}>Repay all {fmtMusd(p.debtE6)}</button>} />
            <div className="btn-row">
              {!s.wallet.musdApproved && (
                <button className="btn btn--ghost btn--sm" onClick={() => notify(actions.approve("musd"))}>
                  Approve mUSD
                </button>
              )}
              <button className="btn btn--primary btn--sm" disabled={!s.wallet.musdApproved || !amountE6} onClick={() => amountE6 && (notify(actions.repay(amountE6)), setAmount(""))}>
                Repay
              </button>
              <button className="btn btn--ghost btn--sm" disabled={p.debtE6 !== 0n} title={p.debtE6 !== 0n ? "Repay the whole debt first" : ""} onClick={() => notify(actions.closePosition())}>
                Close position
              </button>
            </div>
          </div>
        </Card>
      </div>
      <div className="stats">
        <Stat label="Collateral" value={fmtCol(p.collateralE18)} sub="mCOL in the vault" />
        <Stat label="Collateral value" value={fmtUsd(value)} sub={`at ${fmtPrice(s.oracle.priceE6)}`} />
        <Stat label="Debt" value={fmtMusd(p.debtE6)} sub="mUSD" />
        <Stat label="Reserve" value={fmtMusd(p.reserveE6)} sub="mUSD" tone="brand" />
        <Stat label="Price at 150%" value={targetPrice === null ? "—" : fmtPrice(targetPrice)} sub="repay target" />
        <Stat label="Simulated liquidation line" value={liqPrice === null ? "—" : fmtPrice(liqPrice)} sub="price at 120%, display only" tone="bad" />
      </div>
    </>
  );
}
