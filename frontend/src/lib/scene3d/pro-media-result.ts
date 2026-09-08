import type { GeneratedResult } from "@/types/nodes"

/** Append to completion-time history; a replay selects the existing result. */
export function proMediaCompletionPatch(
  output: Record<string, unknown>,
  context: { jobId: string; liveNode: Record<string, unknown> },
  timestamp = new Date().toISOString(),
): Record<string, unknown> {
  const url = typeof output.videoUrl === "string" ? output.videoUrl : undefined
  if (!url) return {}
  const previous = (context.liveNode.generatedResults as readonly GeneratedResult[] | undefined) ?? []
  const existingIndex = previous.findIndex((result) => result.jobId === context.jobId)
  if (existingIndex >= 0) {
    return {
      generatedVideoUrl: previous[existingIndex].url,
      generatedResults: previous,
      activeResultIndex: existingIndex,
    }
  }
  const result: GeneratedResult = { url, jobId: context.jobId, timestamp }
  return {
    generatedVideoUrl: url,
    generatedResults: [...previous, result],
    activeResultIndex: previous.length,
  }
}
