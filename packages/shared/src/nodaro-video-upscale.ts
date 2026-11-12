/**
 * Nodaro Video Upscale — the Video Upscale node's `nodaro-video-upscale`
 * provider (decided 2026-11-11): what a caller may ask for and what the
 * platform accepts. The pricing rule lives in `@nodaro/render-rules`
 * (`nodaro-video-upscale-pricing.ts`). It is offered under the deployment's
 * own label (`ownLabel` in the catalog), and only where the deployment serves
 * it (the backend's house-model seam).
 *
 * A tier is an output BOX, not a short side: the clip is fitted into
 * 1920×1080, 2560×1440 or 3840×2160 (the box turned for a portrait clip),
 * never cropped, at its own frame rate, length and audio. It has no frame-rate
 * setting and no 720p tier — Topaz has both.
 */

export const NODARO_VIDEO_UPSCALE_PROVIDER = "nodaro-video-upscale" as const

/** The output tiers, cheapest first. */
export const NODARO_VIDEO_UPSCALE_TIERS = ["1080p", "2k", "4k"] as const
export type NodaroVideoUpscaleTier = (typeof NODARO_VIDEO_UPSCALE_TIERS)[number]

/**
 * The tier a request that names none runs at — the cheapest, as Topaz's
 * default is its 1080p (decided 2026-11-11 by the build; the catalog entry's
 * `defaultResolution` says the same, so the normalizer snaps to it).
 */
export const NODARO_VIDEO_UPSCALE_DEFAULT_TIER: NodaroVideoUpscaleTier = "1080p"

/** The landscape output box of each tier (a portrait clip gets it turned). */
export const NODARO_VIDEO_UPSCALE_BOX: Readonly<Record<NodaroVideoUpscaleTier, { readonly width: number; readonly height: number }>> = {
  "1080p": { width: 1920, height: 1080 },
  "2k": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
}

/** The longest clip accepted, in seconds. A longer one is refused before anything is held. */
export const NODARO_VIDEO_UPSCALE_MAX_SEC = 60

/** The largest clip accepted, in bytes (50 MB, decimal). A larger one is refused before anything is held. */
export const NODARO_VIDEO_UPSCALE_MAX_BYTES = 50_000_000

export function isNodaroVideoUpscaleTier(v: unknown): v is NodaroVideoUpscaleTier {
  return typeof v === "string" && (NODARO_VIDEO_UPSCALE_TIERS as readonly string[]).includes(v)
}

/** Is this Video Upscale `provider` value the Nodaro Video Upscale provider? */
export function isNodaroVideoUpscaleProvider(provider: unknown): provider is typeof NODARO_VIDEO_UPSCALE_PROVIDER {
  return provider === NODARO_VIDEO_UPSCALE_PROVIDER
}
