import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtPct, fmtPrice } from "../lib/format";
import { E6, LIQ_BPS, OPEN_MIN_BPS, TARGET_BPS } from "../lib/math";
import { STATUS_LABEL, type Run } from "../lib/sim";

/* ───────── Motion helpers: 200–300 ms, skipped under reduced motion ───────── */

export const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function resample(vals: number[], n: number): number[] {
  if (vals.length === 0) return new Array(n).fill(0);
  if (vals.length === 1) return new Array(n).fill(vals[0]);
  return Array.from({ length: n }, (_, i) => {
    const x = (i * (vals.length - 1)) / Math.max(1, n - 1);
    const a = Math.floor(x);
    const b = Math.min(vals.length - 1, a + 1);
    return vals[a] + (vals[b] - vals[a]) * (x - a);
  });
}

/** Animates an array of numbers toward `target`; a length change morphs from the resampled old shape. */
export function useTweenArray(target: number[], ms = 280): number[] {
  const [val, setVal] = useState(target);
  const cur = useRef(target);
  const key = target.join(",");
  useEffect(() => {
    const from = cur.current.length === target.length ? cur.current : resample(cur.current, target.length);
    if (reduceMotion() || cur.current.length === 0) {
      cur.current = target;
      setVal(target);
      return;
    }
    const t0 = performance.now();
    let id = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const k = 1 - Math.pow(1 - t, 3);
      const v = target.map((x, i) => from[i] + (x - from[i]) * k);
      cur.current = v;
      setVal(v);
      if (t < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return val;
}

export const useTweenNumber = (target: number, ms = 260) => useTweenArray([target], ms)[0];

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ───────── Collateral ratio gauge: a 270° arc from 100% to 200% ───────── */

const G = { cx: 110, cy: 112, r: 82, a0: 135, a1: 405, lo: 100, hi: 200 };
const polar = (deg: number, r = G.r) => {
  const a = (deg * Math.PI) / 180;
  return [G.cx + r * Math.cos(a), G.cy + r * Math.sin(a)] as const;
};
const angleOf = (pct: number) => G.a0 + ((G.a1 - G.a0) * (Math.min(G.hi, Math.max(G.lo, pct)) - G.lo)) / (G.hi - G.lo);
const ARC = (() => {
  const [sx, sy] = polar(G.a0);
  const [ex, ey] = polar(G.a1);
  return `M${sx.toFixed(2)} ${sy.toFixed(2)} A${G.r} ${G.r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
})();

export function RatioGauge({ bps, label = "collateral ratio" }: { bps: bigint | null; label?: string }) {
  const pct = bps === null ? G.hi : Number(bps) / 100;
  const shown = useTweenNumber(pct);
  const tone = bps === null ? "good" : bps < LIQ_BPS ? "bad" : bps < TARGET_BPS ? "warn" : "good";
  const frac = (Math.min(G.hi, Math.max(G.lo, pct)) - G.lo) / (G.hi - G.lo);
  const marks: [bigint, string][] = [
    [LIQ_BPS, "liq"],
    [TARGET_BPS, "target"],
    [OPEN_MIN_BPS, "open"],
  ];
  return (
    <div className="gauge" role="img" aria-label={`${label} ${fmtPct(bps)}`}>
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <path className="g-track" d={ARC} />
        <path className={`g-val g-val--${tone}`} d={ARC} pathLength={100} strokeDasharray="100" style={{ strokeDashoffset: 100 - frac * 100 }} />
        {marks.map(([m, k]) => {
          const deg = angleOf(Number(m) / 100);
          const [ix, iy] = polar(deg, G.r - 9);
          const [ox, oy] = polar(deg, G.r + 9);
          const [tx, ty] = polar(deg, G.r + 20);
          return (
            <g key={k} className={`g-mark g-mark--${k}`}>
              <line x1={ix} y1={iy} x2={ox} y2={oy} />
              <text x={tx} y={ty + 3.5} textAnchor="middle">
                {Number(m) / 100}%
              </text>
            </g>
          );
        })}
        {[G.lo, G.hi].map((v) => {
          const [tx, ty] = polar(angleOf(v), G.r + 20);
          return (
            <text key={v} className="g-tick" x={tx} y={ty + 14} textAnchor="middle">
              {v === G.hi ? "200%+" : "100%"}
            </text>
          );
        })}
      </svg>
      <div className="g-center">
        <strong className="mono">{bps === null ? "No debt" : `${shown.toFixed(2)}%`}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

/* ───────── Oracle price by version: burnt orange area chart with the trigger line ───────── */

export function PriceChart({ runs, triggerE6 }: { runs: Run[]; triggerE6: bigint }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const navigate = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const prices = runs.map((r) => Number(r.priceE6 / E6));
  const trig = Number(triggerE6 / E6);
  const lo0 = Math.min(trig, ...prices);
  const hi0 = Math.max(trig, ...prices);
  const span = Math.max(100, hi0 - lo0);
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const lo = Math.floor((lo0 - span * 0.15) / step) * step;
  const hi = Math.ceil((hi0 + span * 0.15) / step) * step;
  const vals = useTweenArray([...prices, lo, hi], 300);
  const pv = vals.slice(0, -2);
  const [tlo, thi] = vals.slice(-2);

  const H = 220;
  const M = { l: 54, r: 14, t: 14, b: 26 };
  const pw = Math.max(1, W - M.l - M.r);
  const ph = H - M.t - M.b;
  const count = Math.max(1, pv.length);
  const x = (i: number) => M.l + (count === 1 ? pw / 2 : (i * pw) / (count - 1));
  const y = (v: number) => M.t + (1 - (v - tlo) / Math.max(1e-9, thi - tlo)) * ph;
  const pts = pv.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const ticks: number[] = [];
  for (let v = Math.ceil(tlo / step) * step; v <= thi + 1e-6; v += step) ticks.push(v);
  const every = Math.ceil(runs.length / Math.max(2, Math.floor(pw / 56)));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left - M.l) / pw;
    setHover(Math.min(runs.length - 1, Math.max(0, Math.round(f * (runs.length - 1)))));
  };
  const h = hover !== null ? runs[hover] : null;

  return (
    <div className="pchart" ref={ref}>
      {W > 0 && runs.length > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Oracle price by version">
          <defs>
            <linearGradient id="pfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.36" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line className="c-grid" x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
              <text className="c-tick" x={M.l - 8} y={y(t) + 3.5} textAnchor="end">
                ${t.toLocaleString("en-US")}
              </text>
            </g>
          ))}
          <line className="c-trigger" x1={M.l} x2={W - M.r} y1={y(trig)} y2={y(trig)} />
          <text className="c-tlabel" x={W - M.r - 2} y={y(trig) - 6} textAnchor="end">
            trigger {fmtPrice(triggerE6)}
          </text>
          {count > 1 && <path d={`M${pts.join("L")}L${x(count - 1)},${M.t + ph}L${x(0)},${M.t + ph}Z`} fill="url(#pfill)" />}
          {count > 1 && <path className="c-line" d={`M${pts.join("L")}`} />}
          {runs.map((r, i) =>
            i % every === 0 || i === runs.length - 1 ? (
              <text key={r.version} className="c-tick" x={x(i)} y={H - 7} textAnchor={count === 1 ? "middle" : i === 0 ? "start" : i === runs.length - 1 ? "end" : "middle"}>
                v{r.version}
              </text>
            ) : null,
          )}
          {runs.map((r, i) => (
            <circle
              key={r.version}
              className={`c-pt c-pt--${r.status}`}
              cx={x(i)}
              cy={y(pv[i] ?? 0)}
              r={i === runs.length - 1 ? 5 : 3.5}
              onClick={() => navigate(`/execution/${r.version}`)}
            />
          ))}
          {h && hover !== null && <line className="c-hair" x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ph} />}
        </svg>
      )}
      {h && hover !== null && (
        <div className="c-tip" style={{ left: Math.min(W - 90, Math.max(90, x(hover))) }}>
          <b className="mono">
            v{h.version} · {fmtPrice(h.priceE6)}
          </b>
          <span>{STATUS_LABEL[h.status]}</span>
        </div>
      )}
    </div>
  );
}

/* ───────── Backdrop: a darkened tower facade seen from the street ───────── */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawFacade(c: HTMLCanvasElement) {
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#22231e");
  sky.addColorStop(0.55, "#3b3a30");
  sky.addColorStop(1, "#6e563e");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const r = rng(42);
  type P = [number, number];
  const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const face = (bl: P, br: P, tr: P, tl: P, rows: number, cols: number, base: number) => {
    const at = (u: number, v: number) => lerp(lerp(bl, br, u), lerp(tl, tr, u), v);
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = at(j / cols, i / rows);
        const b = at((j + 1) / cols, i / rows);
        const cc = at((j + 1) / cols, (i + 1) / rows);
        const d = at(j / cols, (i + 1) / rows);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.lineTo(cc[0], cc[1]);
        g.lineTo(d[0], d[1]);
        g.closePath();
        const lit = r() < 0.07;
        const l = base + r() * 7 - 3 + (i / rows) * 12;
        g.fillStyle = lit ? `hsla(${28 + r() * 12}, 70%, ${52 + r() * 12}%, 0.9)` : `hsl(${68 + r() * 22}, 7%, ${Math.max(5, l)}%)`;
        g.fill();
        g.strokeStyle = "rgba(232, 226, 210, 0.11)";
        g.lineWidth = 1;
        g.stroke();
      }
  };
  face([0.66 * w, h], [0.82 * w, h], [0.79 * w, 0.1 * h], [0.69 * w, 0.1 * h], 24, 6, 16);
  face([0.82 * w, h], [1.04 * w, h], [0.9 * w, 0.1 * h], [0.79 * w, 0.1 * h], 24, 8, 11);
  face([0, h], [0.3 * w, h * 1.01], [0.31 * w, -0.05 * h], [0.17 * w, -0.05 * h], 34, 9, 12);
  face([0.3 * w, h * 1.01], [0.52 * w, h], [0.42 * w, -0.05 * h], [0.31 * w, -0.05 * h], 34, 7, 20);
  const n = document.createElement("canvas");
  n.width = n.height = 128;
  const ng = n.getContext("2d");
  if (!ng) return;
  const img = ng.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  ng.putImageData(img, 0, 0);
  const pat = g.createPattern(n, "repeat");
  if (pat) {
    g.fillStyle = pat;
    g.fillRect(0, 0, w, h);
  }
}

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    drawFacade(c);
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(() => drawFacade(c), 200);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <>
      <canvas ref={ref} className="backdrop" aria-hidden="true" />
      <div className="veil" aria-hidden="true" />
    </>
  );
}
