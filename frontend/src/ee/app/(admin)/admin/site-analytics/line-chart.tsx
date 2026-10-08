import { countText } from "./format"

export interface ChartSeries {
  readonly label: string
  readonly values: readonly number[]
  /** A text-colour class: the line is drawn in currentColor. */
  readonly className: string
}

const W = 800
const H = 160
const PAD = 24

/**
 * Daily lines. Each series is drawn against its own peak (clicks and
 * impressions differ a hundredfold), so the legend names each peak.
 */
export function LineChart({ labels, series, ariaLabel }: { labels: readonly string[]; series: readonly ChartSeries[]; ariaLabel: string }) {
  if (labels.length < 2) {
    return <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Not enough days to draw yet.</div>
  }
  const x = (i: number) => PAD + (i / (labels.length - 1)) * (W - 2 * PAD)
  const lines = series.map((s) => {
    const peak = Math.max(0, ...s.values)
    const y = (v: number) => PAD + (1 - (peak > 0 ? v / peak : 0)) * (H - 2 * PAD)
    const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")
    return { ...s, peak, d }
  })
  const ticks = [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])]

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full h-44" role="img" aria-label={ariaLabel}>
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="currentColor" className="text-border" />
        {lines.map((line) => (
          <path key={line.label} d={line.d} fill="none" stroke="currentColor" strokeWidth={2} className={line.className} />
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H + 8} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted-foreground">
            {labels[i]}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {lines.map((line) => (
          <span key={line.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-0.5 w-4 bg-current ${line.className}`} />
            {line.label} (peak {countText(line.peak)})
          </span>
        ))}
      </div>
    </div>
  )
}
