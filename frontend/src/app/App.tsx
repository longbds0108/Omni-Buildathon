import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { fmtAgo, fmtPrice } from "./lib/format";
import { isLocalSimulation } from "./lib/manifest";
import { isFresh } from "./lib/sim";
import { useNow, useSim } from "./lib/store";
import { ConnectButton, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useSwitchChain } from "wagmi";
import { BASE_SEPOLIA, rainbowTheme, wagmiConfig } from "./lib/wagmi";
import { Pill, ToastProvider } from "./components/ui";
import { Overview } from "./pages/Overview";
import { PositionPage } from "./pages/Position";
import { Protection } from "./pages/Protection";
import { Simulator } from "./pages/Simulator";
import { Activity } from "./pages/Activity";
import { Execution } from "./pages/Execution";

const I = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  overview: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  position: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  protection: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z",
  simulator: "M3 17l6-6 4 4 8-8M15 7h6v6",
  activity: "M3 12h4l3 8 4-16 3 8h4",
  execution: "M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z",
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

const NAV: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: "/", label: "Overview", icon: I.overview, end: true },
  { to: "/position", label: "Position", icon: I.position },
  { to: "/protection", label: "Protection", icon: I.protection },
  { to: "/simulator", label: "Risk Simulator", icon: I.simulator },
  { to: "/activity", label: "Activity", icon: I.activity },
  { to: "/execution", label: "Execution Details", icon: I.execution },
];

/* RainbowKit's modals, drawn with the dashboard's own buttons. */
function WalletButton() {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal, connectModalOpen }) => {
        if (!mounted) return <span className="wallet-slot" aria-hidden="true" />;
        if (!account || !chain)
          return (
            <button className="btn btn--primary btn--sm" onClick={openConnectModal} disabled={connectModalOpen}>
              Connect wallet
            </button>
          );
        if (chain.unsupported)
          return (
            <button
              className="btn btn--warn btn--sm"
              disabled={isPending}
              onClick={() => switchChain({ chainId: BASE_SEPOLIA.id }, { onError: () => openChainModal() })}
            >
              {isPending ? "Switching…" : "Switch to Base Sepolia"}
            </button>
          );
        return (
          <button className="wallet mono" onClick={openAccountModal} title={`${account.address} on ${chain.name}`}>
            <i />
            {account.displayName}
            {account.displayBalance && <span className="wallet__bal">{account.displayBalance}</span>}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function OracleChip() {
  const s = useSim();
  const now = useNow();
  const fresh = isFresh(s, now);
  return (
    <Link to="/simulator" className="oracle-chip" title={`Oracle v${s.oracle.version}, updated ${fmtAgo(s.oracle.updatedAt, now)}`}>
      <span className="mono">{fmtPrice(s.oracle.priceE6)}</span>
      <Pill tone={fresh ? "ok" : "warn"}>{fresh ? `v${s.oracle.version} · fresh` : `v${s.oracle.version} · stale`}</Pill>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`shell ${open ? "is-open" : ""}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="side" aria-label="Dashboard">
        <a className="brand" href="/">
          <img src="/home/assets/img/relay-mark.svg" alt="" width="28" height="28" />
          <span>repay relay</span>
        </a>
        <nav className="side__nav">
          <a className="side__link" href="/">
            <Icon d={I.home} />
            Home
          </a>
          <span className="side__sep">Dashboard</span>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `side__link ${isActive ? "is-active" : ""}`}>
              <Icon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side__foot">
          {isLocalSimulation ? (
            <p>
              <b>Local simulation.</b> Contracts are not deployed yet. Every number follows the vault's integer math, but nothing is sent on chain.
            </p>
          ) : (
            <p>Reading Base Sepolia and Reactive Lasna from the deploy manifest.</p>
          )}
          <span className="mono dim">Base Sepolia 84532 · Lasna 5318007</span>
        </div>
      </aside>
      <button className="scrim" aria-label="Close menu" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="top">
          <button className="top__menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
            <span />
            <span />
          </button>
          <a className="brand brand--sm top__brand" href="/">
            <img src="/home/assets/img/relay-mark.svg" alt="" width="22" height="22" />
            <span>repay relay</span>
          </a>
          <div className="top__right">
            {isLocalSimulation && <span className="simtag simtag--top">Local simulation</span>}
            <OracleChip />
            <WalletButton />
          </div>
        </header>
        <main id="main" className="content">
          {children}
        </main>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p className="lead">
        That page is not part of the dashboard. <Link to="/">Back to Overview</Link>
      </p>
    </div>
  );
}

const queryClient = new QueryClient();

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} initialChain={BASE_SEPOLIA} locale="en-US" appInfo={{ appName: "Repay Relay" }} modalSize="compact">
          <BrowserRouter basename="/app" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ToastProvider>
              <Shell>
                <Routes>
                  <Route index element={<Overview />} />
                  <Route path="position" element={<PositionPage />} />
                  <Route path="protection" element={<Protection />} />
                  <Route path="simulator" element={<Simulator />} />
                  <Route path="activity" element={<Activity />} />
                  <Route path="execution" element={<Execution />} />
                  <Route path="execution/:version" element={<Execution />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Shell>
            </ToastProvider>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
