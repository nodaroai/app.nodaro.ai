import { useEffect, useCallback } from "react"
import { useWorkflowStore } from "./use-workflow-store"
import { useUndoRedoStore, type WorkflowSnapshot } from "./use-undo-redo-store"

// Module-level state shared across hook instances
let _isRestoring = false
let _pendingSnapshot: WorkflowSnapshot | null = null
let _debounceTimer: ReturnType<typeof setTimeout> | null = null

function captureSnapshot(): WorkflowSnapshot {
  const s = useWorkflowStore.getState()
  return {
    nodes: s.nodes,
    edges: s.edges,
    characterDefinitions: s.characterDefinitions,
    flowPromptTemplates: s.flowPromptTemplates,
    workflowName: s.workflowName,
  }
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
    let prevIsDirty = useWorkflowStore.getState().isDirty

    const unsub = useWorkflowStore.subscribe((state, prevState) => {
      // Skip if we're restoring a snapshot
      if (_isRestoring) return

      // On load/clear (isDirty becomes false), clear history
      if (!state.isDirty && prevIsDirty) {
        flushPending()
        useUndoRedoStore.getState().clear()
        prevIsDirty = false
        return
      }

      prevIsDirty = state.isDirty

      // Only track changes that set isDirty
      if (!state.isDirty) return

      // Capture the "before" state on first change in a burst
      if (!_pendingSnapshot) {
        _pendingSnapshot = {
          nodes: prevState.nodes,
          edges: prevState.edges,
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
    useWorkflowStore.getState().restoreSnapshot(snapshot)
    _isRestoring = false
  }, [])

  const redo = useCallback(() => {
    flushPending()
    const current = captureSnapshot()
    const snapshot = useUndoRedoStore.getState().redo(current)
    if (!snapshot) return
    _isRestoring = true
    useWorkflowStore.getState().restoreSnapshot(snapshot)
    _isRestoring = false
  }, [])

  return { undo, redo, canUndo, canRedo }
}
