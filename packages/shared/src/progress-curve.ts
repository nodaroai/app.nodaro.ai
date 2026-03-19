/**
 * Non-linear progress calculation using quadratic ease-out curve.
 * Returns 0–99 during execution, never reaching 100 (that's set on completion).
 *
 * Formula: progress = 99 * (1 - (1 - t)^exponent)
 * where t = clamp(elapsedMs / estimatedMs, 0, 1)
 */
export function calculateProgress(
  elapsedMs: number,
  estimatedMs: number,
  exponent: number = 2,
): number {
  if (estimatedMs <= 0) return 0
  const t = Math.min(Math.max(elapsedMs / estimatedMs, 0), 1)
  return Math.round(99 * (1 - Math.pow(1 - t, exponent)))
}

/** Category-based fallback durations (ms) when no historical data exists. */
export const CATEGORY_DURATION_DEFAULTS: Record<string, number> = {
  image: 30_000,
  video: 120_000,
  "audio-tts": 15_000,
  music: 60_000,
  llm: 8_000,
  upscale: 30_000,
  inline: 500,
}

/**
 * Compute weighted progress segments for a multi-node flow.
 * Each node gets a proportional slice of 0–99% based on its estimated duration.
 *
 * Returns array of { nodeId, startPct, endPct, estimatedMs } in execution order.
 */
export interface ProgressSegment {
  nodeId: string
  startPct: number
  endPct: number
  estimatedMs: number
}

export function buildProgressSegments(
  nodeEstimates: { nodeId: string; estimatedMs: number }[],
): ProgressSegment[] {
  const totalMs = nodeEstimates.reduce((sum, n) => sum + n.estimatedMs, 0)
  if (totalMs <= 0) return []

  const segments: ProgressSegment[] = []
  let cursor = 0

  for (let i = 0; i < nodeEstimates.length; i++) {
    const { nodeId, estimatedMs } = nodeEstimates[i]
    const sliceWidth = (estimatedMs / totalMs) * 99
    const isLast = i === nodeEstimates.length - 1
    segments.push({
      nodeId,
      startPct: cursor,
      // Last segment always stretches to exactly 99
      endPct: isLast ? 99 : cursor + sliceWidth,
      estimatedMs,
    })
    cursor += sliceWidth
  }

  return segments
}

/**
 * Calculate combined progress for a multi-node flow given current node states.
 */
export function calculateCombinedProgress(
  segments: ProgressSegment[],
  nodeStatuses: Record<string, {
    status: "pending" | "running" | "completed" | "failed" | "skipped"
    startedAt?: string
  }>,
  now: number = Date.now(),
): number {
  let progress = 0

  for (const seg of segments) {
    const state = nodeStatuses[seg.nodeId]
    if (!state) continue

    const sliceWidth = seg.endPct - seg.startPct

    if (state.status === "completed" || state.status === "skipped") {
      progress += sliceWidth
    } else if (state.status === "running" && state.startedAt) {
      const elapsed = now - new Date(state.startedAt).getTime()
      const nodeProgress = calculateProgress(elapsed, seg.estimatedMs)
      // Map node's 0–99% to this segment's slice
      progress += (nodeProgress / 99) * sliceWidth
    }
    // pending/failed contribute 0
  }

  return Math.round(Math.min(progress, 99))
}
