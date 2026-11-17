import { useEffect, useState } from "react";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { Backdrop } from "./components/visuals";

/* Shown until a testnet deployment exists. Every value here is read live from the two chains: no sample data. */

const lasna = defineChain({
  id: 5318007,
  name: "Reactive Lasna",
  nativeCurrency: { name: "lREACT", symbol: "lREACT", decimals: 18 },
  rpcUrls: { default: { http: ["https://lasna-rpc.rnk.dev/"] } },
});
const baseClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const lasnaClient = createPublicClient({ chain: lasna, transport: http() });
const PROXY: Address = "0x476F44b11F5C942c58f4c8E3d0300E5710743585";
const SYSTEM: Address = "0x8888888888888888888888888888888888888888";

type ChainState = { block?: bigint; code?: boolean; error?: string };

async function read(client: typeof baseClient | typeof lasnaClient, contract: Address): Promise<ChainState> {
  try {
    const [block, code] = await Promise.all([client.getBlockNumber(), client.getCode({ address: contract })]);
    return { block, code: !!code && code !== "0x" };
  } catch (e) {
    return { error: ((e as { shortMessage?: string }).shortMessage ?? "unreachable").split("\n")[0] };
  }
}

function Row({ name, chainId, s, label }: { name: string; chainId: number; s: ChainState; label: string }) {
  return (
    <div className="nd__chain">
      <div>
        <b>{name}</b>
        <span className="dim mono">chain {chainId}</span>
      </div>
      {s.error ? (
        <span className="pill pill--bad">
          <i />
          {s.error}
        </span>
      ) : s.block === undefined ? (
        <span className="pill">
          <i />
          reading…
        </span>
      ) : (
        <div className="nd__facts mono">
          <span>block {s.block.toLocaleString("en-US")}</span>
          <span className={s.code ? "ok-t" : "bad-t"}>
            {label} {s.code ? "present" : "missing"}
          </span>
        </div>
      )}
    </div>
  );
}

export function NotDeployed() {
  const [base, setBase] = useState<ChainState>({});
  const [las, setLas] = useState<ChainState>({});
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [b, l] = await Promise.all([read(baseClient, PROXY), read(lasnaClient, SYSTEM)]);
      if (alive) {
        setBase(b);
        setLas(l);
      }
    };
    void tick();
    const id = window.setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="nd">
      <Backdrop />
      <main className="nd__card card">
        <a className="brand" href="/">
          <svg className="brand__mark" viewBox="0 0 26 26" aria-hidden="true">
            <path d="M21 13a8 8 0 1 1-2.6-5.9" fill="none" stroke="#ece6d6" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M15.6 4.6h4.2v4.2" fill="none" stroke="#ece6d6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="13" cy="13" r="3.2" fill="#c95d2a" />
          </svg>
          <span className="brand__text">
            <b>repay relay</b>
            <small>dashboard</small>
          </span>
        </a>
        <p className="eyebrow">Not deployed yet</p>
        <h1>The contracts aren't on testnet yet</h1>
        <p className="lead">
          This dashboard only shows real data from Base Sepolia and Reactive Lasna. It will fill in as soon as the deploy script publishes the
          deployment. Until then there is nothing to show, so it shows nothing.
        </p>

        <section className="nd__status" aria-label="Live chain status">
          <p className="label">Live status of the two chains</p>
          <Row name="Base Sepolia" chainId={84532} s={base} label="callback proxy" />
          <Row name="Reactive Lasna" chainId={5318007} s={las} label="system contract" />
        </section>

        <section>
          <p className="label">To deploy, from the deployer wallet</p>
          <pre className="nd__code">
            {`cast wallet import deployer --interactive
cd contracts && ACCOUNT=deployer ./deploy.sh`}
          </pre>
          <p className="fine">
            The wallet needs Base Sepolia ETH and lREACT on Lasna. The script checks both chains, deploys the vault, oracle, tokens, ReactiveRepay and
            RepayReceiver, funds them and writes the manifest that turns this page into the dashboard.
          </p>
        </section>
        <a className="btn btn--ghost btn--sm" href="/">
          Back to the homepage
        </a>
      </main>
    </div>
  );
}
