/**
 * Canonical handle IDs for the Generate Video Pro node.
 *
 * FULL PARITY BY CONSTRUCTION (2026-07-14 directive): the pro node exposes
 * EXACTLY generate-video's input handles — same ids, same names, same
 * accepts semantics — so both are literal delegates of
 * generate-video-handles.ts. A handle added to generate-video automatically
 * appears here (and the parity guard test in
 * __tests__/generate-video-pro-parity.test.ts fails if these ever diverge).
 *
 * The pro node's ONLY deltas vs generate-video are the ones its purpose
 * requires (guarded/documented in that same test):
 *  - longer-than-model durations via multi-segment stitching;
 *  - the Seedance-2-family-only provider set;
 *  - `videoReferences` carries the EXTEND SOURCE semantic (limit 1,
 *    handle-limits.ts): the run CONTINUES from the wired clip via the same
 *    anchored 2s-tail transport segments use between themselves — the
 *    long-video counterpart of a style video reference.
 */
export {
  GENERATE_VIDEO_INPUT_HANDLES as GENERATE_VIDEO_PRO_INPUT_HANDLES,
  isValidGenerateVideoConnection as isValidGenerateVideoProConnection,
} from "./generate-video-handles"
export type { GenerateVideoInputHandle as GenerateVideoProInputHandle } from "./generate-video-handles"
