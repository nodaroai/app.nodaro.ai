/**
 * Nodaro Video Upscale — the Video Upscale node's `nodaro-video-upscale`
 * provider (decided 2026-11-11): what a caller may ask for and what the
 * platform accepts. The pricing rule lives in `@nodaro/render-rules`
 * (`nodaro-video-upscale-pricing.ts`). It is offered under the deployment's
 * own label (`ownLabel` in the catalog), and only where the deployment serves
 * it (the backend's house-model seam).
 *
 * A tier is an output BOX, not a short side: the clip is fitted into
 * 1280×720 (Transparent mode only), 1920×1080, 2560×1440 or 3840×2160 (the box
 * turned for a portrait clip), never cropped, at its own frame rate, length and
 * audio. It has no frame-rate setting. The tiers each mode takes are
 * {@link nodaroVideoUpscaleTiersFor}: Sharp 1080p / 2K / 4K
 * ({@link NODARO_VIDEO_UPSCALE_TIERS}), Transparent those and 720p
 * ({@link NODARO_VIDEO_UPSCALE_TRANSPARENT_TIERS}).
 */

export const NODARO_VIDEO_UPSCALE_PROVIDER = "nodaro-video-upscale" as const

/** Sharp mode's output tiers, cheapest first (Transparent also takes 720p: {@link NODARO_VIDEO_UPSCALE_TRANSPARENT_TIERS}). */
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

/**
 * Nodaro Video Upscale's two modes (decided 2026-11-24):
 * - `"transparent"` keeps the clip's original colours and look; the safer
 *   choice for people and faces. Priced per second of the clip by its tier
 *   (720p, 1080p, or one rate for 2K and 4K), billed at the clip's exact length.
 * - `"sharp"` adds crisp detail; suits objects, products, scenery and text more
 *   than people. Priced per whole second by tier (1080p, 2K, 4K), as it always was.
 * A request or a node that names no mode runs TRANSPARENT, unless Transparent
 * cannot serve its clip, or cannot run on this deployment — then Sharp, at
 * Sharp's price ({@link nodaroVideoUpscaleEffectiveMode}). An explicit mode is
 * run as asked, or refused.
 */
export const NODARO_VIDEO_UPSCALE_MODES = ["transparent", "sharp"] as const
export type NodaroVideoUpscaleMode = (typeof NODARO_VIDEO_UPSCALE_MODES)[number]

/** The mode a request or a node that names none is read as before its clip is known (the run may still fall back to Sharp: {@link nodaroVideoUpscaleEffectiveMode}). */
export const NODARO_VIDEO_UPSCALE_DEFAULT_MODE: NodaroVideoUpscaleMode = "transparent"

export function isNodaroVideoUpscaleMode(v: unknown): v is NodaroVideoUpscaleMode {
  return typeof v === "string" && (NODARO_VIDEO_UPSCALE_MODES as readonly string[]).includes(v)
}

/**
 * The mode a Nodaro Video Upscale request or node is READ as before its clip
 * is weighed: one of the modes as sent; anything else — unset, empty, an
 * unknown value written straight into a workflow — the default, transparent.
 * (The route refuses an unknown value with a 400 before it gets here.) The
 * mode a run is priced and run in is {@link nodaroVideoUpscaleEffectiveMode},
 * which keeps an unset mode's fallback to Sharp: a client sends a mode only
 * when one is set explicitly, never this reading of an unset one.
 */
export function nodaroVideoUpscaleModeOf(mode: unknown): NodaroVideoUpscaleMode {
  return isNodaroVideoUpscaleMode(mode) ? mode : NODARO_VIDEO_UPSCALE_DEFAULT_MODE
}

/**
 * The tiers transparent mode takes: sharp's three, and 720p (decided
 * 2026-11-24). Sharp takes {@link NODARO_VIDEO_UPSCALE_TIERS} only; a 720p sent
 * with sharp runs at sharp's default tier, as before.
 */
export const NODARO_VIDEO_UPSCALE_TRANSPARENT_TIERS = ["720p", "1080p", "2k", "4k"] as const
/** A tier some mode takes. */
export type NodaroVideoUpscaleModeTier = (typeof NODARO_VIDEO_UPSCALE_TRANSPARENT_TIERS)[number]

/** The tiers `mode` takes, cheapest first. */
export function nodaroVideoUpscaleTiersFor(mode: NodaroVideoUpscaleMode): readonly NodaroVideoUpscaleModeTier[] {
  return mode === "sharp" ? NODARO_VIDEO_UPSCALE_TIERS : NODARO_VIDEO_UPSCALE_TRANSPARENT_TIERS
}

/** Does `mode` take `tier`? */
export function nodaroVideoUpscaleModeTakes(mode: NodaroVideoUpscaleMode, tier: unknown): tier is NodaroVideoUpscaleModeTier {
  return typeof tier === "string" && (nodaroVideoUpscaleTiersFor(mode) as readonly string[]).includes(tier)
}

/**
 * The landscape box of every tier some mode takes: Sharp's boxes
 * ({@link NODARO_VIDEO_UPSCALE_BOX}) and Transparent's 720p, 1280×720. Both
 * modes deliver a clip INSIDE its tier's box, turned for a portrait clip
 * ({@link nodaroVideoUpscaleBoxFor}), so one tier means one frame in either
 * mode.
 */
export const NODARO_VIDEO_UPSCALE_MODE_BOX: Readonly<Record<NodaroVideoUpscaleModeTier, { readonly width: number; readonly height: number }>> = {
  "720p": { width: 1280, height: 720 },
  ...NODARO_VIDEO_UPSCALE_BOX,
}

/** The box a clip of this size is fitted inside at `tier`: the tier's landscape box, turned for a portrait clip (taller than wide). */
export function nodaroVideoUpscaleBoxFor(
  source: { readonly width: number; readonly height: number },
  tier: NodaroVideoUpscaleModeTier,
): { width: number; height: number } {
  const box = NODARO_VIDEO_UPSCALE_MODE_BOX[tier]
  return source.height > source.width ? { width: box.height, height: box.width } : { width: box.width, height: box.height }
}

/** The most transparent mode scales a clip by. A clip that needs more for its tier is refused. */
export const NODARO_VIDEO_UPSCALE_TRANSPARENT_MAX_FACTOR = 4

/**
 * The mode a QUEUED or STORED job runs in — the worker's and the recovery's
 * reading. Every enqueue since modes exist writes the resolved mode, so a job
 * that names none was queued before (the pre-change shape) and is Sharp. The
 * default-to-Transparent of {@link nodaroVideoUpscaleModeOf} belongs only where
 * a request or a node is priced and stamped.
 */
export function nodaroVideoUpscaleQueuedModeOf(mode: unknown): NodaroVideoUpscaleMode {
  return mode === undefined || mode === null ? "sharp" : nodaroVideoUpscaleModeOf(mode)
}

/**
 * THE mode a Nodaro Video Upscale is priced and run in, once what is known of
 * the clip is weighed (decided 2026-11-24). Every lane — the route and its
 * quote, the workflow run's stamp, the workflow estimate, the editor — decides
 * with this one function and writes what it returns on the job, so the mode
 * that is priced is the mode that runs:
 * - `"sharp"` or `"transparent"` sent explicitly: that mode (an explicit
 *   Transparent keeps its refusals).
 * - no mode (unset, empty, unknown): Transparent, unless Transparent cannot
 *   serve this clip at this tier (`transparentServes === false`: the clip
 *   already fills the tier's frame, would need more than 4×, is past the
 *   output bound, or this install cannot run Transparent) — then Sharp, at
 *   Sharp's price, so nothing that worked before stops working. Not known yet
 *   (`undefined`: no clip measured) is Transparent; the run's own plan decides
 *   once the clip is measured, before anything is held.
 */
export function nodaroVideoUpscaleEffectiveMode(asked: unknown, transparentServes: boolean | undefined): NodaroVideoUpscaleMode {
  if (asked === "sharp" || asked === "transparent") return asked
  return transparentServes === false ? "sharp" : NODARO_VIDEO_UPSCALE_DEFAULT_MODE
}
