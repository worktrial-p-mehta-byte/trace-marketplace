"use client";

import { useId, useMemo, useState } from "react";

export interface PricePoint {
  /** ISO timestamp. */
  t: string;
  cents: number;
  reason?: string;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (t: string) =>
  new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Round a step up to 1, 2 or 5 × 10^n cents so axis ticks read cleanly. */
function niceStep(range: number, ticks: number): number {
  const raw = Math.max(1, range / ticks);
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
}

/**
 * Price over time for one listing. A step line (prices hold between
 * updates), a 10% area wash, an end dot with its value, a hairline grid,
 * a hover crosshair with the exact price, and a table view.
 */
export function PriceChart({
  points,
  height = 168,
  compact = false,
  yMax,
  spacing = "time",
  title = "Price history",
}: {
  points: PricePoint[];
  height?: number;
  compact?: boolean;
  /** Shared upper bound so small multiples compare on one scale. */
  yMax?: number;
  /**
   * "time" places changes at their timestamps; "even" gives each change the
   * same width, so a burst of recent changes is not squeezed into the edge.
   */
  spacing?: "time" | "even";
  title?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const pad = { l: compact ? 6 : 44, r: compact ? 44 : 64, t: 12, b: compact ? 8 : 26 };

  const geo = useMemo(() => {
    if (!points.length) return null;
    const pts =
      points.length === 1 ? [points[0]!, { ...points[0]!, t: new Date().toISOString() }] : points;
    const t0 = Date.parse(pts[0]!.t);
    const t1 = Math.max(Date.parse(pts.at(-1)!.t), t0 + 1);
    const top = yMax ?? Math.max(...pts.map((p) => p.cents));
    const step = niceStep(top, 3);
    const yTop = Math.ceil((top * 1.08) / step) * step;
    const span = W - pad.l - pad.r;
    const index = new Map(pts.map((p, i) => [p.t, i]));
    const x = (t: string) =>
      spacing === "even"
        ? pad.l + ((index.get(t) ?? 0) / pts.length) * span
        : pad.l + ((Date.parse(t) - t0) / (t1 - t0)) * span;
    const y = (c: number) => pad.t + (1 - c / yTop) * (height - pad.t - pad.b);
    let d = `M${x(pts[0]!.t)},${y(pts[0]!.cents)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i]!.t)} V${y(pts[i]!.cents)}`;
    // In even spacing each price owns one equal step, the latest included.
    const xEnd = spacing === "even" ? pad.l + span : x(pts.at(-1)!.t);
    d += ` H${xEnd}`;
    const area = `${d} V${y(0)} H${x(pts[0]!.t)} Z`;
    const ticks = Array.from({ length: Math.floor(yTop / step) + 1 }, (_, i) => i * step);
    return { pts, x, xEnd, y, d, area, ticks, t0, t1 };
  }, [points, yMax, height, spacing, pad.l, pad.r, pad.t, pad.b]);

  if (!geo) return <p className="text-sm text-ink-3">No price history yet.</p>;
  const last = geo.pts.at(-1)!;
  const h = hover === null ? null : points[hover];

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 0; i < points.length; i++) if (geo!.x(points[i]!.t) <= px) best = i;
    setHover(best);
  }

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {title}: {points.length} price{points.length === 1 ? "" : "s"}, from{" "}
        {money(points[0]!.cents)} to {money(last.cents)}.
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="block w-full"
          role="img"
          aria-labelledby={`${id}-t`}
        >
          <title id={`${id}-t`}>{title}</title>
          {!compact &&
            geo.ticks.map((c) => (
              <g key={c}>
                <line
                  x1={pad.l}
                  x2={W - pad.r}
                  y1={geo.y(c)}
                  y2={geo.y(c)}
                  stroke="var(--color-rule)"
                  strokeWidth="1"
                />
                <text
                  x={pad.l - 8}
                  y={geo.y(c) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--color-ink-3)"
                >
                  {money(c).replace(".00", "")}
                </text>
              </g>
            ))}
          {compact && (
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={geo.y(0)}
              y2={geo.y(0)}
              stroke="var(--color-rule)"
              strokeWidth="1"
            />
          )}
          <path d={geo.area} fill="var(--color-cobalt)" fillOpacity="0.1" />
          <path
            d={geo.d}
            fill="none"
            stroke="var(--color-cobalt)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={geo.xEnd}
            cy={geo.y(last.cents)}
            r="4.5"
            fill="var(--color-cobalt)"
            stroke="var(--color-surface)"
            strokeWidth="2"
          />
          <text
            x={geo.xEnd + 9}
            y={geo.y(last.cents) + 4}
            fontSize="12"
            fontWeight="600"
            fill="var(--color-ink)"
          >
            {money(last.cents)}
          </text>
          {!compact && (
            <>
              <text x={pad.l} y={height - 6} fontSize="11" fill="var(--color-ink-3)">
                {day(geo.pts[0]!.t)}
              </text>
              <text
                x={W - pad.r}
                y={height - 6}
                fontSize="11"
                textAnchor="end"
                fill="var(--color-ink-3)"
              >
                {day(geo.pts.at(-1)!.t)}
              </text>
            </>
          )}
          {h && (
            <g pointerEvents="none">
              <line
                x1={geo.x(h.t)}
                x2={geo.x(h.t)}
                y1={pad.t}
                y2={height - pad.b}
                stroke="var(--color-ink-3)"
                strokeWidth="1"
              />
              <circle
                cx={geo.x(h.t)}
                cy={geo.y(h.cents)}
                r="4.5"
                fill="var(--color-cobalt)"
                stroke="var(--color-surface)"
                strokeWidth="2"
              />
            </g>
          )}
          <rect
            x={pad.l}
            y={0}
            width={W - pad.l - pad.r}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-rule bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${(geo.x(h.t) / W) * 100}%`,
              transform: geo.x(h.t) > W * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <p className="font-semibold text-ink">{money(h.cents)}</p>
            <p className="text-ink-3">{new Date(h.t).toLocaleString()}</p>
            {h.reason && <p className="text-ink-2">{h.reason}</p>}
          </div>
        )}
      </div>
      {!compact && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink-3">Show as table</summary>
          <table className="mt-2 w-full text-left">
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 pr-3 font-semibold">When</th>
                <th className="py-1 pr-3 font-semibold">Price</th>
                <th className="py-1 font-semibold">Why it changed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i} className="border-t border-rule/60">
                  <td className="py-1 pr-3">{new Date(p.t).toLocaleString()}</td>
                  <td className="py-1 pr-3 font-semibold">{money(p.cents)}</td>
                  <td className="py-1 text-ink-2">{p.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
