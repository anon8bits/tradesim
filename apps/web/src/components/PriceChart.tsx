import { useId } from "react";
import type { Direction } from "../lib/money";
import type { PricePoint } from "../lib/price-history";

const WIDTH = 600;
const HEIGHT = 220;
const PAD_X = 20;
const PAD_TOP = 20;
const PAD_BOTTOM = 14;

interface PriceChartProps {
  points: readonly PricePoint[];
  direction: Direction;
}

export function PriceChart({ points, direction }: PriceChartProps) {
  const gradientId = useId();
  const color = direction === "down" ? "var(--loss)" : "var(--gain)";
  const gridLines = [60, 120, 180];

  let line = "";
  let area = "";
  let last: { x: number; y: number } | null = null;

  if (points.length >= 2) {
    let high = points[0].paise;
    let low = points[0].paise;
    for (const point of points) {
      if (point.paise > high) high = point.paise;
      if (point.paise < low) low = point.paise;
    }
    const range = high - low;
    const usable = HEIGHT - PAD_TOP - PAD_BOTTOM;
    // Pixel coordinates only; these numbers never feed back into money math.
    const coords = points.map((point, index) => {
      const x = PAD_X + (index / (points.length - 1)) * (WIDTH - PAD_X * 2);
      const ratio =
        range === 0n
          ? 0.5
          : Number(((point.paise - low) * 10_000n) / range) / 10_000;
      const y = PAD_TOP + (1 - ratio) * usable;
      return { x, y };
    });
    line = coords
      .map(
        (c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`,
      )
      .join(" ");
    area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${HEIGHT - 10} L${coords[0].x.toFixed(1)},${HEIGHT - 10} Z`;
    last = coords[coords.length - 1];
  }

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Session price chart"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((y) => (
          <line
            key={y}
            x1={PAD_X}
            y1={y}
            x2={WIDTH - PAD_X}
            y2={y}
            stroke="var(--border)"
            strokeWidth="1"
          />
        ))}
        {last && (
          <>
            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={last.x} cy={last.y} r="7" fill={color} opacity="0.18" />
            <circle cx={last.x} cy={last.y} r="3.5" fill={color} />
          </>
        )}
      </svg>
      {!last && (
        <div className="chart-empty">
          {points.length === 0
            ? "Waiting for the first price…"
            : "Collecting ticks — the chart draws once the price updates."}
        </div>
      )}
    </div>
  );
}
