/**
 * `@nodaro/sdk/media` — the `media` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { MediaResource } from "../resources/media.js"

export type { VideoMetadata, DownloadVideoProgress, MediaProcessInput, MediaProcessResult, MediaDiscardResult, SplitMediaInput, SplitMediaOutput, OverlayPlacement, AddCaptionsInput, CaptionLookInput, CaptionSegmentInput, CaptionEntry } from "../resources/media.js"

// The engine union `media.addCaptions({ transcribeProvider })` takes — re-exported so a
// consumer can name it without depending on @nodaro/shared directly.
export type { TranscribeLane } from "@nodaro/shared/models"
