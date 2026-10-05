import { useEffect, useCallback } from "react"
import { useWorkflowStore } from "./use-workflow-store"
import { useUndoRedoStore, type WorkflowSnapshot } from "./use-undo-redo-store"
import { isSkipUndoCapture } from "./undo-flags"
import { withoutRunsInFlight } from "@/lib/run-in-flight-mark"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Module-level state shared across hook instances
let _isRestoring = false
let _pendingSnapshot: WorkflowSnapshot | null = null
let _debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Strip React Flow internal/transient fields from nodes so they don't
 * pollute undo snapshots (e.g. `selected`, `dragging`, `measured`).
 *
 * And a paid run's mark (`__runsInFlight`): it is a run this tab has out now,
 * never a state to go back to. A restore takes each node's live marks instead
 * (`restoreSnapshot`, `withLiveRunsInFlight`).
 */
function cleanNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map(({ selected, dragging, measured, ...rest }) => withoutRunsInFlight(rest as WorkflowNode))
}

function cleanEdges(edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.map(({ selected, ...rest }) => rest as WorkflowEdge)
}

function hasCleanEdgeChange(prevEdges: WorkflowEdge[], currEdges: WorkflowEdge[]): boolean {
  if (prevEdges === currEdges) return false
  if (prevEdges.length !== currEdges.length) return true

  const cleanedPrev = cleanEdges(prevEdges) as Array<Record<string, unknown>>
  const cleanedCurr = cleanEdges(currEdges) as Array<Record<string, unknown>>

  for (let i = 0; i < cleanedPrev.length; i++) {
    const prev = cleanedPrev[i]
    const curr = cleanedCurr[i]
    const prevKeys = Object.keys(prev)
    const currKeys = Object.keys(curr)

    if (prevKeys.length !== currKeys.length) return true

    for (const key of prevKeys) {
      if (!(key in curr)) return true
      if (prev[key] !== curr[key]) return true
    }
  }

  return false
}

/**
 * Check if snapshot-relevant content actually changed between two states.
 * Ignores React Flow transient fields (selected, dragging, measured) by
 * comparing stable references: id, type, position, and data.
 *
 * This prevents dimension re-measurements, selection changes, etc. from
 * triggering spurious undo snapshots that would clear the redo stack.
 */
function hasSnapshotChange(
  prevNodes: WorkflowNode[],
  currNodes: WorkflowNode[],
  prevEdges: WorkflowEdge[],
  currEdges: WorkflowEdge[],
  prevName: string,
  currName: string,
  prevChars: unknown,
  currChars: unknown,
  prevTemplates: unknown,
  currTemplates: unknown,
): boolean {
  if (prevName !== currName) return true
  if (prevChars !== currChars) return true
  if (prevTemplates !== currTemplates) return true
  if (hasCleanEdgeChange(prevEdges, currEdges)) return true
  if (prevNodes === currNodes) return false
  if (prevNodes.length !== currNodes.length) return true
  for (let i = 0; i < prevNodes.length; i++) {
    const p = prevNodes[i]
    const c = currNodes[i]
    if (p.id !== c.id) return true
    if (p.type !== c.type) return true
    if (p.position !== c.position) return true
    if (p.data !== c.data) return true
  }
  return false
}

function captureSnapshot(): WorkflowSnapshot {
  const s = useWorkflowStore.getState()
  return {
    nodes: cleanNodes(s.nodes),
    edges: cleanEdges(s.edges),
    characterDefinitions: s.characterDefinitions,
    flowPromptTemplates: s.flowPromptTemplates,
    workflowName: s.workflowName,
  }
}

/**
 * Close the undo step that is still collecting changes.
 *
 * Changes inside a 300 ms burst share ONE snapshot — right for typing, wrong
 * for an action that must be undoable ON ITS OWN: without this, "Clear
 * results" clicked a moment after a prompt edit would join that edit's step,
 * and one Undo would take back both.
 */
export function flushPendingUndoSnapshot(): void {
  flushPending()
}

/**
 * The "before" snapshot of the step that is collecting changes right now, or
 * null. It is the very object that lands in the history when the step closes,
 * so a caller can hold it and later ask "is my edit still in the history?" —
 * by identity, which survives the 50-step cap where an index would not.
 */
export function pendingUndoSnapshot(): WorkflowSnapshot | null {
  return _pendingSnapshot
}

function flushPending(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer)
    _debounceTimer = null
  }
  if (_pendingSnapshot) {
    useUndoRedoStore.getState().pushSnapshot(_pendingSnapshot)
    _pendingSnapshot = null
  }
}

/**
 * Call once in workflow-editor-main.tsx.
 * Subscribes to workflow store changes and captures snapshots for undo history.
 */
export function useUndoRedoSubscription(): void {
  useEffect(() => {
    let prevGeneration = useWorkflowStore.getState().loadGeneration

    const unsub = useWorkflowStore.subscribe((state, prevState) => {
      // Skip if we're restoring a snapshot or if the change is execution-only
      if (_isRestoring) return
      if (isSkipUndoCapture()) return

      // On workflow load/clear (generation changes), clear history
      if (state.loadGeneration !== prevGeneration) {
        flushPending()
        useUndoRedoStore.getState().clear()
        prevGeneration = state.loadGeneration
        return
      }

      // Skip if no snapshot-relevant content actually changed.
      // This catches: dimension re-measurements, selection changes,
      // isDirty/saveStatus toggles, and other transient updates.
      if (!hasSnapshotChange(
        prevState.nodes, state.nodes,
        prevState.edges, state.edges,
        prevState.workflowName, state.workflowName,
        prevState.characterDefinitions, state.characterDefinitions,
        prevState.flowPromptTemplates, state.flowPromptTemplates,
      )) return

      // Capture the "before" state on first change in a burst
      if (!_pendingSnapshot) {
        _pendingSnapshot = {
          nodes: cleanNodes(prevState.nodes),
          edges: cleanEdges(prevState.edges),
          characterDefinitions: prevState.characterDefinitions,
          flowPromptTemplates: prevState.flowPromptTemplates,
          workflowName: prevState.workflowName,
        }
      }

      // Reset debounce timer
      if (_debounceTimer) clearTimeout(_debounceTimer)
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null
        if (_pendingSnapshot) {
          useUndoRedoStore.getState().pushSnapshot(_pendingSnapshot)
          _pendingSnapshot = null
        }
      }, 300)
    })

    return () => {
      unsub()
      if (_debounceTimer) {
        clearTimeout(_debounceTimer)
        _debounceTimer = null
      }
      _pendingSnapshot = null
    }
  }, [])
}

/**
 * Returns undo/redo actions and state. Call in canvas/toolbar components.
 */
export function useUndoRedoActions() {
  const canUndo = useUndoRedoStore((s) => s.past.length > 0)
  const canRedo = useUndoRedoStore((s) => s.future.length > 0)

  const undo = useCallback(() => {
    flushPending()
    const current = captureSnapshot()
    const snapshot = useUndoRedoStore.getState().undo(current)
    if (!snapshot) return
    _isRestoring = true
    try {
      useWorkflowStore.getState().restoreSnapshot(snapshot)
    } finally {
      _isRestoring = false
    }
  }, [])

  const redo = useCallback(() => {
    flushPending()
    const current = captureSnapshot()
    const snapshot = useUndoRedoStore.getState().redo(current)
    if (!snapshot) return
    _isRestoring = true
    try {
      useWorkflowStore.getState().restoreSnapshot(snapshot)
    } finally {
      _isRestoring = false
    }
  }, [])

  return { undo, redo, canUndo, canRedo }
}
