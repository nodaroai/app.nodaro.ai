/**
 * Smart cut — TYPES + matcher REGISTRY only. The boundary-matching
 * ALGORITHMS are Nodaro Cloud IP: they live in the private plugins package
 * (`engines.smartCut`) and register here at worker boot
 * (`workers/video-worker.ts`, right where `engines.surround` is consumed).
 *
 * Community/business builds have NO matcher: the combine-videos route
 * rejects `smartCutEnabled` up front (`cloud_only_feature`), and
 * `combineVideos` degrades any stray request to the fixed-trims fallback
 * (each boundary reported as `matched: false`, `psnrDb: null`) — the same
 * per-boundary fallback contract an errored search has always had. Fixed
 * frame trims (`trimStartFrames`/`trimEndFrames`) are core and stay
 * available in every edition.
 */

/** Cut-point algorithm to use. `best-pair` is the default; the preroll
 *  variants differ in which side of an overlap survives — keep-next favors
 *  the incoming clip, keep-prev the outgoing one. Same windows, and the
 *  same matched:false → fixed-trims fallback, in every mode. */
export type SmartCutMode = "best-pair" | "preroll-keep-prev" | "preroll-keep-next"

export interface SmartCutBoundary {
  /** Frames to drop from the END of the previous clip. Counts DROPPED
   *  frames, not an index: 0 = drop nothing (the match IS the clip's last
   *  frame, which is kept). */
  readonly trimEndFrames: number
  /** Frames to drop from the START of the next clip — the matched twin is
   *  dropped too, so this is ≥ 1 whenever matched. */
  readonly trimStartFrames: number
  /** Similarity score for the chosen cut, in dB. Higher is a closer
   *  match; Infinity means the frames are identical. */
  readonly psnr: number
  /** True → apply the trims. False = no genuine match; the trims here are
   *  informational and the caller should use its fixed/default trims. */
  readonly matched: boolean
  /** Window sizes actually searched (requested values clamped to the
   *  clips' frame counts). */
  readonly searchedPrevFrames: number
  readonly searchedNextFrames: number
}

/** The private engine's boundary matcher — `(prevPath, nextPath,
 *  framesFromPrev, framesFromNext, mode)` over LOCAL files. */
export type SmartCutMatcher = (
  prevPath: string,
  nextPath: string,
  framesFromPrev: number,
  framesFromNext: number,
  mode: SmartCutMode,
) => Promise<SmartCutBoundary>

let matcher: SmartCutMatcher | null = null

/** Called once at worker boot when the cloud plugin's `engines.smartCut`
 *  is present. Last registration wins (mirrors the loader's engine merge). */
export function registerSmartCutMatcher(m: SmartCutMatcher): void {
  matcher = m
}

/** `null` = no engine loaded (community/business, or plugin-version lag) —
 *  callers degrade to their fixed-trims fallback. */
export function getSmartCutMatcher(): SmartCutMatcher | null {
  return matcher
}
