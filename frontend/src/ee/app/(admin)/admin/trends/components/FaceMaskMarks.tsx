// The face mask's marks (decided 2026-10-26): faces the mask should leave
// uncovered. On the mask preview, pause, drag a box over the face, and set the
// frames it holds on from the scrubber (In / Out; a new box holds on the whole
// clip). Every face whose centre is inside a box, on its frames, is left out of
// the next mask. The list below the video edits and deletes them; the panel
// saves them and makes the mask again ("Apply edits").
//
// Who a box is for (decided 2026-10-27): "Everyone" leaves the face unmasked on
// every run (an erased mark); an optional person makes it that person's box (a
// slot mark): the face is left unmasked only in the person masks made for runs
// that leave that person empty. New boxes take the last choice, so one person
// is quick to mark across shots; each person has a colour, and the list counts
// each one's boxes.
//
// Boxes are in % of the PICTURE, not of the player: the video is letterboxed
// (object-contain), so the picture's own rectangle inside the element is what a
// box is measured against (`pictureRect`).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Pause, Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CAST_SWAP_FACE_MASK_MARK_LIMITS } from "@nodaro/render-rules"
import type { AdminTrendFaceMaskMark, AdminTrendFaceMaskMarkLabel } from "@/lib/api"

/** The most marks a face mask takes (the server's own limit). */
export const MAX_FACE_MASK_MARKS = CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarks
/** The smallest box a drag makes, % of the picture on each side: a click is not a box. */
const MIN_BOX_PCT = 1

/** Absorbs float noise at a frame's start (a time of exactly n / fps reads as frame n, not n − 1). */
const FRAME_EPSILON = 1e-6

/**
 * The frame shown at `time` (0-based, clamped to the mask's `frames`). With
 * the clip's video frame rate `fps`: `floor(time × fps)` — the container's
 * `duration` can run past the picture (the sound can be longer). Without it
 * (a mask approved before its rate was kept), `duration` stands in.
 */
export function frameAt(time: number, duration: number, frames: number, fps?: number): number {
  if (!(frames > 0) || !Number.isFinite(time)) return 0
  const raw = fps && fps > 0 ? time * fps + FRAME_EPSILON : duration > 0 ? (time / duration) * frames : 0
  return Math.min(frames - 1, Math.max(0, Math.floor(raw)))
}

/** The time that shows frame `frame` (its middle, so a seek lands on it): `(frame + 0.5) / fps`, else on the duration. */
export function timeOfFrame(frame: number, duration: number, frames: number, fps?: number): number {
  if (fps && fps > 0) return (frame + 0.5) / fps
  if (!(frames > 0) || !(duration > 0)) return 0
  return ((frame + 0.5) / frames) * duration
}

/** The picture's rectangle inside an element of `elW × elH` showing a `vidW × vidH` video letterboxed (object-contain). */
export function pictureRect(elW: number, elH: number, vidW: number, vidH: number): { x: number; y: number; w: number; h: number } {
  if (!(vidW > 0) || !(vidH > 0) || !(elW > 0) || !(elH > 0)) return { x: 0, y: 0, w: elW, h: elH }
  const scale = Math.min(elW / vidW, elH / vidH)
  const w = vidW * scale
  const h = vidH * scale
  return { x: (elW - w) / 2, y: (elH - h) / 2, w, h }
}

const clampPct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10

/** An optional person a box can be for: its slot key and its label. */
export interface MarkPerson {
  readonly key: string
  readonly label: string
}

/** The picker's value for a label: "erased", or `slot:<key>`. */
export const labelValue = (label: AdminTrendFaceMaskMarkLabel): string => (label === "erased" ? "erased" : `slot:${label.slot}`)
/** The label a picker value names (anything not `slot:<key>` is "erased"). */
export const labelOf = (value: string): AdminTrendFaceMaskMarkLabel => (value.startsWith("slot:") ? { slot: value.slice(5) } : "erased")

/** Each person's box colour, in the order the people are listed; "Everyone" is amber. */
const PERSON_COLOURS = ["border-fuchsia-500", "border-emerald-500", "border-violet-500", "border-rose-500", "border-teal-500", "border-indigo-500"]

/** The box colour of a mark: amber for everyone, else its person's (by their place in `people`). */
export function markColour(label: AdminTrendFaceMaskMarkLabel, people: readonly MarkPerson[]): string {
  if (label === "erased") return "border-amber-400"
  const i = people.findIndex((p) => p.key === label.slot)
  return PERSON_COLOURS[(i < 0 ? 0 : i) % PERSON_COLOURS.length]!
}

/** Who a mark is for, as the list says it. */
export function markWho(label: AdminTrendFaceMaskMarkLabel, people: readonly MarkPerson[]): string {
  if (label === "erased") return "Everyone"
  return people.find((p) => p.key === label.slot)?.label ?? label.slot
}

/** How many boxes each one has: "Everyone" first, then the people in order (only those with boxes). */
export function markCounts(marks: readonly AdminTrendFaceMaskMark[], people: readonly MarkPerson[]): Array<{ who: string; count: number }> {
  const count = (v: string) => marks.filter((m) => labelValue(m.label) === v).length
  return [{ who: "Everyone", count: count("erased") }, ...people.map((p) => ({ who: p.label, count: count(`slot:${p.key}`) }))].filter((c) => c.count > 0)
}

/** A mark from a drag between two points (% of the picture), over the whole clip; null when too small. */
export function markFromDrag(
  a: { x: number; y: number },
  b: { x: number; y: number },
  frames: number,
  label: AdminTrendFaceMaskMarkLabel = "erased",
): AdminTrendFaceMaskMark | null {
  const leftPct = clampPct(Math.min(a.x, b.x))
  const rightPct = clampPct(Math.max(a.x, b.x))
  const topPct = clampPct(Math.min(a.y, b.y))
  const bottomPct = clampPct(Math.max(a.y, b.y))
  if (rightPct - leftPct < MIN_BOX_PCT || bottomPct - topPct < MIN_BOX_PCT) return null
  return { label: label === "erased" ? "erased" : { slot: label.slot }, fromFrame: 0, toFrame: Math.max(0, frames - 1), leftPct, topPct, rightPct, bottomPct }
}

/** The mark starting (In) or ending (Out) at `frame`; the other end moves with it when it would cross. */
export function withRangeEnd(mark: AdminTrendFaceMaskMark, end: "in" | "out", frame: number): AdminTrendFaceMaskMark {
  return end === "in"
    ? { ...mark, fromFrame: frame, toFrame: Math.max(frame, mark.toFrame) }
    : { ...mark, toFrame: frame, fromFrame: Math.min(frame, mark.fromFrame) }
}

interface Props {
  readonly url: string
  readonly label: string
  /** The mask's frame count: frames are counted on it. */
  readonly frames: number
  /** The clip's video frame rate, when known (frames are counted by it; else on its duration). */
  readonly fps?: number
  readonly marks: readonly AdminTrendFaceMaskMark[]
  readonly onChange: (marks: AdminTrendFaceMaskMark[]) => void
  readonly disabled?: boolean
  /** The trend's optional people a box can be for (none: every box is for everyone). */
  readonly people?: readonly MarkPerson[]
}

const NO_PEOPLE: readonly MarkPerson[] = []

export function FaceMaskMarksEditor({ url, label, frames, fps, marks, onChange, disabled, people = NO_PEOPLE }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(0)
  const [duration, setDuration] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 })
  // Who a new box is for: the last choice (a person who is no longer optional falls back to everyone).
  const [who, setWho] = useState("erased")
  const whoNow = who === "erased" || people.some((p) => `slot:${p.key}` === who) ? who : "erased"

  // The picture's rectangle, kept in step with the element's size and the video's own.
  const measure = () => {
    const el = video.current
    if (!el) return
    setBox(pictureRect(el.clientWidth, el.clientHeight, el.videoWidth, el.videoHeight))
  }
  useEffect(() => {
    const el = video.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (selected !== null && selected >= marks.length) setSelected(null)
  }, [marks.length, selected])

  const lastFrame = Math.max(0, frames - 1)
  const toggle = () => {
    const el = video.current
    if (!el) return
    if (el.paused) void el.play()?.catch(() => undefined)
    else el.pause()
  }
  const seek = (f: number) => {
    const el = video.current
    if (!el) return
    el.pause()
    el.currentTime = timeOfFrame(f, duration || el.duration, frames, fps)
    setFrame(f)
  }

  /** The pointer's point in % of the picture. */
  const pointOf = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = surface.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / (r.width || 1)) * 100, y: ((e.clientY - r.top) / (r.height || 1)) * 100 }
  }
  const canDraw = !disabled && !playing && marks.length < MAX_FACE_MASK_MARKS
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDraw) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = pointOf(e)
    setDrag({ a: p, b: p })
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ a: drag.a, b: pointOf(e) })
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const mark = markFromDrag(drag.a, pointOf(e), frames, labelOf(whoNow))
    setDrag(null)
    if (!mark) return
    onChange([...marks, mark])
    setSelected(marks.length)
  }

  const update = (i: number, next: AdminTrendFaceMaskMark) => onChange(marks.map((m, j) => (j === i ? next : m)))
  const remove = (i: number) => {
    onChange(marks.filter((_, j) => j !== i))
    setSelected(null)
  }
  const dragged = drag ? markFromDrag(drag.a, drag.b, frames, labelOf(whoNow)) : null
  const counts = markCounts(marks, people)

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <video
          ref={video}
          src={url}
          muted
          playsInline
          aria-label={label}
          className="max-h-80 w-full rounded-md bg-black object-contain"
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration)
            measure()
          }}
          onTimeUpdate={(e) => setFrame(frameAt(e.currentTarget.currentTime, e.currentTarget.duration, frames, fps))}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <div
          ref={surface}
          data-testid="face-mask-marks-surface"
          aria-label="Drag a box over a face to leave it unmasked"
          className={cn("absolute touch-none", canDraw ? "cursor-crosshair" : "pointer-events-none")}
          style={box.w > 0 ? { left: box.x, top: box.y, width: box.w, height: box.h } : { inset: 0 }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {marks.map((m, i) => {
            const on = frame >= m.fromFrame && frame <= m.toFrame
            return (
              <div
                key={i}
                data-testid="face-mask-mark-box"
                className={cn(
                  "pointer-events-none absolute border-2",
                  i === selected ? "border-sky-400 ring-2 ring-sky-400/60" : markColour(m.label, people),
                  on ? "bg-white/10" : "border-dashed opacity-40",
                )}
                style={{ left: `${m.leftPct}%`, top: `${m.topPct}%`, width: `${m.rightPct - m.leftPct}%`, height: `${m.bottomPct - m.topPct}%` }}
              />
            )
          })}
          {dragged && (
            <div
              className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/10"
              style={{ left: `${dragged.leftPct}%`, top: `${dragged.topPct}%`, width: `${dragged.rightPct - dragged.leftPct}%`, height: `${dragged.bottomPct - dragged.topPct}%` }}
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <input
          type="range"
          min={0}
          max={lastFrame}
          step={1}
          value={frame}
          aria-label="Frame"
          className="flex-1"
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="text-xs tabular-nums text-muted-foreground" data-testid="face-mask-frame">
          Frame {frame + 1} / {frames}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {playing ? "Pause to mark a face." : "Drag a box over a face to leave it unmasked."} A new box holds on the whole clip; set In and
        Out from the frame shown.
      </p>
      {people.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">New boxes are for</span>
          <select
            aria-label="Who new boxes are for"
            className="h-8 rounded border bg-background px-2"
            value={whoNow}
            disabled={disabled}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="erased">Everyone (unmasked on every run)</option>
            {people.map((p) => (
              <option key={p.key} value={`slot:${p.key}`}>
                {p.label} (unmasked when left empty)
              </option>
            ))}
          </select>
        </label>
      )}
      {counts.length > 0 && people.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="face-mask-mark-counts">
          {counts.map((c) => `${c.who}: ${c.count} box${c.count === 1 ? "" : "es"}`).join(" · ")}
        </p>
      )}

      {marks.length > 0 && (
        <ul aria-label="Faces left unmasked" className="flex flex-col gap-1">
          {marks.map((m, i) => (
            <li
              key={i}
              className={cn("flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs", i === selected && "border-sky-400")}
            >
              <button type="button" className="flex-1 text-start tabular-nums" onClick={() => setSelected(i)}>
                <span className={cn("me-1 inline-block h-2.5 w-2.5 rounded-sm border-2 align-middle", markColour(m.label, people))} />
                Box {i + 1}: frames {m.fromFrame + 1}–{m.toFrame + 1}
                {people.length > 0 || m.label !== "erased" ? ` · ${markWho(m.label, people)}` : ""}
              </button>
              {people.length > 0 && (
                <select
                  aria-label={`Who box ${i + 1} is for`}
                  className="h-8 rounded border bg-background px-1"
                  value={labelValue(m.label)}
                  disabled={disabled}
                  onChange={(e) => update(i, { ...m, label: labelOf(e.target.value) })}
                >
                  <option value="erased">Everyone</option>
                  {people.map((p) => (
                    <option key={p.key} value={`slot:${p.key}`}>
                      {p.label}
                    </option>
                  ))}
                  {m.label !== "erased" && !people.some((p) => p.key === (m.label as { slot: string }).slot) && (
                    <option value={labelValue(m.label)}>{markWho(m.label, people)} (not an optional person)</option>
                  )}
                </select>
              )}
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => update(i, withRangeEnd(m, "in", frame))}>
                In here
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => update(i, withRangeEnd(m, "out", frame))}>
                Out here
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Delete box ${i + 1}`} onClick={() => remove(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {marks.length >= MAX_FACE_MASK_MARKS && (
        <p className="text-xs text-muted-foreground">That is the most boxes a face mask takes ({MAX_FACE_MASK_MARKS}).</p>
      )}
    </div>
  )
}
