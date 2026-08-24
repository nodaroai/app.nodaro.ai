/**
 * What an empty canvas shows.
 *
 * Four flags decide this and they have already produced one wrong answer: while
 * the Copilot was mid-turn the empty state was suppressed and nothing replaced
 * it, so a user watching a workflow being built for them watched a blank grid
 * and concluded the page had hung.
 *
 * It lives outside the canvas component because the canvas cannot be rendered
 * in a test cheaply, and this decision is the part that has to be right.
 */
export type EmptyCanvasSurface = "none" | "empty-state" | "copilot-planning"

export function emptyCanvasSurface(input: {
  /** Null until a workflow is actually open — a bare editor shows neither. */
  workflowId: string | null | undefined
  nodeCount: number
  /** Suppresses the flash while the initial load clears the store then refills it. */
  isLoading: boolean
  copilotTurnActive: boolean
}): EmptyCanvasSurface {
  const { workflowId, nodeCount, isLoading, copilotTurnActive } = input
  if (workflowId == null || nodeCount > 0 || isLoading) return "none"
  // "Add your first node" is wrong advice while nodes are being added for you,
  // but silence is worse than wrong advice.
  return copilotTurnActive ? "copilot-planning" : "empty-state"
}
