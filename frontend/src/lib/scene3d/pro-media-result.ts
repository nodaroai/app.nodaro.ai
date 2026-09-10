import { pro3DRenderShotStills, type Pro3DRenderShotStill } from "@nodaro/shared"
import type { GeneratedResult } from "@/types/nodes"

/**
 * The ACTIVE result's shot stills, in shot order.
 *
 * Read from the result and not from the node, because the stills belong to the
 * composition THAT result was rendered from: switching results switches the
 * shots. Returns `[]` for a result that carries none, which is the honest
 * answer for a run that predates them.
 */
export function proShotStills(data: Record<string, unknown>): Pro3DRenderShotStill[] {
  const results = (data.generatedResults as readonly GeneratedResult[] | undefined) ?? []
  const active = results[(data.activeResultIndex as number | undefined) ?? 0]
  return active ? pro3DRenderShotStills(active) : []
}

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
  // The stills settle WITH the video, on the same result: a later reader can
  // then line each still up against the exact MP4 it was rendered beside.
  const stills = pro3DRenderShotStills(output)
  const result: GeneratedResult = {
    url,
    jobId: context.jobId,
    timestamp,
    ...(stills.length > 0 ? { shotStills: stills } : {}),
  }
  return {
    generatedVideoUrl: url,
    generatedResults: [...previous, result],
    activeResultIndex: previous.length,
  }
}
