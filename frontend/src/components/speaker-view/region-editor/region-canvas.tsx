"use client"

/**
 * The camera frame with its boxes (U4). The selected box carries the 8 handles
 * (the media editor's `rect-handles` math, run in FRACTIONS of the frame so a
 * box is stored exactly as it is drawn); the others are outlines that select
 * on click (the overlay editor's selection model). Inside the selected box a
 * dashed rectangle shows the cover crop the chosen layout draws (SV8 a).
 *
 * Every box is a tab stop and focus selects it: that is how Tab cycles the
 * boxes (U4) without ever holding focus in the frame.
 *
 * Boxes are positioned in percent of the frame, so nothing re-measures on a
 * resize; a drag reads the frame's size once, when it starts.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { RECT_HANDLES, clampRect, dragRect, isCornerHandle, type RectDrag } from "@/components/editor/media-editor/rect-handles"
import { SPEAKER_VIEW_MIN_REGION } from "@nodaro/render-rules"
import { cn } from "@/lib/utils"
import type { Region, Size } from "./region-geometry"

export interface CanvasBox {
  readonly key: string
  readonly label: string
  readonly color: string
  readonly region: Region
}

export type FrameMedia =
  | { readonly kind: "video"; readonly src: string }
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "none" }

interface RegionCanvasProps {
  readonly media: FrameMedia
  readonly videoRef: RefObject<HTMLVideoElement | null>
  readonly imageRef: RefObject<HTMLImageElement | null>
  /** The frame's natural size, once known (also shapes the empty frame). */
  readonly size?: Size
  readonly boxes: readonly CanvasBox[]
  readonly selectedKey: string | null
  /** The cover crop of the selected box, as fractions of the frame. */
  readonly coverCrop?: Region
  readonly onSelect: (key: string) => void
  /** A drag began (its undo step is taken at its first real move). */
  readonly onDragStart: () => void
  readonly onChange: (key: string, region: Region) => void
  readonly onVideoMeta: (size: Size, durationMs: number) => void
  readonly onImageSize: (size: Size) => void
  readonly onMediaError: () => void
  /** The frame on screen may have changed: a seek, playback, the first decoded frame. */
  readonly onTime?: () => void
  readonly emptyLabel: string
}

const pct = (v: number) => `${v * 100}%`
const toRect = (r: Region) => ({ x: r.x, y: r.y, width: r.w, height: r.h })
const toRegion = (r: { x: number; y: number; width: number; height: number }): Region => ({ x: r.x, y: r.y, w: r.width, h: r.height })

export function RegionCanvas(p: RegionCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ key: string; type: RectDrag; x: number; y: number; start: Region; w: number; h: number } | null>(null)

  const begin = (e: ReactPointerEvent<HTMLElement>, key: string, region: Region, type: RectDrag) => {
    e.preventDefault()
    e.stopPropagation()
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame || frame.width <= 0 || frame.height <= 0) return
    if (key !== p.selectedKey) p.onSelect(key)
    const el = e.currentTarget
    if (typeof el.setPointerCapture === "function") el.setPointerCapture(e.pointerId)
    drag.current = { key, type, x: e.clientX, y: e.clientY, start: region, w: frame.width, h: frame.height }
    p.onDragStart()
  }

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const moved = dragRect(toRect(d.start), d.type, (e.clientX - d.x) / d.w, (e.clientY - d.y) / d.h)
    const ratio = isCornerHandle(d.type) ? d.start.w / d.start.h : null
    const next = toRegion(clampRect(moved, { width: 1, height: 1 }, { minWidth: SPEAKER_VIEW_MIN_REGION, minHeight: SPEAKER_VIEW_MIN_REGION, ratio }))
    // A press that has not moved the box is not an edit (a default box would otherwise become a set one).
    if (next.x === d.start.x && next.y === d.start.y && next.w === d.start.w && next.h === d.start.h) return
    p.onChange(d.key, next)
  }

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    if (typeof el.hasPointerCapture === "function" && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    drag.current = null
  }

  const aspect = p.size && p.size.width > 0 && p.size.height > 0 ? `${p.size.width} / ${p.size.height}` : "16 / 9"

  return (
    <div className="flex justify-center w-full min-h-0">
      <div
        ref={frameRef}
        data-testid="region-frame"
        className="relative select-none touch-none bg-black rounded-md overflow-hidden max-w-full"
        style={p.media.kind === "none" ? { aspectRatio: aspect, width: "100%", maxHeight: "60vh" } : undefined}
      >
        {p.media.kind === "video" && (
          <video
            ref={p.videoRef}
            src={p.media.src}
            preload="metadata"
            muted
            playsInline
            className="block max-w-full"
            style={{ maxHeight: "60vh" }}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              p.onVideoMeta({ width: v.videoWidth, height: v.videoHeight }, Number.isFinite(v.duration) ? v.duration * 1000 : 0)
            }}
            onLoadedData={p.onTime}
            onCanPlay={p.onTime}
            onTimeUpdate={p.onTime}
            onSeeked={p.onTime}
            onError={p.onMediaError}
          />
        )}
        {p.media.kind === "image" && (
          <img
            ref={p.imageRef}
            src={p.media.src}
            alt=""
            draggable={false}
            className="block max-w-full"
            style={{ maxHeight: "60vh" }}
            onLoad={(e) => p.onImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={p.onMediaError}
          />
        )}
        {p.media.kind === "none" && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/70">{p.emptyLabel}</div>
        )}

        {p.boxes.map((box) => {
          const selected = box.key === p.selectedKey
          return (
            <div
              key={box.key}
              role="button"
              tabIndex={0}
              aria-label={box.label}
              aria-pressed={selected}
              data-testid={`region-box-${box.label}`}
              className={cn("absolute touch-none outline-none focus-visible:ring-2 focus-visible:ring-white", selected ? "cursor-move z-10" : "cursor-pointer")}
              style={{
                left: pct(box.region.x), top: pct(box.region.y), width: pct(box.region.w), height: pct(box.region.h),
                border: `2px ${selected ? "solid" : "dashed"} ${box.color}`,
                boxShadow: selected ? "0 0 0 9999px rgba(0,0,0,0.35)" : undefined,
              }}
              onFocus={() => { if (!selected) p.onSelect(box.key) }}
              onPointerDown={(e) => begin(e, box.key, box.region, "move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              <span
                className="absolute top-0 start-0 px-1 text-[10px] font-medium text-white pointer-events-none"
                style={{ backgroundColor: box.color }}
              >
                {box.label}
              </span>
              {selected && p.coverCrop && (
                <div
                  data-testid="region-cover-crop"
                  className="absolute border border-dashed border-white/90 pointer-events-none"
                  style={{
                    left: pct((p.coverCrop.x - box.region.x) / box.region.w),
                    top: pct((p.coverCrop.y - box.region.y) / box.region.h),
                    width: pct(p.coverCrop.w / box.region.w),
                    height: pct(p.coverCrop.h / box.region.h),
                  }}
                />
              )}
              {selected &&
                RECT_HANDLES.map(({ type, style, cursor }) => (
                  <div
                    key={type}
                    data-handle={type}
                    className="absolute w-4 h-4 bg-white border-2 rounded-full z-10 touch-none"
                    style={{ ...style, cursor, borderColor: box.color }}
                    onPointerDown={(e) => begin(e, box.key, box.region, type)}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                  />
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
