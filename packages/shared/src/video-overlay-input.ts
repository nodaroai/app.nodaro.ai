/**
 * Video Overlay — internal readers of a value as a writer sent it, shared by
 * `video-overlay.ts` and `video-overlay-validate.ts`. Not exported from any
 * entry, so they add no public names; this file imports types only, so
 * importing it creates no runtime cycle.
 */
import type { VideoOverlayFit, VideoOverlayLayerInput } from "./video-overlay.js"

export function isFit(v: unknown): v is VideoOverlayFit {
  return v === "contain" || v === "cover"
}

/**
 * A `layers[]` entry as a layer, or null when it is not a plain object. Layer
 * arrays reach this module from untrusted workflow JSON (the MCP write sites
 * type nodes as `record<string, unknown>`), so a bare string / number / array
 * entry is read as an ABSENT layer — never spread, never `in`-probed.
 */
export function asLayer(v: unknown): VideoOverlayLayerInput | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as VideoOverlayLayerInput) : null
}

export const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0
/** A stored `layout`, `""` read as absent like `null` (a cleared layout never refuses a run); anything else as stored, for the validator to judge. */
export const storedLayout = (v: string | null | undefined): string | undefined => (v == null || v === "" ? undefined : v)
