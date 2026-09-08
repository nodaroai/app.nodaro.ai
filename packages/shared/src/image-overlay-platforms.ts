/**
 * Image Overlay — platform canvas presets. Picking one sets the output canvas
 * to the platform's pixel size and draws its SAFE AREA in the preview (the
 * part of the image every surface actually shows — a YouTube banner is
 * cropped to a 1546×423 strip on phones, a LinkedIn personal cover has the
 * profile photo over its bottom-left, an Instagram story hides the top and
 * bottom under the UI). The same ids drive "export also for" — one
 * composition rendered into several platform sizes in one run.
 *
 * Safe areas are FRACTIONS of the canvas (x, y, w, h in 0..1). Sizes are the
 * platforms' documented recommendations as of 2026-09.
 */
export interface OverlayPlatformPreset {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
  /** The always-visible region, as fractions of the canvas. Absent = whole canvas. */
  readonly safe?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  /** Per-device viewports drawn as nested boxes (the YouTube banner shows TV /
   *  desktop / every device). `safe` is the innermost one. Ids are stable
   *  keys the UI localises; absent = only `safe` is drawn. */
  readonly zones?: readonly OverlayPlatformZone[]
  readonly note?: string
}

export interface OverlayPlatformZone {
  readonly id: "tv" | "desktop" | "all"
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const YT_BANNER_ALL = { x: (2560 - 1546) / 2 / 2560, y: (1440 - 423) / 2 / 1440, w: 1546 / 2560, h: 423 / 1440 }

export const OVERLAY_PLATFORMS: readonly OverlayPlatformPreset[] = [
  { id: "youtube-thumbnail", label: "YouTube thumbnail", width: 1280, height: 720, safe: { x: 0, y: 0, w: 1, h: 0.86 }, note: "The bottom-right corner carries the duration badge." },
  {
    id: "youtube-banner", label: "YouTube channel banner", width: 2560, height: 1440,
    safe: YT_BANNER_ALL,
    zones: [
      { id: "tv", x: 0, y: 0, w: 1, h: 1 },
      { id: "desktop", x: 0, y: (1440 - 423) / 2 / 1440, w: 1, h: 423 / 1440 },
      { id: "all", ...YT_BANNER_ALL },
    ],
    note: "TV shows the whole banner, desktop a 2560×423 strip, phones only the centre 1546×423.",
  },
  { id: "linkedin-company", label: "LinkedIn company cover", width: 1128, height: 191, safe: { x: 0.18, y: 0, w: 0.82, h: 1 }, note: "The company logo sits over the left ~200px." },
  { id: "linkedin-personal", label: "LinkedIn personal cover", width: 1584, height: 396, safe: { x: 0.24, y: 0, w: 0.76, h: 0.9 }, note: "The profile photo covers the bottom-left." },
  { id: "x-header", label: "X / Twitter header", width: 1500, height: 500, safe: { x: 0.2, y: 0.05, w: 0.78, h: 0.9 }, note: "The profile photo covers the bottom-left." },
  { id: "facebook-cover", label: "Facebook page cover", width: 820, height: 312, safe: { x: 0.05, y: 0.08, w: 0.9, h: 0.84 } },
  { id: "instagram-post", label: "Instagram post (1:1)", width: 1080, height: 1080 },
  { id: "instagram-portrait", label: "Instagram post (4:5)", width: 1080, height: 1350 },
  { id: "instagram-story", label: "Instagram / TikTok story (9:16)", width: 1080, height: 1920, safe: { x: 0, y: 250 / 1920, w: 1, h: (1920 - 500) / 1920 }, note: "The top and bottom 250px sit under the story UI." },
  { id: "open-graph", label: "Link preview (Open Graph)", width: 1200, height: 630 },
  { id: "presentation", label: "Presentation slide (16:9)", width: 1920, height: 1080 },
  { id: "a4-print", label: "Print A4 @300dpi", width: 2480, height: 3508, safe: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, note: "5% bleed margin." },
] as const

export type OverlayPlatformId = (typeof OVERLAY_PLATFORMS)[number]["id"]
export const OVERLAY_PLATFORM_IDS = OVERLAY_PLATFORMS.map((p) => p.id) as unknown as readonly [OverlayPlatformId, ...OverlayPlatformId[]]

export function overlayPlatformById(id: string | undefined | null): OverlayPlatformPreset | undefined {
  return id ? OVERLAY_PLATFORMS.find((p) => p.id === id) : undefined
}

/** How many extra platform renders one run may produce — every platform in
 *  the registry, so "all of them" is one run. The node's handle column is
 *  sized for this (image-overlay-handles.test.ts pins it). */
export const OVERLAY_MAX_VARIANTS = OVERLAY_PLATFORMS.length

/**
 * Every platform ticked under "export also for" is ALSO a source handle on
 * the node — `variant:<platformId>` — so the X header can feed an X publisher
 * while the YouTube thumbnail feeds YouTube, in one run. The main `image`
 * handle stays the primary composite.
 */
export const OVERLAY_VARIANT_HANDLE_PREFIX = "variant:"
export function overlayVariantHandle(platformId: string): string {
  return `${OVERLAY_VARIANT_HANDLE_PREFIX}${platformId}`
}
/** The platform id a variant handle names, or null for any other handle. */
export function overlayVariantIdFromHandle(handle: string | null | undefined): string | null {
  if (!handle || !handle.startsWith(OVERLAY_VARIANT_HANDLE_PREFIX)) return null
  const id = handle.slice(OVERLAY_VARIANT_HANDLE_PREFIX.length)
  return overlayPlatformById(id) ? id : null
}
