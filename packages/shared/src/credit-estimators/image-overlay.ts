import { overlayPlatformById } from "../image-overlay-platforms.js"

/**
 * Image Overlay pricing — one formula shared by the backend route
 * (creditGuard computeCredits), the orchestrator's reservation override, the
 * workflow estimator and the canvas Run button, so every surface quotes and
 * charges the same number.
 *
 *   credits = BASE + PER_VARIANT × (number of distinct, valid platform ids)
 *
 * The base covers the composite and its mask; every extra platform render is
 * one more resize + encode + upload. Worked examples (pinned by the tests and
 * repeated in docs/nodes/processing-video/image-overlay.md — keep them equal):
 *   0 variants → 10,  2 → 14,  12 (every platform) → 34.
 */
export const IMAGE_OVERLAY_BASE_CREDITS = 10
export const IMAGE_OVERLAY_VARIANT_CREDITS = 2

/** Distinct platform ids the registry knows — the count the price is built from. */
export function imageOverlayBillableVariants(variants: ReadonlyArray<unknown> | undefined): string[] {
  const seen = new Set<string>()
  for (const v of variants ?? []) {
    if (typeof v === "string" && overlayPlatformById(v)) seen.add(v)
  }
  return [...seen]
}

export function imageOverlayCredits(variants: ReadonlyArray<unknown> | undefined): number {
  return IMAGE_OVERLAY_BASE_CREDITS + IMAGE_OVERLAY_VARIANT_CREDITS * imageOverlayBillableVariants(variants).length
}
