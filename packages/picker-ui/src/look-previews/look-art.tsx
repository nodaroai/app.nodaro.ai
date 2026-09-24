"use client"

import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { cn } from "../lib/cn"
import { optimizedImageUrl } from "../prompt-editor/lib/image"
import { cdnVideoUrl, isVideoPreview } from "./media-url"
import { useLookPreviewUrl } from "./registry"
import { useEffectiveLookPreviewStyle } from "./preview-style"

interface LookArtProps {
  /** The picker (node type) whose preview set to read, e.g. "style", "framing". */
  readonly pickerKey: string
  /** The catalog option id. */
  readonly id: string
  /** Sizing / aspect classes for the picture — usually the fallback's own. */
  readonly className?: string
  /**
   * Smallest width the CDN is asked for. Every larger step of the shared
   * ladder is offered too, and the browser picks by the picture's real
   * on-screen size.
   */
  readonly width?: number
  /** What to show without a registered render, or when it fails to load. */
  readonly fallback: ReactNode
}

/**
 * ONE width ladder for every call site: each render is transformed at most at
 * these four widths, so the CDN cache is shared across the picker tile, the app
 * card and the canvas node instead of fragmenting over per-site multiples (a
 * transform's first request can take seconds).
 */
const WIDTH_LADDER = [240, 480, 960, 1920] as const
const CLIP_WIDTHS = [420, 640, 960] as const

function candidateWidths(min: number): number[] {
  const fit = WIDTH_LADDER.filter((w) => w >= min)
  return fit.length > 0 ? [...fit] : [WIDTH_LADDER[WIDTH_LADDER.length - 1]]
}

// A soft ground while a render loads (or a transform is still generating), so
// the box never reads as empty.
const LOADING_GROUND = "bg-black/[.04] dark:bg-white/[.06]"

// `width: 0; min-width: 100%` (the canvas nodes' idiom): the picture fills the
// width its box has but never widens it — a large source must not grow a
// compact canvas node to its own size.
const FILL_NOT_GROW = { width: 0, minWidth: "100%" } as const

/** Measures an element's CSS width (0 until laid out). */
function useBoxWidth(ref: RefObject<HTMLElement | null>, deps: ReadonlyArray<unknown>, initial: number): number {
  const [slot, setSlot] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const measured = Math.ceil(entries[0]?.contentRect.width ?? 0)
      if (measured > 0) setSlot(measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, deps)
  return slot
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

/**
 * The ONE way a look option is pictured. The picker tile, the canvas node, the
 * published-app input card and the connected-sources list all render this with
 * the same picker key, so the picture a user picks is the picture they see
 * everywhere. Shows the registered render (resized by the CDN) or, without
 * one, the drawn fallback preview.
 *
 * Sharp at any size: the picture measures its own box and tells the browser
 * (`sizes`), which then fetches the smallest `srcset` candidate that covers the
 * box at the screen's pixel density. A clip render (camera motion) shows a
 * still frame and plays a small silent encode while the pointer is over it.
 *
 * Under an "illustration" scope (LookPreviewStyleProvider) the drawn fallback
 * shows instead — unless there is none (`fallback={null}`), then the render
 * stays: a picker with nothing to draw never goes blank.
 */
export const LookArt = memo(function LookArt({ pickerKey, id, className, width = 240, fallback }: LookArtProps) {
  const registeredUrl = useLookPreviewUrl(pickerKey, id)
  const illustrated = useEffectiveLookPreviewStyle(pickerKey) === "illustration" && fallback !== null && fallback !== undefined
  const url = illustrated ? undefined : registeredUrl
  // Keyed by URL, so moving to another option retries instead of sticking to the fallback.
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined)
  // A clip plays only while the pointer is over THIS render. Hover is reset
  // whenever the option changes (React's "adjust state when a prop changes"
  // pattern): a value change mid-hover can unmount the clip box without a
  // pointerleave, and the clip must not start looping when that option returns.
  const [hoverUrl, setHoverUrl] = useState<string | undefined>(undefined)
  const [renderedUrl, setRenderedUrl] = useState(url)
  if (url !== renderedUrl) {
    setRenderedUrl(url)
    if (hoverUrl !== undefined) setHoverUrl(undefined)
  }
  const imgRef = useRef<HTMLImageElement>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const video = url !== undefined && isVideoPreview(url)
  const slot = useBoxWidth(video ? boxRef : imgRef, [url, failedUrl, video], Math.round(width / 2))

  if (!url || url === failedUrl) return <>{fallback}</>
  const widths = candidateWidths(width)

  if (!video) {
    return (
      <img
        ref={imgRef}
        src={optimizedImageUrl(url, { width: widths[0] })}
        srcSet={widths.map((w) => `${optimizedImageUrl(url, { width: w })} ${w}w`).join(", ")}
        sizes={`${slot}px`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailedUrl(url)}
        className={cn("block rounded-lg object-cover", LOADING_GROUND, className)}
        style={FILL_NOT_GROW}
      />
    )
  }

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  const clipWidth = CLIP_WIDTHS.find((w) => w >= slot * dpr) ?? CLIP_WIDTHS[CLIP_WIDTHS.length - 1]
  return (
    <span
      ref={boxRef}
      aria-hidden="true"
      className={cn("relative block overflow-hidden rounded-lg", LOADING_GROUND, className)}
      style={FILL_NOT_GROW}
      // Mouse only: a tap fires enter + leave at once, which would start and drop
      // a clip request on every touch.
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse" && !prefersReducedMotion()) setHoverUrl(url)
      }}
      onPointerLeave={() => setHoverUrl(undefined)}
    >
      <img
        src={cdnVideoUrl(url, { mode: "frame", width: widths[0] })}
        srcSet={widths.map((w) => `${cdnVideoUrl(url, { mode: "frame", width: w })} ${w}w`).join(", ")}
        sizes={`${slot}px`}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailedUrl(url)}
        className="absolute inset-0 size-full object-cover"
      />
      {hoverUrl === url && (
        <video
          src={cdnVideoUrl(url, { mode: "video", width: clipWidth })}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  )
})
