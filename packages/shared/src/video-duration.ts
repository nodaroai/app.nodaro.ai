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
