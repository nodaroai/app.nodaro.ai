---
"@nodaro/shared": minor
---

Kling 4.0 (`kling-4`, `kling-4-keyframes`) renders 4K and takes an HDR setting, and offers the 4:3 aspect ratio. Both catalog entries list `resolutions: ["720p", "1080p", "4k"]`, the `4:3` ratio and the feature `hdr`, with a new catalog field `hdr: { resolutions, addonCreditPrefix }` (HDR at 1080p and 4K, priced as its own add-on). `normalizeKling4Resolution` now returns `"4k"` for a 4K request (it used to collapse it to 720p), so the credit identifiers price `kling-4:<N>s:4k` and `kling-4:<N>s:4k-ref`. Kling 4.0 Flash is unchanged.

New: `VIDEO_DYNAMIC_RANGES`, the `VideoDynamicRange` type, `videoTakesHdr`, `videoRunsHdr`, `videoHdrResolution`, `videoHdrResolutionProblem` (with `VIDEO_HDR_RESOLUTION_CODE` and the `VideoHdrResolutionProblem` type: HDR at a size that does not render it is refused before anything is held) and `videoHdrAddonCreditId` (the add-on's `kling-4-hdr:<N>s:<res>` id on the output seconds). `normalizeModelInput` takes and returns `dynamicRange`: dropped on a model without the setting, an unknown value read as `sdr`, and HDR at 720p (or with no size) moves the size to 1080p; `MODEL_INPUT_ADJUSTMENT_FIELDS` gains `dynamicRange`. `normalizeNodeModelParams` holds a Generate Video node's stored `dynamicRange` the same way.
