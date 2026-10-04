/**
 * Where the canvas puts the Copilot as nodes come and go.
 *
 * The Copilot starts in the middle of an empty canvas, moves to the rail the
 * moment the person starts building (a node appears, by any route) or sends a
 * message, and comes back to the middle when the last node goes and nothing
 * was said — or when the rail is folded or closed over such a canvas. Every
 * add-node path converges on the node count, so the rules read that count
 * instead of hooking each path — a new path is covered for free.
 *
 * Pure, so the decisions that have to be right are tested without a canvas.
 */
import { useEffect, useRef } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { copilotSurfaced, useCopilotUiStore, type CopilotDock, type CopilotMode } from "@/hooks/use-copilot-ui-store"

export interface CanvasSnapshot {
  readonly workflowId: string | null
  readonly isLoading: boolean
  readonly nodeCount: number
  /** Messages in this workflow's conversation (0 while unknown). */
  readonly messageCount: number
  readonly conversationKnown: boolean
  /** A message is on its way or being answered — said, though not in the history yet. */
  readonly conversing: boolean
}

export interface PlacementContext {
  readonly mode: CopilotMode
  readonly dock: CopilotDock
  /** The middle is available here: surfaced, a desktop, and an editable workflow. */
  readonly centerAllowed: boolean
  readonly returnToCenterWhenEmpty: boolean
}

/** The mode this change of the canvas moves the Copilot to, or the mode it is in. */
export function placeCopilot(prev: CanvasSnapshot | null, next: CanvasSnapshot, ctx: PlacementContext): CopilotMode {
  const { mode, dock, centerAllowed, returnToCenterWhenEmpty } = ctx
  if (!centerAllowed) return mode === "center" ? dock : mode
  // A load clears the canvas to nothing and then refills it: nothing that
  // happens during it is the person's doing.
  if (next.isLoading || next.workflowId == null) return mode

  const empty = next.nodeCount === 0
  const talked = next.messageCount > 0 || next.conversing
  const fresh = prev == null || prev.workflowId !== next.workflowId || prev.isLoading

  if (fresh) {
    // Someone opened the rail (the hop from the home page, or it was open).
    if (mode === "panel") return mode
    // An empty canvas starts in the middle. Its history may still be on the
    // way; if it turns out there is a conversation, the rule below moves the
    // Copilot to the rail to show it.
    if (empty && !talked) return "center"
    return mode === "center" ? dock : mode
  }

  // The person started building, or there is a conversation to show.
  if (mode === "center") return !empty || talked ? "panel" : "center"

  // The last node went and nothing was said: back to the start, unless the
  // person switched that off.
  if (prev.nodeCount > 0 && empty && !talked && next.conversationKnown && returnToCenterWhenEmpty) return "center"
  return mode
}

/**
 * Where folding (‹, the tab, `mod+J`) or closing (×) the rail takes the
 * Copilot. Over an empty canvas with nothing said its place is the middle, so
 * it goes back there rather than leave a bare canvas behind — unless the
 * middle is not available here or the person switched returning off.
 */
export function railExitTarget(input: {
  readonly target: "min" | "hidden"
  readonly hasContent: boolean
  readonly centerAllowed: boolean
  readonly returnToCenterWhenEmpty: boolean
}): CopilotMode {
  const { target, hasContent, centerAllowed, returnToCenterWhenEmpty } = input
  return !hasContent && centerAllowed && returnToCenterWhenEmpty ? "center" : target
}

/**
 * The top-bar Copilot tab (and `mod+J`). On a desktop it folds an open rail
 * (`railExitTarget`) and unfolds a folded or hidden one — to the middle when
 * there is nothing on the canvas and nothing said; in the middle it stays. A
 * phone has no strip and no middle: the sheet opens and closes.
 */
export function copilotTabTarget(input: {
  readonly mode: CopilotMode
  readonly isMobile: boolean
  readonly hasContent: boolean
  readonly centerAllowed: boolean
  readonly returnToCenterWhenEmpty: boolean
}): CopilotMode {
  const { mode, isMobile, hasContent, centerAllowed, returnToCenterWhenEmpty } = input
  if (isMobile) return mode === "panel" ? "hidden" : "panel"
  if (mode === "panel") return railExitTarget({ target: "min", hasContent, centerAllowed, returnToCenterWhenEmpty })
  if (mode === "center") return "center"
  return hasContent || !centerAllowed ? "panel" : "center"
}

/**
 * Moves the Copilot to `mode` through the action a person's choice uses, so
 * the docked choice is remembered (`dock`) the same way whichever control made
 * it. Leaving the rail for the middle remembers how it was left (`dockAs`).
 */
export function goToCopilotMode(mode: CopilotMode, dockAs?: CopilotDock): void {
  const ui = useCopilotUiStore.getState()
  if (mode === ui.mode) return
  if (mode === "panel") ui.openPanel()
  else if (mode === "min") ui.minimize()
  else if (mode === "hidden") ui.closePanel()
  else ui.showCenter(dockAs)
}

/** Something on the canvas, said, or on its way: the Copilot then belongs on the rail. */
export function canvasHasContent(): boolean {
  const ui = useCopilotUiStore.getState()
  return (
    useWorkflowStore.getState().nodes.length > 0 ||
    ui.messageCount > 0 ||
    ui.turnActive ||
    ui.pendingPrompt !== null
  )
}

/** The rail's ‹ and ×: fold or close it, by `railExitTarget`. */
export function leaveRail(target: "min" | "hidden", centerAllowed: boolean): void {
  const mode = railExitTarget({
    target,
    hasContent: canvasHasContent(),
    centerAllowed,
    returnToCenterWhenEmpty: useCopilotUiStore.getState().returnToCenterWhenEmpty,
  })
  goToCopilotMode(mode, target)
}

/** Whether the middle is available: surfaced, a desktop, and an editable workflow. */
export function useCopilotCenterAllowed(): boolean {
  const isMobile = useIsMobile()
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  return copilotSurfaced() && !isMobile && !isReadOnly
}

/** Applies `placeCopilot` as the canvas changes. Mounted once, by the canvas. */
export function useCopilotPlacement(nodeCount: number): void {
  const centerAllowed = useCopilotCenterAllowed()
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const isLoading = useWorkflowStore((s) => s.isWorkflowLoading)
  const messageCount = useCopilotUiStore((s) => s.messageCount)
  const conversationKnown = useCopilotUiStore((s) => s.conversationKnown)
  const conversing = useCopilotUiStore((s) => s.turnActive || s.pendingPrompt !== null)
  const prev = useRef<CanvasSnapshot | null>(null)

  useEffect(() => {
    const next: CanvasSnapshot = { workflowId, isLoading, nodeCount, messageCount, conversationKnown, conversing }
    const ui = useCopilotUiStore.getState()
    const mode = placeCopilot(prev.current, next, {
      mode: ui.mode,
      dock: ui.dock,
      centerAllowed,
      returnToCenterWhenEmpty: ui.returnToCenterWhenEmpty,
    })
    prev.current = next
    if (mode !== ui.mode) ui.setMode(mode)
  }, [workflowId, isLoading, nodeCount, messageCount, conversationKnown, conversing, centerAllowed])
}
