/**
 * Shared flag module for undo/redo system.
 *
 * When `skipUndoCapture` is true, the undo subscription ignores the
 * current state change (no snapshot is pushed and the redo stack is
 * not cleared). This is used by `updateNodeData` when the update
 * only touches execution-related fields (status, progress, results)
 * so that job polling doesn't pollute the undo history.
 */

let _skipUndoCapture = false

export function isSkipUndoCapture(): boolean {
  return _skipUndoCapture
}

export function setSkipUndoCapture(value: boolean): void {
  _skipUndoCapture = value
}
