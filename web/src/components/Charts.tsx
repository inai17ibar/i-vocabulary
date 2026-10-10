import { useEffect, useRef, useState } from "react";

/**
 * 依存なしの SVG チャート（単系列）。凡例はタイトルが兼ねる。
 * ホバー/フォーカスでツールチップ、<details> で表ビューを提供。
 */
const H = 200;

/** 実寸幅で描画して、文字サイズが画面幅に左右されないようにする */
function useWidth(): [React.RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement | null>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
const PAD = { l: 40, r: 12, t: 12, b: 28 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function BarChart({ data, label, valueLabel }: { data: { x: string; y: number; sub?: string }[]; label: string; valueLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const max = niceMax(Math.max(...data.map((d) => d.y), 1));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const step = iw / data.length;
  const bw = Math.max(2, Math.min(28, step - 2));
  const ticks = [0, max / 2, max];
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(iw / 64)));

  return (
    <figure className="chart" ref={ref} style={{ margin: 0 }} aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.l + i * step + (step - bw) / 2;
          const h = Math.max(0, PAD.t + ih - y(d.y));
          const r = Math.min(4, bw / 2, h);
          // 上端のみ角丸（ベースラインに接する側は直角）
          const path = h > 0
            ? `M${x},${PAD.t + ih} V${PAD.t + ih - h + r} Q${x},${PAD.t + ih - h} ${x + r},${PAD.t + ih - h} H${x + bw - r} Q${x + bw},${PAD.t + ih - h} ${x + bw},${PAD.t + ih - h + r} V${PAD.t + ih} Z`
            : "";
          return (
            <g key={d.x}>
              {path && <path d={path} fill="var(--series-1)" opacity={hover === null || hover === i ? 1 : 0.55} />}
              <rect x={PAD.l + i * step} y={PAD.t} width={step} height={ih} fill="transparent" tabIndex={0}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <title>{`${d.x}: ${d.y} ${valueLabel}`}</title>
              </rect>
              {i % labelEvery === 0 && <text x={PAD.l + i * step + step / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{d.x}</text>}
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--border)" strokeWidth={1} />
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${((PAD.l + hover * step + step / 2) / W) * 100}%`, top: 0, transform: "translateX(-50%)" }}>
          <strong>{data[hover].y} {valueLabel}</strong>
          {data[hover].x}{data[hover].sub ? ` · ${data[hover].sub}` : ""}
        </div>
      )}
      <TableView headers={["", valueLabel]} rows={data.map((d) => [d.x, String(d.y)])} />
    </figure>
  );
}

export function CurveChart({ points, target, label }: { points: { day: number; retention: number }[]; target: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const maxDay = points[points.length - 1]?.day || 1;
  const minR = Math.min(0.5, Math.floor(Math.min(...points.map((p) => p.retention)) * 10) / 10);
  const x = (d: number) => PAD.l + (d / maxDay) * iw;
  const y = (r: number) => PAD.t + ih - ((r - minR) / (1 - minR)) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.retention).toFixed(1)}`).join(" ");
  const ticks = [minR, (minR + 1) / 2, 1];

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const day = ((px - PAD.l) / iw) * maxDay;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(p.day - day) < Math.abs(points[best].day - day)) best = i; });
    setHover(best);
  };
  const hp = hover !== null ? points[hover] : null;

  return (
    <figure className="chart" ref={ref} style={{ margin: 0 }} aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{Math.round(t * 100)}%</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--text-2)" strokeWidth={1} strokeDasharray="4 4" />
        <text x={W - PAD.r} y={y(target) - 6} textAnchor="end" fontSize={11} fill="var(--text-2)">目標 {Math.round(target * 100)}%</text>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={x(maxDay * f)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{Math.round(maxDay * f)}日</text>
        ))}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {hp && (
          <>
            <line x1={x(hp.day)} x2={x(hp.day)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hp.day)} cy={y(hp.retention)} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
        <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(x(hp.day) / W) * 100}%`, top: 0, transform: "translateX(-50%)" }}>
          <strong>{Math.round(hp.retention * 100)}%</strong>
          {hp.day}日後の想起確率
        </div>
      )}
      <TableView headers={["経過日数", "想起確率"]} rows={points.filter((_, i) => i % 5 === 0).map((p) => [`${p.day}日`, `${Math.round(p.retention * 100)}%`])} />
    </figure>
  );
}

function TableView({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <details className="table-view">
      <summary>表で見る</summary>
      <table>
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}
