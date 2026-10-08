"use client"

/**
 * The review minimap (§2.3 of the inspectors design): the whole source on one
 * strip over the master timeline, "0:00 ── source ── 58:40".
 *  - A `<canvas>`: each pixel column in its dominant state (minimap.ts) — kept
 *    neutral, cut in its reason's colour, restored hatched. Painted after the
 *    commit from the edit as deferred, so a cut's keystroke never waits on it.
 *  - The rows the transcript has on screen, as a window, and the player's
 *    playhead (read outside React state, so only the playhead re-renders as it
 *    plays).
 *  - A click or a drag scrolls the transcript there; so do ← and → (by a
 *    twentieth of the source) on the focused strip.
 * Also here: the find row's Follow playback switch.
 */
import { useDeferredValue, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react"
import { Check } from "lucide-react"
import type { Edl } from "@nodaro/shared"
import type { ReviewPlayback } from "@/hooks/use-review-playback"
import { dropReasonStyle } from "@/lib/edl-review/drop-reasons"
import { keptSetOf, type KeptSet } from "@/lib/edl-review/kept-set"
import { minimapColumns, minimapMsAt } from "@/lib/edl-review/minimap"
import { planSourceMs } from "@/lib/edl-review/review-stats"
import { positionOf } from "@/lib/edl-review/review-time"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const STRIP_PX = 14
const KEPT_COLOR = "rgba(148, 163, 184, 0.55)"
const RESTORED_COLOR = "rgba(148, 163, 184, 0.25)"
const HATCH_COLOR = "rgba(100, 116, 139, 0.9)"

export interface ReviewMinimapProps {
  readonly base: Edl
  /** The edit as it stands (the plan as received when it can't be edited). */
  readonly edited: Edl
  readonly kept: KeptSet | null
  /** The master span of the rows on screen; null before they are laid out. */
  readonly onScreen: { readonly inMs: number; readonly outMs: number } | null
  readonly playback: ReviewPlayback
  readonly onScrollTo: (ms: number) => void
}

const percent = (ms: number, sourceMs: number): string => `${Math.min(100, Math.max(0, (ms / sourceMs) * 100))}%`

function paint(canvas: HTMLCanvasElement, width: number, columns: ReturnType<typeof minimapColumns>): void {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(STRIP_PX * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, STRIP_PX)
  columns.forEach((c, x) => {
    if (c.state === "none") return
    ctx.fillStyle = c.state === "cut" ? dropReasonStyle(c.reason).color : c.state === "kept" ? KEPT_COLOR : RESTORED_COLOR
    ctx.fillRect(x, 0, 1, STRIP_PX)
    if (c.state !== "restored") return
    ctx.fillStyle = HATCH_COLOR
    for (let y = (4 - (x % 4)) % 4; y < STRIP_PX; y += 4) ctx.fillRect(x, y, 1, 1)
  })
}

function Playhead({ playback, sourceMs }: { readonly playback: ReviewPlayback; readonly sourceMs: number }) {
  const ms = useSyncExternalStore(playback.subscribe, playback.masterMs)
  if (ms === null) return null
  return <div data-testid="minimap-playhead" className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: percent(ms, sourceMs) }} />
}

export function ReviewMinimap({ base, edited, kept, onScreen, playback, onScrollTo }: ReviewMinimapProps) {
  const t = useT()
  const sourceMs = planSourceMs(base)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(0)
  const shown = useDeferredValue(edited)
  const shownKept = useDeferredValue(kept)
  const pressed = useRef(false)

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    setWidth(Math.floor(strip.getBoundingClientRect().width))
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0]
      setWidth(Math.floor(box ? box.inlineSize : strip.getBoundingClientRect().width))
    })
    observer.observe(strip)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const columns = minimapColumns({ base, edited: shown, kept: shownKept ?? keptSetOf(shown), sourceMs, columns: width })
    paint(canvas, width, columns)
  }, [width, base, shown, shownKept, sourceMs])

  const scrollAt = (clientX: number) => {
    const box = stripRef.current?.getBoundingClientRect()
    if (box) onScrollTo(minimapMsAt(clientX - box.left, box.width, sourceMs))
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.button ?? 0) !== 0) return
    pressed.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    scrollAt(e.clientX)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (pressed.current) scrollAt(e.clientX)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (step === 0 || sourceMs <= 0) return
    e.preventDefault()
    onScrollTo(Math.min(sourceMs, Math.max(0, (onScreen?.inMs ?? 0) + (step * sourceMs) / 20)))
  }

  if (sourceMs <= 0) return null
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <div
        ref={stripRef}
        role="slider"
        tabIndex={0}
        aria-label={t("edlReview.minimap")}
        aria-valuemin={0}
        aria-valuemax={Math.round(sourceMs)}
        aria-valuenow={Math.round(onScreen?.inMs ?? 0)}
        aria-valuetext={positionOf(onScreen?.inMs ?? 0)}
        data-testid="review-minimap"
        className="relative h-3.5 min-w-0 flex-1 cursor-pointer touch-none overflow-hidden rounded-sm bg-muted/40 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (pressed.current = false)}
        onPointerCancel={() => (pressed.current = false)}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
        {onScreen && (
          <div
            data-testid="minimap-window"
            className="pointer-events-none absolute inset-y-0 rounded-sm border border-foreground/70"
            style={{ left: percent(onScreen.inMs, sourceMs), width: percent(Math.max(0, onScreen.outMs - onScreen.inMs), sourceMs) }}
          />
        )}
        <Playhead playback={playback} sourceMs={sourceMs} />
      </div>
      <span dir="ltr" className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {positionOf(0)} ── {t("edlReview.minimapSource")} ── {positionOf(sourceMs)}
      </span>
    </div>
  )
}

/** "[✓ Follow playback]": the transcript marks the word playing and keeps it on screen. */
export function FollowToggle({ on, onChange }: { readonly on: boolean; readonly onChange: (on: boolean) => void }) {
  const t = useT()
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn("ms-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs", on ? "text-foreground" : "text-muted-foreground", "hover:bg-muted")}
      onClick={() => onChange(!on)}
    >
      <span className={cn("inline-flex h-3 w-3 items-center justify-center rounded-sm border border-border", on && "border-primary bg-primary text-primary-foreground")}>
        {on && <Check className="h-2.5 w-2.5" />}
      </span>
      {t("edlReview.followPlayback")}
    </button>
  )
}
