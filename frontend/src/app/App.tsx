import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ConnectButton, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useSwitchChain } from "wagmi";
import { fmtAgo, fmtPrice, shortHex } from "./lib/format";
import { contracts, dataMode, manifest } from "./lib/manifest";
import { E6, parseUnits } from "./lib/math";
import { STATUS_LABEL, isFresh } from "./lib/sim";
import { actions, useNow, useSim } from "./lib/store";
import { BASE_SEPOLIA, rainbowTheme, wagmiConfig } from "./lib/wagmi";
import { Pill, ToastProvider, useNotify } from "./components/ui";
import { Backdrop } from "./components/visuals";
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
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5",
  menu: "M4 7h16M4 12h16M4 17h16",
  up: "M12 19V5M6 11l6-6 6 6",
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
const navIndex = (path: string) => {
  const i = NAV.findIndex((n) => (n.end ? path === n.to : path.startsWith(n.to)));
  return i === -1 ? 0 : i;
};

/* A stable two-tone avatar from the wallet address. */
function addrAvatar(address: string) {
  const h1 = parseInt(address.slice(2, 6), 16) % 360;
  const h2 = (h1 + 40) % 360;
  return { background: `linear-gradient(140deg, hsl(${h1} 28% 46%), hsl(${h2} 24% 26%))` };
}

/* ───────── Top bar: wallet avatar, RainbowKit behind it ───────── */
function WalletAvatar() {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
        if (!mounted) return <span className="avatar avatar--empty" aria-hidden="true" />;
        if (!account || !chain)
          return (
            <button className="btn btn--ghost btn--sm" onClick={openConnectModal}>
              <span className="lbl-long">Connect wallet</span>
              <span className="lbl-short">Connect</span>
            </button>
          );
        if (chain.unsupported)
          return (
            <button className="btn btn--warn btn--sm" disabled={isPending} onClick={() => switchChain({ chainId: BASE_SEPOLIA.id }, { onError: () => openChainModal() })}>
              {isPending ? "Switching…" : (
                <>
                  <span className="lbl-long">Switch to Base Sepolia</span>
                  <span className="lbl-short">Switch network</span>
                </>
              )}
            </button>
          );
        return (
          <button className="avatar" style={addrAvatar(account.address)} onClick={openAccountModal} title={`${account.address} · ${chain.name}`} aria-label={`Wallet ${account.displayName}`}>
            {account.address.slice(2, 4).toUpperCase()}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

/* ───────── Sidebar profile: the connected wallet ───────── */
function Profile() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal }) => {
        const connected = mounted && account && chain;
        return (
          <button className="profile" onClick={connected ? openAccountModal : openConnectModal} title={connected ? account.address : "Connect a wallet"}>
            {connected ? (
              <span className="avatar" style={addrAvatar(account.address)} aria-hidden="true">
                {account.address.slice(2, 4).toUpperCase()}
              </span>
            ) : (
              <span className="avatar avatar--empty" aria-hidden="true">
                ?
              </span>
            )}
            <span className="profile__text">
              <b>{connected ? shortHex(account.address, 4, 4) : "Read-only"}</b>
              <span>{connected ? (chain.unsupported ? "Wrong network" : chain.name) : "Connect wallet"}</span>
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

/* ───────── Top bar: global search over pages, oracle versions and tx hashes ───────── */
type Hit = { kind: string; label: string; sub: string; to: string; external?: boolean };
function GlobalSearch() {
  const s = useSim();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const term = q.trim().toLowerCase();
  const hits: Hit[] = [];
  if (term) {
    const pages: Hit[] = [
      { kind: "Page", label: "Home", sub: "Repay Relay homepage", to: "/", external: true },
      ...NAV.map((n) => ({ kind: "Page", label: n.label, sub: "Dashboard", to: n.to })),
    ];
    hits.push(...pages.filter((p) => p.label.toLowerCase().includes(term)));
    for (const r of [...s.runs].reverse()) {
      const label = `v${r.version} · ${fmtPrice(r.priceE6)}`;
      const txs: [string, string | undefined][] = [
        ["Price update", r.origin.tx],
        ["Reactive request", r.request?.tx],
        ["Callback", r.callback?.tx],
      ];
      const tx = term.startsWith("0x") && term.length >= 4 ? txs.find(([, h]) => h?.toLowerCase().includes(term)) : undefined;
      if (tx) hits.push({ kind: "Tx", label: shortHex(tx[1]!, 8, 6), sub: `${tx[0]} of oracle v${r.version}`, to: `/execution/${r.version}` });
      else if (`v${r.version} ${label} ${STATUS_LABEL[r.status]}`.toLowerCase().includes(term))
        hits.push({ kind: "Run", label, sub: STATUS_LABEL[r.status], to: `/execution/${r.version}` });
    }
  }
  const list = hits.slice(0, 8);

  const pick = (h?: Hit) => {
    if (!h) return;
    setQ("");
    setOpen(false);
    input.current?.blur();
    if (h.external) window.location.href = h.to;
    else navigate(h.to);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement?.tagName ?? "";
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(t)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="search" role="search">
      <Icon d={I.search} />
      <label htmlFor="global-search" className="sr">
        Search pages, oracle versions and transaction hashes
      </label>
      <input
        ref={input}
        id="global-search"
        type="search"
        placeholder="Search pages, versions, tx hashes"
        autoComplete="off"
        spellCheck={false}
        value={q}
        role="combobox"
        aria-expanded={open && !!term}
        aria-controls="search-results"
        aria-activedescendant={open && list.length ? `hit-${hi}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQ("");
            setOpen(false);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (list.length) setHi((hi + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(list[hi]);
          }
        }}
      />
      <span className="kbd" aria-hidden="true">
        /
      </span>
      {open && term && (
        <ul className="results" id="search-results" role="listbox" aria-label="Search results">
          {list.length ? (
            list.map((h, i) => (
              <li
                key={h.kind + h.label + h.to}
                id={`hit-${i}`}
                role="option"
                aria-selected={i === hi}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
                onMouseEnter={() => setHi(i)}
              >
                <b className={h.kind === "Tx" ? "mono" : ""}>{h.label}</b>
                <span>{h.sub}</span>
                <em>{h.kind}</em>
              </li>
            ))
          ) : (
            <li className="results__empty" role="option" aria-selected={false}>
              Nothing matches “{q.trim()}”. Try a page name, v3 or a tx hash.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ───────── Top bar primary action: push an oracle price ───────── */
function PushPrice() {
  const notify = useNotify();
  const s = useSim();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("1,350");
  const box = useRef<HTMLDivElement>(null);
  const priceE6 = parseUnits(price, 6);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const push = () => {
    if (!priceE6) return;
    notify(actions.pushPrice(priceE6));
    setOpen(false);
  };
  return (
    <div className="push" ref={box}>
      <button className="btn btn--primary btn--sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Icon d={I.up} />
        <span className="push__lbl">Push price</span>
      </button>
      {open && (
        <div className="push__panel" role="dialog" aria-label="Push an oracle price">
          <p className="push__title">Operator · new oracle price</p>
          <p className="push__note">
            Now {fmtPrice(s.oracle.priceE6)} at v{s.oracle.version}. Trigger {fmtPrice(s.routeTriggerE6)}.
            {manifest && <> Signed by the operator {shortHex(contracts.operator)}.</>}
          </p>
          <label className="field__box" htmlFor="push-price">
            <span className="dim">$</span>
            <input
              id="push-price"
              autoFocus
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && push()}
              aria-invalid={!priceE6}
            />
          </label>
          <div className="presets">
            {[1800, 1400, 1350, 1200].map((p) => (
              <button key={p} className={`preset ${priceE6 === BigInt(p) * E6 ? "is-on" : ""}`} onClick={() => setPrice(p.toLocaleString("en-US"))}>
                ${p.toLocaleString("en-US")}
              </button>
            ))}
          </div>
          <button className="btn btn--primary btn--sm btn--block" disabled={!priceE6} onClick={push}>
            Push {priceE6 ? fmtPrice(priceE6) : "price"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────── Where the data comes from ───────── */
function ModeBadge() {
  const s = useSim();
  if (dataMode === "sim") return <span className="simtag simtag--top">Local simulation</span>;
  if (dataMode === "local") return <span className="simtag simtag--top" title="Two anvil chains and a relayer standing in for Reactive Network">Local simulation · anvil</span>;
  const src = s.source;
  return (
    <span className={`live-tag ${src?.error ? "is-bad" : ""}`} title={src?.syncedAt ? `Synced ${new Date(src.syncedAt).toLocaleTimeString()}` : "Syncing"}>
      <i />
      {src?.error ? "RPC error" : src?.syncing ? "Syncing…" : "Base Sepolia · Lasna"}
    </span>
  );
}

function ModeNote() {
  if (dataMode === "testnet") return null;
  if (dataMode === "local")
    return (
      <p className="side__note">
        <b>Local simulation.</b> Two local chains, with a relayer playing Reactive Network. Real contracts, test data.
      </p>
    );
  return (
    <p className="side__note">
      <b>Local simulation.</b> No deployment loaded. Same math as the vault, nothing sent on chain.
    </p>
  );
}

function SyncBanner() {
  const s = useSim();
  if (!s.source?.error) return null;
  return (
    <p className="sync-banner" role="alert">
      Can't reach the chain right now: {s.source.error}. Showing the last data read. Retrying every few seconds.
    </p>
  );
}

function OracleChip() {
  const s = useSim();
  const now = useNow();
  const fresh = isFresh(s, now);
  return (
    <Link to="/simulator" className="oracle-chip" title={`Oracle v${s.oracle.version}, updated ${fmtAgo(s.oracle.updatedAt, now)}`}>
      <span className="mono">{fmtPrice(s.oracle.priceE6)}</span>
      <Pill tone={fresh ? "ok" : "warn"}>{fresh ? `v${s.oracle.version}` : `v${s.oracle.version} stale`}</Pill>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useRef<HTMLUListElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  const active = navIndex(loc.pathname);

  const measure = () => {
    const a = nav.current?.querySelectorAll<HTMLAnchorElement>(".side__link")[active];
    if (a) setPill({ y: a.offsetTop, h: a.offsetHeight });
  };
  useLayoutEffect(measure, [active]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
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
      <Backdrop />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="side" aria-label="Dashboard">
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
        <nav aria-label="Pages">
          <a className="side__home" href="/">
            <Icon d={I.home} />
            <span>Home</span>
          </a>
          <p className="side__label">Dashboard</p>
          <ul className="side__nav" ref={nav}>
            {pill && <li className="side__pill" aria-hidden="true" style={{ transform: `translateY(${pill.y}px)`, height: pill.h }} />}
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} title={n.label} className={({ isActive }) => `side__link ${isActive ? "is-active" : ""}`}>
                  <Icon d={n.icon} />
                  <span>{n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <ModeNote />
        <Profile />
      </aside>
      <button className="scrim" aria-label="Close menu" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />

      <header className="top">
        <button className="top__menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon d={I.menu} />
        </button>
        <GlobalSearch />
        <div className="top__right">
          <ModeBadge />
          <OracleChip />
          <PushPrice />
          <WalletAvatar />
        </div>
      </header>

      <SyncBanner />
      <main id="main" className="content">
        <div className="page" key={loc.pathname}>
          {children}
        </div>
      </main>
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
