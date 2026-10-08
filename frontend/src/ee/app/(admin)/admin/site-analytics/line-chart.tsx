import { countText } from "./format"

export interface ChartSeries {
  readonly label: string
  readonly values: readonly number[]
  /** A text-colour class: the line is drawn in currentColor. */
  readonly className: string
}

const W = 1000
const H = 160
const PAD_Y = 12

/**
 * Daily lines across the whole width of the section. Each series is drawn
 * against its own peak (clicks and impressions differ a hundredfold), so the
 * legend names each peak. The drawing stretches to its box — the strokes keep
 * their thickness — and the day labels sit outside it, so they never stretch.
 */
export function LineChart({ labels, series, ariaLabel }: { labels: readonly string[]; series: readonly ChartSeries[]; ariaLabel: string }) {
  if (labels.length < 2) {
    return <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Not enough days to draw yet.</div>
  }
  const last = labels.length - 1
  const x = (i: number) => (i / last) * W
  const lines = series.map((s) => {
    const peak = Math.max(0, ...s.values)
    const y = (v: number) => PAD_Y + (1 - (peak > 0 ? v / peak : 0)) * (H - 2 * PAD_Y)
    const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")
    return { ...s, peak, d }
  })
  const middle = Math.floor(last / 2)

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-40" role="img" aria-label={ariaLabel}>
        <line x1={0} x2={W} y1={H - PAD_Y} y2={H - PAD_Y} stroke="currentColor" vectorEffect="non-scaling-stroke" className="text-border" />
        {lines.map((line) => (
          <path key={line.label} d={line.d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={line.className} />
        ))}
      </svg>
      {/* Placed like the drawing — left to right — whatever the page direction. */}
      <div className="relative h-4 text-[11px] text-muted-foreground" dir="ltr">
        <span className="absolute left-0">{labels[0]}</span>
        {middle > 0 && (
          <span className="absolute -translate-x-1/2" style={{ left: `${(middle / last) * 100}%` }}>
            {labels[middle]}
          </span>
        )}
        <span className="absolute right-0">{labels[last]}</span>
      </div>
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
