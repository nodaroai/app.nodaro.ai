"use client"

/**
 * The player's transport (M1, M10 of the inspectors design): ▶ / ⏸, the time
 * "m:ss / m:ss" on the element's own clock — the output clock for a take, the
 * file's clock for the original — and a scrubber. On the original it also
 * names the file ("cam-2"), says when its sound is a camera's scratch audio
 * rather than the render's (R6 a), and marks the auditioned span on the
 * scrubber. The time is read outside React state, so only this re-renders as
 * it plays.
 */
import { useSyncExternalStore } from "react"
import { Pause, Play } from "lucide-react"
import type { ReviewPlayback } from "@/hooks/use-review-playback"
import { positionOf } from "@/lib/edl-review/review-time"
import { useT } from "@/lib/i18n"

export interface PlayerTransportProps {
  readonly playback: ReviewPlayback
  /** There is something on show to play (a take that loads, or an original). */
  readonly ready: boolean
}

export function PlayerTransport({ playback, ready }: PlayerTransportProps) {
  const t = useT()
  const ms = useSyncExternalStore(playback.subscribe, playback.timeMs)
  const durationMs = useSyncExternalStore(playback.subscribe, playback.durationMs)
  const a = playback.tab === "original" ? playback.audition : null
  const span = a?.span && durationMs > 0 ? a.span : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={playback.playing ? t("common.pause") : t("common.play")}
          title={playback.playing ? t("common.pause") : t("common.play")}
          disabled={!ready}
          className="rounded p-1 text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          onClick={playback.toggle}
        >
          {playback.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span dir="ltr" className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {positionOf(ms)} / {positionOf(durationMs)}
        </span>
        <div className="relative min-w-0 flex-1">
          {span && (
            <div
              aria-hidden
              data-testid="audition-span"
              className="pointer-events-none absolute inset-y-0 my-auto h-1.5 rounded-sm bg-emerald-500/40"
              style={{ left: `${(span.inMs / durationMs) * 100}%`, width: `${((span.outMs - span.inMs) / durationMs) * 100}%` }}
            />
          )}
          <input
            type="range"
            aria-label={t("edlReview.position")}
            min={0}
            max={Math.max(1, Math.round(durationMs))}
            step={100}
            value={Math.round(Math.min(ms, durationMs))}
            disabled={!ready || durationMs <= 0}
            className="relative w-full accent-primary"
            onChange={(e) => playback.seek(Number(e.target.value))}
          />
        </div>
      </div>
      {a && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span dir="ltr" className="font-medium text-foreground">{a.sourceId}</span>
          {a.cameraAudio && (
            <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">{t("edlReview.cameraAudio")}</span>
          )}
        </div>
      )}
    </div>
  )
}
