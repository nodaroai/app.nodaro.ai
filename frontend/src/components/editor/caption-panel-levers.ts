import { resolveCaptionLevers, type CaptionLookId, type CaptionLookLevers } from "@nodaro/shared/captions"

/**
 * Resolve a caption node's look + explicit levers into the concrete levers the
 * renderer will apply, so the config panel and the canvas preview stay faithful
 * to the burned output. Thin re-export of the shared `resolveCaptionLevers` — the
 * SAME rule the worker top-level and the per-segment resolver use (bare
 * `subtitle` with no look → plain; kinetic or a look-named subtitle → resolve the
 * preset), single-sourced in `@nodaro/shared` so the three sites can't drift.
 */
export function resolveCaptionPanelLevers(
  style: string | undefined,
  look: CaptionLookId | undefined,
  explicit: CaptionLookLevers,
  fontSize: number,
): CaptionLookLevers {
  return resolveCaptionLevers(style, look, explicit, fontSize)
}
