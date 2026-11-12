/**
 * How far past a whole second a delivered clip's container may read without
 * counting as longer: a quarter second (8.04 s for an 8 s clip). Read by the
 * rules that turn a delivered clip's measured length into the length it is
 * charged as, or compare one with a length held for it. (Clip-priced steps
 * that measure their own input use a smaller grace of their own.)
 */
export const CONTAINER_OVERHANG_SEC = 0.25

/** Read a video node's duration (in seconds) from its data shape.
 *  Tries `generatedResults[activeResultIndex].duration` (post-execution
 *  metadata) first, then `data.duration` (configured at design time on
 *  generate-video / image-to-video / text-to-video nodes). Returns
 *  undefined when neither is set — callers should fall back to a sensible
 *  default (e.g. 8s).
 *
 *  Lives in `@nodaro/shared` so frontend (store walks) and backend
 *  (orchestrator input-resolver) can use one source of truth. */
export function extractVideoDurationFromNode(
  data: Record<string, unknown> | undefined,
): number | undefined {
  if (!data) return undefined
  const results = data.generatedResults as Array<{ duration?: number }> | undefined
  const idx = (data.activeResultIndex as number | undefined) ?? 0
  const fromResult = results?.[idx]?.duration
  if (typeof fromResult === "number" && Number.isFinite(fromResult) && fromResult > 0) {
    return fromResult
  }
  const fromConfig = data.duration
  if (typeof fromConfig === "number" && Number.isFinite(fromConfig) && fromConfig > 0) {
    return fromConfig
  }
  return undefined
}

/** Duration (seconds) of an edit-plan SOURCE node's media, for the reserve
 *  bucket. Extends {@link extractVideoDurationFromNode} with the AUDIO lane:
 *  `upload-audio` (and URL-imported audio) write their length to
 *  `metadata.durationSeconds` ONLY — never `generatedResults[].duration` /
 *  `data.duration` — so a podcast's audio master would otherwise resolve to
 *  undefined and reserve the 180-minute ceiling (a ~6× overbill). A
 *  `reference-audio` node records its extracted file's length in the same field,
 *  stamped with `metadata.mediaUrl` (see the binding check below).
 *
 *  Deliberately a NEW function, not a change to `extractVideoDurationFromNode`,
 *  so no other node's duration read shifts — this fallback is edit-plan-scoped. */
export function editPlanSourceDurationSec(
  data: Record<string, unknown> | undefined,
): number | undefined {
  const fromVideo = extractVideoDurationFromNode(data)
  if (fromVideo !== undefined) return fromVideo
  const meta = data?.metadata as { durationSeconds?: unknown; mediaUrl?: unknown } | undefined
  // A length stamped with the media it was measured from is trusted ONLY while
  // that media is still the node's. This is the read-side invariant that makes a
  // stale length impossible whoever changed the url — a copilot patch, an MCP
  // workflow-JSON write, an import, a run-time input override, or code not yet
  // written: a mismatch reads as "unknown", and every caller then falls to its
  // safe side (the transcript clock, the reserve-time probe, the ceiling bucket)
  // instead of under-bucketing a longer file. An UNSTAMPED length (upload-audio,
  // nodes saved before the stamp existed) is trusted as it always was.
  if (typeof meta?.mediaUrl === "string" && meta.mediaUrl !== data?.extractedAudioUrl && meta.mediaUrl !== data?.url) {
    return undefined
  }
  const d = meta?.durationSeconds
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined
}
