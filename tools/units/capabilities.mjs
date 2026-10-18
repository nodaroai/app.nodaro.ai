// tools/units/capabilities.mjs
// The closed list of manifest `capabilities`. A capability is a declarative
// membership a central seam consumes ("finalize:own-writer" → the job-finalize
// NOT_GENERIC_RECOVERABLE set, "length:pass-video" → the video-output-length
// rule). Each entry
// names the ONE seam (tools/units/seams.mjs) that reads it, so an unknown
// capability fails validation and a new one needs a reviewed seam first.
//
// Each entry is added in the PR that adds the composition reading it (a
// capability with no reader would validate and silently do nothing).
// Shape: { "<capability>": { seam: "<seam id>", why: "<what the seam does with it>" } }
export const CAPABILITIES = {
  "ffmpeg-media": { seam: "definitions", why: "joins FFMPEG_NODE_TYPES (frontend/src/lib/ffmpeg-handles.ts): the canvas validates its inputs with the ffmpeg media rule built from handles.inputs[].accepts" },
  "panel:generate-button": { seam: "definitions", why: "joins GENERATE_BUTTON_TYPES (config-panel-node-sets.ts): the config panel shows its Generate button and results gallery" },
  "finalize:own-writer": { seam: "registry", why: "joins NOT_GENERIC_RECOVERABLE (backend/src/lib/job-finalize.ts): its worker writes its own completion, so a reconcile tick bumps it with a named reason and never runs the generic media finalize" },
  "length:pass-video": { seam: "lengths", why: "joins LENGTH_KEEPING_VIDEO_TYPES (@nodaro/render-rules kept-length.ts): its output keeps at most its video input's length — the run estimates and the listing (its passVideo row in backend/src/lib/video-output-length.ts) follow that wire" },
  "length:exact-video": { seam: "lengths", why: "joins LENGTH_KEEPING_VIDEO_TYPES and EXACT_LENGTH_VIDEO_TYPES (@nodaro/render-rules kept-length.ts): its output is exactly as long as its video input (a local FFmpeg pass that never cuts), so the run's charge follows it too" },
  "panel:run-button": { seam: "definitions", why: "joins RUN_BUTTON_TYPES (config-panel-node-sets.ts): the config panel shows a free Run button and results gallery" },
}
