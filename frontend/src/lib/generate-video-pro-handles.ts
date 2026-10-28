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
 *  - an `audio` input, a soundtrack laid over the final stitched result (decided
 *    2026-10-28: Generate Video dropped it for a Merge Video & Audio node; over a
 *    multi-segment render the one-track overlay is the node's own job);
 *  - longer-than-model durations via multi-segment stitching;
 *  - the Seedance-2-family-only provider set;
 *  - `videoReferences` carries the EXTEND SOURCE semantic (limit 1,
 *    handle-limits.ts): the run CONTINUES from the wired clip via the same
 *    anchored 2s-tail transport segments use between themselves — the
 *    long-video counterpart of a style video reference.
 */
import { GENERATE_VIDEO_INPUT_HANDLES } from "./generate-video-handles"

/** Generate Video's inputs plus `audio` (the stitched result's soundtrack), beside its Audio Refs. */
export const GENERATE_VIDEO_PRO_INPUT_HANDLES = [
  ...GENERATE_VIDEO_INPUT_HANDLES.slice(0, GENERATE_VIDEO_INPUT_HANDLES.indexOf("audioReferences")),
  "audio",
  ...GENERATE_VIDEO_INPUT_HANDLES.slice(GENERATE_VIDEO_INPUT_HANDLES.indexOf("audioReferences")),
] as const

export type GenerateVideoProInputHandle = typeof GENERATE_VIDEO_PRO_INPUT_HANDLES[number]

export { isValidGenerateVideoConnection as isValidGenerateVideoProConnection } from "./generate-video-handles"
