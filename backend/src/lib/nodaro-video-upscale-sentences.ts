/**
 * What a person reads when a Nodaro Video Upscale run fails for its clip
 * (decided 2026-11-11): a fixed sentence per class, naming the model by its
 * label and its alternative, never what runs it and never prompt advice (an
 * upscale has no prompt). A leaf with no imports: the lane's row in
 * house-model-lanes.ts carries them as its `failureSentences`, which every
 * failure writer reads (`houseModelFailureError`).
 */
export const NODARO_VIDEO_UPSCALE_FAILURE_SENTENCES = Object.freeze({
  /** A content-policy block on the clip. */
  contentPolicy: "This clip could not be upscaled. Try another clip, or choose Topaz.",
  /** The run refused its input clip. */
  inputRefused: "Nodaro Video Upscale can't upscale this clip. Try another clip, or choose Topaz.",
})
