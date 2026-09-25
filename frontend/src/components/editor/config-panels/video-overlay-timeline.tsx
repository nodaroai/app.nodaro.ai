// frontend/src/components/editor/config-panels/video-overlay-timeline.tsx
"use client"

import { useT } from "@/lib/i18n"
import { LAYER_COLORS } from "@/components/editor/composite-preview"

export interface VideoOverlayTimelineBar {
  /** 0-based layer index. */
  readonly index: number
  /** 1-based number the user sees (the canvas slot). */
  readonly n: number
  readonly start: number
  /** Absent = until the video ends. */
  readonly end?: number
}

/** Ruler tick spacing: 1 s up to 10 s, 5 s up to a minute, then 10 s. */
export function videoOverlayTickStep(durationSec: number): number {
  return durationSec <= 10 ? 1 : durationSec <= 60 ? 5 : 10
}

const fmt = (s: number): string => String(Math.round(s * 10) / 10)

/**
 * The read-only timeline overview (UX §2.2): a ruler 0…duration and one bar
 * per layer. `end` absent → the bar runs to the end with an open right cap;
 * `end` past the video → a hatched tail beyond the line; `start` at or past the
 * end → a red stub at the right edge. Clicking a bar selects the layer (the
 * caller also seeks the stage to its start). Positioned divs, not a slider: a
 * slider clamps to [min, max] and would hide exactly the overflow cases.
 */
export function VideoOverlayTimeline({
  bars,
  durationSec,
  selected,
  onSelect,
}: {
  bars: ReadonlyArray<VideoOverlayTimelineBar>
  durationSec: number
  selected: number | null
  onSelect: (index: number) => void
}) {
  const t = useT()
  const d = Math.max(durationSec, 0.001)
  const step = videoOverlayTickStep(d)
  const ticks = Array.from({ length: Math.floor(d / step) + 1 }, (_, i) => i * step)
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / d) * 100))}%`
  return (
    // A time axis runs left → right in every language, so the ruler pins LTR.
    <div dir="ltr" className="space-y-1" aria-label={t("proccfg.videoOverlay.timeline")}>
      <div className="relative h-4 border-b border-border/60 text-[9px] text-muted-foreground tabular-nums">
        {ticks.map((s) => (
          <span key={s} className="absolute top-0 -translate-x-1/2" style={{ left: pct(s) }}>
            {s}
          </span>
        ))}
      </div>
      {bars.map((b) => {
        const color = LAYER_COLORS[b.index % LAYER_COLORS.length]!
        const skipped = b.start >= d
        const end = b.end ?? d
        const clipped = b.end !== undefined && b.end > d
        const label =
          b.end === undefined
            ? t("proccfg.videoOverlay.barLabelToEnd", { n: b.n, start: fmt(b.start) })
            : t("proccfg.videoOverlay.barLabel", { n: b.n, start: fmt(b.start), end: fmt(b.end) })
        return (
          <button
            key={b.index}
            type="button"
            aria-label={label}
            aria-pressed={selected === b.index}
            title={label}
            className={`relative block w-full h-4 rounded-sm bg-muted/30 ${selected === b.index ? "ring-1 ring-[#ff0073]" : ""}`}
            onClick={() => onSelect(b.index)}
          >
            {skipped ? (
              <span className="absolute top-0.5 bottom-0.5 end-0 w-1.5 rounded-sm bg-red-500" />
            ) : (
              <>
                <span
                  className={`absolute top-0.5 bottom-0.5 ${b.end === undefined ? "rounded-s-sm" : "rounded-sm"}`}
                  style={{ left: pct(b.start), width: `calc(${pct(Math.min(end, d))} - ${pct(b.start)})`, background: color }}
                />
                {clipped && (
                  <span
                    className="absolute top-0.5 bottom-0.5 end-0 w-2"
                    style={{ backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 4px)` }}
                  />
                )}
              </>
            )}
            <span className="absolute start-1 top-0 text-[9px] leading-4 text-white/90 mix-blend-difference">{b.n}</span>
          </button>
        )
      })}
    </div>
  )
}
