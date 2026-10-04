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
export type EmptyCanvasSurface = "none" | "empty-state" | "copilot-planning" | "copilot-center"

export function emptyCanvasSurface(input: {
  /** Null until a workflow is actually open — a bare editor shows neither. */
  workflowId: string | null | undefined
  nodeCount: number
  /** Suppresses the flash while the initial load clears the store then refills it. */
  isLoading: boolean
  copilotTurnActive: boolean
  /** The Copilot sits in the middle of the canvas (copilot-placement) — it IS the first-run surface then. */
  copilotCentered: boolean
  /**
   * The Copilot's rail is open beside the canvas — the conversation is the
   * thing on screen (a message sent from the middle is on its way, or one
   * already happened), and the first-node help would compete with it.
   */
  copilotPanelOpen: boolean
  /**
   * The Copilot is the first-run surface here: Cloud, a desktop, an editable
   * workflow, where it can sit in the middle (copilot-placement). The person
   * can always bring it back from the strip or the top-bar tab.
   */
  copilotOwnsEmptyCanvas: boolean
}): EmptyCanvasSurface {
  const { workflowId, nodeCount, isLoading, copilotTurnActive, copilotCentered, copilotPanelOpen, copilotOwnsEmptyCanvas } = input
  if (workflowId == null || nodeCount > 0 || isLoading) return "none"
  // "Add your first node" is wrong advice while nodes are being added for you,
  // but silence is worse than wrong advice.
  if (copilotTurnActive) return "copilot-planning"
  if (copilotCentered) return "copilot-center"
  if (copilotPanelOpen) return "none"
  // Folded or put away where it owns the empty canvas, the Copilot leaves the
  // canvas bare, as designed. It gets there only by the person's own choice:
  // returning to the middle switched off, or a conversation already under way.
  if (copilotOwnsEmptyCanvas) return "none"
  // Everywhere else the first-node help stays, so an empty canvas is never silent.
  return "empty-state"
}
