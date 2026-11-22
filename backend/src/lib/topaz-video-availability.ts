/**
 * Whether Topaz video upscale can run on THIS deployment at all, for the
 * Video Remake Precise upscale (2026-11-22): a deployment that does not run
 * Topaz answers the engine every resolution "off", so no run quotes or holds
 * a step its child would then be refused.
 *
 * Deployment-wide only, the same layers the credit guard's model door and its
 * credit check ask before any payer is read:
 *  - the catalog model `topaz-video` (what a Video Upscale `provider: "topaz"`
 *    runs, `videoUpscaleModelOf`) withheld here (`isModelDenied`: a house
 *    model this install does not serve, the admin's model switch, the
 *    availability override, the factory list);
 *  - its credit row `topaz-video:per-unit` (`TOPAZ_VIDEO_UNIT_CREDIT_ID`,
 *    what the child is held under) switched off by an admin
 *    (`model_pricing.is_enabled`, read through the same in-process switch
 *    cache, `isModelDenied` → `isModelSwitchedOff`).
 * Per-account restrictions (a pricing row's `tier_restriction`, the free-tier
 * blocklist, a payer's balance) are out of scope: they differ per run, and a
 * run the child's credit guard then refuses delivers its take without the
 * upscale, as any refused step does.
 *
 * Sync and cached (the switch cache's 60 s TTL), as the door is.
 */
import { TOPAZ_VIDEO_UNIT_CREDIT_ID } from "@nodaro/render-rules"
import { videoUpscaleModelOf } from "@nodaro/shared/model-catalog"
import { isModelDenied } from "./surface-deny.js"

/** Whether this deployment withholds Topaz video upscale from every run. */
export function topazVideoDisabledHere(): boolean {
  return isModelDenied(videoUpscaleModelOf("topaz")) || isModelDenied(TOPAZ_VIDEO_UNIT_CREDIT_ID)
}
