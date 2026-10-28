// "Take from the original": pick a moment of the trend's original clip with
// the scrubber, drag a box over who (or what) the slot is, and save. The
// server crops that frame of the SAVED original (never its display copy) with
// ffmpeg and stores the picture in the trend's storage
// (`POST /v1/admin/trends/:id/frame-crop`); the address comes back to the slot
// as a default picture. An internal tool: no credits.
//
// The box is kept in fractions of the PICTURE (the video is letterboxed,
// object-contain: `pictureRect`), moved by dragging it, resized by its corners,
// or drawn anew by dragging outside it. Saving sends it in pixels of the frame
// as shown (the display copy's size, rotation applied: how ffmpeg decodes the
// original too).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCropTrendFrame } from "@/ee/hooks/queries/use-admin-queries"
import { pictureRect } from "./FaceMaskMarks"

/** The trend's saved original, as the dialog shows it and the server crops it. */
export interface CropOriginal {
  /** A browser-safe copy to show (the display copy, else the clip itself). */
  readonly videoUrl: string
  /** The frame's size as shown, in pixels: what the box is measured in. */
  readonly width: number
  readonly height: number
  readonly durationSec: number
}

/** A box in fractions (0–1) of the picture. */
export interface CropBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** The smallest side a crop may have, in pixels of the frame (the server's own limit). */
export const FRAME_CROP_MIN_SIDE = 16
/** Where a new dialog's box starts: the middle half of the picture. */
export const INITIAL_CROP_BOX: CropBox = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
/** How close to the clip's end the scrubber may go: the frame must lie inside it. */
const END_MARGIN_SEC = 0.05

type Corner = "nw" | "ne" | "sw" | "se"
type Drag =
  | { kind: "draw"; a: { x: number; y: number } }
  | { kind: "move"; start: { x: number; y: number }; from: CropBox }
  | { kind: "resize"; corner: Corner; from: CropBox }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** The box between two points (fractions), clamped to the picture. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): CropBox {
  const x1 = clamp01(Math.min(a.x, b.x))
  const y1 = clamp01(Math.min(a.y, b.y))
  const x2 = clamp01(Math.max(a.x, b.x))
  const y2 = clamp01(Math.max(a.y, b.y))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** `box` in whole pixels of a `width × height` frame: inside it, each side at least the minimum. */
export function boxInPixels(box: CropBox, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const side = (frac: number, total: number) => Math.min(total, Math.max(FRAME_CROP_MIN_SIDE, Math.round(frac * total)))
  const w = side(box.w, width)
  const h = side(box.h, height)
  const x = Math.min(width - w, Math.max(0, Math.round(box.x * width)))
  const y = Math.min(height - h, Math.max(0, Math.round(box.y * height)))
  return { x, y, w, h }
}

interface Props {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly trendId: string
  readonly original: CropOriginal
  /** Who the picture is for, e.g. "Slot 2". */
  readonly slotName: string
  /** The stored picture's address. */
  readonly onCropped: (url: string) => void
}

export function FrameCropDialog({ open, onOpenChange, trendId, original, slotName, onCropped }: Props) {
  const crop = useCropTrendFrame(trendId)
  const video = useRef<HTMLVideoElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const [time, setTime] = useState(0)
  const [box, setBox] = useState<CropBox>(INITIAL_CROP_BOX)
  const [rect, setRect] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const lastTime = Math.max(0, original.durationSec - END_MARGIN_SEC)

  // A fresh start each time it opens.
  useEffect(() => {
    if (!open) return
    setTime(0)
    setBox(INITIAL_CROP_BOX)
    setDrag(null)
  }, [open])

  const measure = () => {
    const el = video.current
    if (!el) return
    setRect(pictureRect(el.clientWidth, el.clientHeight, el.videoWidth || original.width, el.videoHeight || original.height))
  }
  useEffect(() => {
    const el = video.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // The video is mounted while the dialog is open.
  }, [open])

  const seek = (t: number) => {
    const next = Math.min(lastTime, Math.max(0, t))
    setTime(next)
    const el = video.current
    if (el) {
      el.pause()
      el.currentTime = next
    }
  }

  /** The pointer's point in fractions of the picture. */
  const pointOf = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = surface.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1) }
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = pointOf(e)
    const handle = (e.target as HTMLElement).dataset?.handle
    if (handle === "move") setDrag({ kind: "move", start: p, from: box })
    else if (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se") setDrag({ kind: "resize", corner: handle, from: box })
    else setDrag({ kind: "draw", a: p })
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const p = pointOf(e)
    if (drag.kind === "draw") return setBox(boxBetween(drag.a, p))
    if (drag.kind === "move") {
      const { from } = drag
      return setBox({
        ...from,
        x: Math.min(1 - from.w, Math.max(0, from.x + p.x - drag.start.x)),
        y: Math.min(1 - from.h, Math.max(0, from.y + p.y - drag.start.y)),
      })
    }
    // Resize: the dragged corner follows the pointer, the opposite one stays.
    const { from, corner } = drag
    const fixed = { x: corner.includes("w") ? from.x + from.w : from.x, y: corner.startsWith("n") ? from.y + from.h : from.y }
    setBox(boxBetween(fixed, p))
  }
  const onUp = () => setDrag(null)

  const pixels = boxInPixels(box, original.width, original.height)
  const save = async () => {
    try {
      const { url } = await crop.mutateAsync({ timeSec: Math.round(time * 1000) / 1000, box: pixels })
      onCropped(url)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not crop the frame")
    }
  }

  const pct = (v: number) => `${v * 100}%`
  return (
    <Dialog open={open} onOpenChange={(o) => !crop.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{slotName}: take from the original</DialogTitle>
          <DialogDescription>
            Pick a moment with the scrubber, then drag the box over who or what this slot is (drag its corners to resize, or drag outside it to draw a new one).
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <video
            ref={video}
            src={original.videoUrl}
            muted
            playsInline
            preload="auto"
            aria-label="The trend's original"
            className="max-h-[60vh] w-full rounded-md bg-black object-contain"
            onLoadedMetadata={measure}
          />
          <div
            ref={surface}
            data-testid="frame-crop-surface"
            className="absolute cursor-crosshair touch-none"
            style={rect.w > 0 ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : { inset: 0 }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <div
              data-handle="move"
              data-testid="frame-crop-box"
              className="absolute cursor-move border-2 border-sky-400 bg-sky-400/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
            >
              {(["nw", "ne", "sw", "se"] as const).map((c) => (
                <span
                  key={c}
                  data-handle={c}
                  aria-hidden
                  className="absolute h-3.5 w-3.5 rounded-sm border border-sky-500 bg-white"
                  style={{
                    [c.startsWith("n") ? "top" : "bottom"]: -7,
                    [c.endsWith("w") ? "left" : "right"]: -7,
                    cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between">
            <span className="font-medium">Moment</span>
            <span className="tabular-nums text-muted-foreground">{time.toFixed(2)} s</span>
          </span>
          <input
            type="range"
            aria-label="Moment in the original"
            min={0}
            max={lastTime}
            step={0.01}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {pixels.w}×{pixels.h} px at {pixels.x}, {pixels.y} of the {original.width}×{original.height} frame.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={crop.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={crop.isPending} onClick={() => void save()}>
            {crop.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save picture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
