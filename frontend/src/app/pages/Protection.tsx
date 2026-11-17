import { useState } from "react";
import { fmtMusd, fmtPrice } from "../lib/format";
import { parseUnits, repayPlan } from "../lib/math";
import { actions, useSim } from "../lib/store";
import { Card, Empty, Field, PageHead, Pill, Row, SimTag, Stat, useNotify } from "../components/ui";
import { Link } from "react-router-dom";

export function Protection() {
  const s = useSim();
  const notify = useNotify();
  const p = s.position;
  const [limit, setLimit] = useState(() => (p.maxRepayE6 > 0n ? fmtMusd(p.maxRepayE6) : "120"));
  const [fund, setFund] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const limitE6 = parseUnits(limit, 6);
  const fundE6 = parseUnits(fund, 6);
  const withdrawE6 = parseUnits(withdraw, 6);
  const atTrigger = repayPlan({ ...p, priceE6: p.triggerE6 });
  const triggersMatch = p.triggerE6 === s.routeTriggerE6;
  const callbacksCovered = atTrigger.amountE6 > 0n ? p.reserveE6 / atTrigger.amountE6 : null;

  return (
    <>
      <PageHead
        eyebrow="Protection"
        title={
          <>
            The repay <em>rule</em>
          </>
        }
        lead="A reserve you fund, a limit per callback and an on/off switch. When the price lands at or under the trigger, the vault repays from the reserve, never from your wallet."
      >
        <SimTag />
      </PageHead>

      {!p.open && (
        <Card>
          <Empty title="No open position" body="Protection belongs to a position. Open one first; the reserve and the rule attach to it." action={<Link className="btn btn--primary btn--sm" to="/position">Open a position</Link>} />
        </Card>
      )}

      <div className="stats">
        <Stat label="Protection" value={p.enabled ? "On" : "Off"} tone={p.enabled ? "ok" : "warn"} sub={p.enabled ? "callbacks can repay" : "callbacks are skipped"} />
        <Stat label="Reserve" value={fmtMusd(p.reserveE6)} sub="mUSD" tone="brand" />
        <Stat label="Max per repay" value={fmtMusd(p.maxRepayE6)} sub="mUSD per callback" />
        <Stat label="Next repay at trigger" value={fmtMusd(atTrigger.amountE6)} sub={callbacksCovered === null ? "nothing to repay" : `reserve covers ${callbacksCovered} such repay${callbacksCovered === 1n ? "" : "s"}`} />
      </div>

      <div className="grid grid--2">
        <Card title="Rule" note="One configuration call sets the limit and the switch together" actions={<Pill tone={p.enabled ? "ok" : "warn"}>{p.enabled ? "Enabled" : "Disabled"}</Pill>}>
          <div className="form">
            <Field id="limit" label="Max repay per callback" suffix="mUSD" value={limit} onChange={setLimit} invalid={limitE6 === null} hint="The vault never repays more than this in one callback." />
            <div className="btn-row">
              <button className="btn btn--primary btn--sm" disabled={!p.open || limitE6 === null} onClick={() => limitE6 !== null && notify(actions.configureProtection(limitE6, p.enabled || limitE6 > 0n))}>
                Save limit
              </button>
              <button className="btn btn--ghost btn--sm" disabled={!p.open || limitE6 === null} onClick={() => limitE6 !== null && notify(actions.configureProtection(limitE6, !p.enabled))}>
                {p.enabled ? "Turn protection off" : "Turn protection on"}
              </button>
            </div>
            <p className="fine">
              Each configuration records the oracle version at that moment, now <b className="mono">v{p.configVersion}</b>. Callbacks for that version or older are ignored, so an old request can never act on a changed rule.
            </p>
          </div>
        </Card>

        <Card title="Reserve" note="mUSD you set aside. Only you can withdraw it.">
          <div className="form">
            <Field id="fund" label="Add to reserve" suffix="mUSD" value={fund} onChange={setFund} invalid={fund !== "" && fundE6 === null} hint={`Wallet holds ${fmtMusd(s.wallet.musdE6)} mUSD`} />
            <div className="btn-row">
              {!s.wallet.musdApproved && (
                <button className="btn btn--ghost btn--sm" onClick={() => notify(actions.approve("musd"))}>
                  Approve mUSD
                </button>
              )}
              <button className="btn btn--primary btn--sm" disabled={!s.wallet.musdApproved || !fundE6} onClick={() => fundE6 && (notify(actions.fundReserve(fundE6)), setFund(""))}>
                Fund reserve
              </button>
            </div>
            <Field id="withdraw" label="Withdraw from reserve" suffix="mUSD" value={withdraw} onChange={setWithdraw} invalid={withdraw !== "" && withdrawE6 === null} hint={<button className="linkish" onClick={() => setWithdraw(fmtMusd(p.reserveE6))}>Withdraw all {fmtMusd(p.reserveE6)}</button>} />
            <div className="btn-row">
              <button className="btn btn--ghost btn--sm" disabled={!withdrawE6} onClick={() => withdrawE6 && (notify(actions.withdrawReserve(withdrawE6)), setWithdraw(""))}>
                Withdraw
              </button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Triggers" note="The route and the vault each check the price" actions={<Pill tone={triggersMatch ? "ok" : "bad"}>{triggersMatch ? "Match" : "Mismatch"}</Pill>}>
          <div className="kvs">
            <Row k="Route trigger · ReactiveRepay on Lasna" v={fmtPrice(s.routeTriggerE6)} />
            <Row k="Vault trigger · LendingVault on Base Sepolia" v={fmtPrice(p.triggerE6)} />
            <Row k="Target after repay" v="150%" />
            <Row k="Price freshness" v="15 min" />
          </div>
          <p className="fine">
            The route decides whether to ask for a callback. The vault's own configuration has the final word. Changing the route trigger takes a new deployment of ReactiveRepay. The limit, the reserve and the switch change here.
          </p>
        </Card>

        <Card title={`At ${fmtPrice(p.triggerE6)}`} note="The next callback, with today's balances">
          {p.open && p.debtE6 > 0n ? (
            <div className="kvs">
              <Row k="Debt − target" v={`${fmtMusd(atTrigger.gapE6)} mUSD`} />
              <Row k="Reserve" v={`${fmtMusd(p.reserveE6)} mUSD`} />
              <Row k="Limit" v={`${fmtMusd(p.maxRepayE6)} mUSD`} />
              <Row k="Repay = the smallest of the three" v={`${fmtMusd(atTrigger.amountE6)} mUSD`} />
              <Row k="Debt after" v={`${fmtMusd(atTrigger.debtAfterE6)} mUSD`} />
            </div>
          ) : (
            <Empty title="Nothing to repay" body="There is no open debt." />
          )}
        </Card>
      </div>
    </>
  );
}
