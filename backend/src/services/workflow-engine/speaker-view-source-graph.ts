/**
 * The graph half of the Speaker View source check (decided 2026-10-12, R5) now
 * lives in `@nodaro/render-rules`, so the server's orchestrator and the editor's
 * own graph runner run the very same rule. Re-exported here so the level
 * builder and the source check keep their import path.
 */
export {
  ancestorsOf,
  speakerViewSourceOrderingEdges,
  videoFedSpeakerViews,
  type VideoFedSpeakerView,
} from "@nodaro/render-rules"
