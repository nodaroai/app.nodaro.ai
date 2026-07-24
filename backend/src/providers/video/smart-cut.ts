/**
 * Smart cut — TYPES + matcher REGISTRY only. The boundary-matching
 * ALGORITHMS (the "best-pair" argmax and the replay-diagonal preroll
 * modes) are Nodaro Cloud IP: they live in the private plugins package
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

/** Cut-point ALGORITHM: "best-pair" (default — the single most-similar
 *  pair) or a replay-diagonal preroll mode — keep-next cuts where the next
 *  clip's re-enactment of the previous tail STARTS (the overlap plays from
 *  the next clip), keep-prev where it ENDS (the previous clip's original
 *  frames are kept). Same windows and matched:false → fixed-trims fallback
 *  in every mode. */
export type SmartCutMode = "best-pair" | "preroll-keep-prev" | "preroll-keep-next"

export interface SmartCutBoundary {
  /** Frames to drop from the END of the previous clip. Counts DROPPED
   *  frames, not an index: 0 = drop nothing (the match IS the clip's last
   *  frame, which is kept). */
  readonly trimEndFrames: number
  /** Frames to drop from the START of the next clip — the matched twin is
   *  dropped too, so this is ≥ 1 whenever matched. */
  readonly trimStartFrames: number
  /** PSNR (dB) of the best pair found. >30 ≈ visually identical,
   *  Infinity = pixel-identical, <20 ≈ unrelated frames. */
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
