// tools/units/capabilities.mjs
// The closed list of manifest `capabilities`. A capability is a declarative
// membership a central seam consumes ("finalize:own-writer" → the job-finalize
// NOT_GENERIC_RECOVERABLE set, "length:pass-video" → the video-output-length
// rule). Each entry
// names the seam (tools/units/seams.mjs) that reads it — or, for a capability
// both trees read, each tree's seam in a list — so an unknown capability fails
// validation, a new one needs a reviewed seam first, and a unit declaring one
// needs every seam it names live.
//
// Each entry is added in the PR that adds the composition reading it (a
// capability with no reader would validate and silently do nothing).
// Shape: { "<capability>": { seam: "<seam id>" | ["<seam id>", …], why: "<what the seam does with it>" } }
export const CAPABILITIES = {
  "ffmpeg-media": { seam: "definitions", why: "joins FFMPEG_NODE_TYPES (frontend/src/lib/ffmpeg-handles.ts): the canvas validates its inputs with the ffmpeg media rule built from handles.inputs[].accepts" },
  "panel:generate-button": { seam: "definitions", why: "joins GENERATE_BUTTON_TYPES (config-panel-node-sets.ts): the config panel shows its Generate button and results gallery" },
  "finalize:own-writer": { seam: "registry", why: "joins NOT_GENERIC_RECOVERABLE (backend/src/lib/job-finalize.ts): its worker writes its own completion, so a reconcile tick bumps it with a named reason and never runs the generic media finalize" },
  "length:pass-video": { seam: "lengths", why: "joins LENGTH_KEEPING_VIDEO_TYPES (@nodaro/render-rules kept-length.ts): its output keeps at most its video input's length — the run estimates and the listing (its passVideo row in backend/src/lib/video-output-length.ts) follow that wire" },
  "length:exact-video": { seam: "lengths", why: "joins LENGTH_KEEPING_VIDEO_TYPES and EXACT_LENGTH_VIDEO_TYPES (@nodaro/render-rules kept-length.ts): its output is exactly as long as its video input (a local FFmpeg pass that never cuts), so the run's charge follows it too" },
  "input:entity-subject": { seam: ["definitions", "registry"], why: "joins ENTITY_SUBJECT_TARGET_TYPES in both input resolvers (the editor's workflow-editor/node-input-resolver.ts through the definitions, the server's workflow-engine/input-resolver.ts through the registry descriptors): a wired Character / Face / Object / Creature / Location is the node's subject and lands in imageUrl, not referenceImageUrls; needs an input whose field is imageUrl" },
  "length:unknown": { seam: "registry", why: "joins VIDEO_OUTPUT_LENGTH_RULES with the unbounded rule and UNBOUNDED_LENGTH_REASONS (backend/src/lib/video-output-length.ts, through lib/unit-descriptors.ts): no rule bounds its video output's length before it has run, so the listing prices a length-priced step after it at the run's own stand-in. No kept-length row: the run estimates read its own length (@nodaro/render-rules kept-length.ts). Needs unit.json lengthUnknownReason (the reason row). A NEW node with it is also added by hand to the shrink-only unbounded pin in backend/src/lib/__tests__/video-output-length.test.ts (a migrating legacy node is in it already)" },
  "panel:run-button": { seam: "definitions", why: "joins RUN_BUTTON_TYPES (config-panel-node-sets.ts): the config panel shows a free Run button and results gallery" },
}
