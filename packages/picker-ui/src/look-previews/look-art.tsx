"use client"

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react"
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
/**
 * Below this on-screen width a clip render shows its still only: the icon
 * slots of a published app's input card (16px dropdown items, the 20px
 * trigger) would otherwise each stream and decode a 420px encode for a
 * picture too small to read motion in. Grid tiles, the canvas node, the
 * connected-sources list and the 56px app button are all wider.
 */
const MIN_CLIP_SLOT = 48

function clipWidthFor(slot: number): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  return CLIP_WIDTHS.find((w) => w >= slot * dpr) ?? CLIP_WIDTHS[CLIP_WIDTHS.length - 1]
}

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

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function subscribeReducedMotion(listener: () => void): () => void {
  const mql = typeof window !== "undefined" ? window.matchMedia?.(REDUCED_MOTION) : undefined
  if (!mql?.addEventListener) return () => {}
  mql.addEventListener("change", listener)
  return () => mql.removeEventListener("change", listener)
}

function readReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION)?.matches === true
}

/** The OS "reduce motion" setting, live: a clip stops looping the moment it is turned on. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)
}

/**
 * Whether the element is on screen. A clip is mounted only while this is
 * true — the same rule as the marketplace's PreviewVideo — so a grid of 64
 * camera motions decodes the dozen tiles in view, not all 64, and a tile
 * scrolled away stops streaming. Every LookArt surface sits inside its own
 * scroller (config panel, fullscreen picker, React Flow's clipped canvas), so
 * the 200px lead is asked for through `scrollMargin` (nested scrollers) as
 * well as `rootMargin` (the viewport); browsers without the former simply
 * start at the edge. Without an IntersectionObserver (jsdom) everything
 * counts as on screen.
 */
function useNearViewport(ref: RefObject<HTMLElement | null>, deps: ReadonlyArray<unknown>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined")
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      // The LAST entry is the current state: one callback can carry both a
      // leave and an enter from a fast scroll.
      (entries) => setNear(entries[entries.length - 1]?.isIntersecting ?? false),
      { rootMargin: "200px", scrollMargin: "200px" } as IntersectionObserverInit,
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, deps)
  return near
}

/**
 * The looping clip. Playback is started from an effect rather than the
 * `autoPlay` attribute so a refusal (iOS Low Power Mode refuses even muted
 * autoplay, and draws a start button over the element) is caught and reported
 * — the caller then shows the still alone. On unmount the media resource is
 * released explicitly (pause, drop src, load), as PreviewVideo does; a
 * removed <video> otherwise keeps its decoder and any in-flight download
 * until garbage collection.
 */
function LoopingClip({ src, onFail }: { readonly src: string; readonly onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  // Mount-only: the caller keys this element by `src`, so a new clip is a new
  // element and the release below always runs on the OLD one (an effect that
  // re-ran on a src change would strip the attribute React just set).
  useEffect(() => {
    const v = ref.current
    if (!v) return
    let cancelled = false
    // StrictMode (dev) runs setup → cleanup → setup on the same element, and
    // the cleanup below drops the src; put it back if it is gone (React will
    // not, since the prop never changed). Conditional, so production never
    // restarts a load it already began.
    if (!v.hasAttribute("src")) v.src = src
    v.muted = true
    v.play()?.catch?.(() => {
      if (!cancelled) onFailRef.current()
    })
    return () => {
      cancelled = true
      v.pause()
      v.removeAttribute("src")
      v.load()
    }
  }, [])
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="auto"
      onError={onFail}
      className="absolute inset-0 size-full object-cover"
    />
  )
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
 * box at the screen's pixel density. A clip render (camera motion) loops a
 * small silent encode over its still frame for as long as the tile is on
 * screen — in the picker grid and on the canvas alike; the still stays
 * underneath so the box is never blank while the clip loads, and remains if
 * the clip fails or the OS asks for reduced motion.
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
  // A clip whose encode failed keeps its still (keyed the same way).
  const [failedClipUrl, setFailedClipUrl] = useState<string | undefined>(undefined)
  const imgRef = useRef<HTMLImageElement>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const video = url !== undefined && isVideoPreview(url)
  const slot = useBoxWidth(video ? boxRef : imgRef, [url, failedUrl, video], Math.round(width / 2))
  const nearViewport = useNearViewport(boxRef, [url, failedUrl, video])
  const reducedMotion = usePrefersReducedMotion()
  // A failed clip is retried when its tile comes back on screen (a transform's
  // first request can time out): the failure is forgotten on leaving.
  const [wasNear, setWasNear] = useState(nearViewport)
  if (wasNear !== nearViewport) {
    setWasNear(nearViewport)
    if (!nearViewport && failedClipUrl !== undefined) setFailedClipUrl(undefined)
  }
  const clipSrc = video ? cdnVideoUrl(url, { mode: "video", width: clipWidthFor(slot) }) : undefined
  const failClip = useCallback(() => setFailedClipUrl(url), [url])

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

  return (
    <span
      ref={boxRef}
      aria-hidden="true"
      className={cn("relative block overflow-hidden rounded-lg", LOADING_GROUND, className)}
      style={FILL_NOT_GROW}
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
      {nearViewport && slot >= MIN_CLIP_SLOT && url !== failedClipUrl && !reducedMotion && clipSrc !== undefined && (
        <LoopingClip key={clipSrc} src={clipSrc} onFail={failClip} />
      )}
    </span>
  )
})
