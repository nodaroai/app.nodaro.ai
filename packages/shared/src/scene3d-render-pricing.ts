/**
 * What a Scene3D render COSTS as a function of FRAME SIZE.
 *
 * A render's work is per pixel per frame, and until the 2560 px cap landed
 * every admissible frame was small enough that one flat price was honest. It
 * no longer is: on the software GL path a container actually uses, one frame
 * costs ~65 ms at 1920x1080, ~97 ms at 2560x1440 and ~154 ms at 2560x2560, and
 * peak memory roughly doubles across that range. A single price for all three
 * is either an overcharge on the small frame everyone renders or a giveaway on
 * the large one almost nobody does.
 *
 * So the price is TIERED by frame size, and the tiers are the frames that were
 * measured — not invented brackets:
 *
 * | Tier     | Frame                              | Price        |
 * |----------|------------------------------------|--------------|
 * | `base`   | longest side <= 1920 px            | 1x           |
 * | `large`  | longer than 1920 px, <= 5.12 MP    | 1.5x         |
 * | `xlarge` | longer than 1920 px, over 5.12 MP  | 2.5x         |
 *
 * Two rules make that table decidable for any frame, in this order:
 *
 *  1. **The 1920 gate.** A frame whose LONGEST side is at most 1920 px is
 *     `base`, whatever its area. This is a promise, not an optimisation:
 *     every frame that was renderable before the cap moved keeps exactly the
 *     price it had, so raising the ceiling cannot make an existing workflow
 *     more expensive.
 *  2. **Nearest measured reference, by pixel area.** Above the gate a frame is
 *     priced at whichever measured frame it is closer to in PIXEL COUNT, and
 *     `SCENE3D_RENDER_XLARGE_MIN_AREA_PX` is exactly the midpoint between
 *     them. 2560x1440 (3.69 MP) and 2560x1097 are `large`; 2048x2560 (5.24 MP)
 *     and 2560x2560 (6.55 MP) are `xlarge`.
 *
 * The multipliers are the measured cost ratios rounded to halves (1.49 -> 1.5,
 * 2.37 -> 2.5), which is why they are stated as multipliers and not as three
 * unrelated numbers: an operator who reprices the base render keeps the whole
 * ladder consistent, and `scene3DRenderTierCredits` is the one place the
 * arithmetic happens.
 *
 * This module carries the SHAPE of the price (which tier, which identifier,
 * which multiplier). It carries no rates: what a tier actually costs is a
 * `model_pricing` row, so a deployment can price its own hardware.
 */
import { PRO3D_RENDER_CREDIT_ID } from "./pro-3d-render.js"
import { SCENE3D_PLAN_TYPE } from "./scene3d.js"

/** Cheapest first. A vocabulary, so a surface can render the whole ladder. */
export const SCENE3D_RENDER_TIERS = ["base", "large", "xlarge"] as const
export type Scene3DRenderTier = (typeof SCENE3D_RENDER_TIERS)[number]

/**
 * The longest side (px) that still renders at the base price.
 *
 * Deliberately NOT `SCENE3D_LIMITS.maxDimensionPx` minus something: it is the
 * old ceiling, frozen, because its job is to hold every pre-cap frame at the
 * price it already had. Raising the cap again moves `maxDimensionPx` and must
 * leave this alone.
 */
export const SCENE3D_RENDER_BASE_MAX_PX = 1920

/**
 * Pixel area at which a frame stops being priced as 2560x1440 and starts being
 * priced as 2560x2560 — the exact midpoint of those two measured frames
 * (3,686,400 and 6,553,600). Only consulted for frames past the 1920 gate.
 */
export const SCENE3D_RENDER_XLARGE_MIN_AREA_PX = 5_120_000

/** The measured cost ratios, rounded to halves. `base` is 1 by definition. */
export const SCENE3D_RENDER_TIER_MULTIPLIERS: Readonly<Record<Scene3DRenderTier, number>> = {
  base: 1,
  large: 1.5,
  xlarge: 2.5,
}

/**
 * Which tier a frame renders at.
 *
 * Total and defensive on purpose: it is read from a route guard, an
 * orchestrator payload builder and a canvas badge, all of which hold a plan
 * that has not necessarily been parsed yet. Anything that is not a pair of
 * positive finite numbers is `base` — the safe answer for a display, and
 * harmless for a charge because the route's Zod refuses such a plan anyway.
 */
export function scene3DRenderTier(width: unknown, height: unknown): Scene3DRenderTier {
  const w = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : 0
  const h = typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0
  if (w === 0 || h === 0) return "base"
  if (Math.max(w, h) <= SCENE3D_RENDER_BASE_MAX_PX) return "base"
  return w * h > SCENE3D_RENDER_XLARGE_MIN_AREA_PX ? "xlarge" : "large"
}

/**
 * A tier's price, from the base render's price.
 *
 * `Math.ceil` matches how the platform rounds every other derived credit
 * figure, so a tier can never round DOWN into charging less than the base
 * render it is a multiple of.
 */
export function scene3DRenderTierCredits(baseCredits: number, tier: Scene3DRenderTier): number {
  return Math.ceil(baseCredits * SCENE3D_RENDER_TIER_MULTIPLIERS[tier])
}

/** The flat identifier a render settles under when its frame is base-sized. */
export const RENDER_VIDEO_CREDIT_ID = "render-video"

/**
 * The identifier one render-video request settles under.
 *
 * `base` keeps the BARE `render-video` id rather than gaining a `:base`
 * suffix. That is what makes this change free of a price move: an existing
 * deployment's configured `render-video` row keeps pricing every frame it
 * priced before, and the two new rows only ever describe frames that were not
 * renderable at all until the cap moved.
 *
 * Only `3d-scene` plans are tiered. A scene-graph or template render admits
 * frames up to 3840 px today at the flat price, and re-tiering those would be
 * a price INCREASE on work people already run — a separate decision, not a
 * side effect of this one.
 */
export function renderVideoCreditId(input: unknown): string {
  if (!input || typeof input !== "object") return RENDER_VIDEO_CREDIT_ID
  const body = input as { planType?: unknown; plan?: unknown }
  if (body.planType !== SCENE3D_PLAN_TYPE) return RENDER_VIDEO_CREDIT_ID
  if (!body.plan || typeof body.plan !== "object") return RENDER_VIDEO_CREDIT_ID
  const plan = body.plan as { width?: unknown; height?: unknown }
  const tier = scene3DRenderTier(plan.width, plan.height)
  return tier === "base" ? RENDER_VIDEO_CREDIT_ID : `${RENDER_VIDEO_CREDIT_ID}:3d-${tier}`
}

/**
 * The per-frame unit a 3D Render Pro run's render stage reads.
 *
 * Pro prices its render per OUTPUT FRAME, so the frame-size tier belongs on
 * that unit rather than on a whole-run identifier — the same ladder, applied
 * where Pro actually multiplies. `base` keeps the existing
 * `pro-3d-render:render-frame:<quality>` spelling so the rows an operator has
 * already configured keep serving every frame they serve today.
 *
 * The rates themselves are deployment configuration and live nowhere in this
 * repository; this function only says which row to read.
 */
export function pro3DRenderFrameUnit(quality: string, tier: Scene3DRenderTier = "base"): string {
  const unit = `${PRO3D_RENDER_CREDIT_ID}:render-frame:${quality}`
  return tier === "base" ? unit : `${unit}:${tier}`
}
