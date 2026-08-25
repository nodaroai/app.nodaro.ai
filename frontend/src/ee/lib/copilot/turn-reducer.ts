/**
 * SSE event -> panel state. Pure and total: every event the backend can emit
 * has a branch, and an unknown event leaves the state untouched rather than
 * throwing inside the stream loop.
 *
 * Kept free of React so the turn engine can reduce outside a component and the
 * tests can drive a whole turn as a list of events.
 */
import {
  EMPTY_TURN,
  type CopilotStreamEvent,
  type CopilotTurnState,
  type CopilotWorkflowUpdate,
} from "./types"

/**
 * `startedAt` is a PARAMETER, not a `Date.now()` inside: this file is the one
 * place a whole turn can be replayed as a list of events, and a clock read in
 * here would make that replay non-deterministic.
 */
export function startTurn(userText: string, startedAt: number): CopilotTurnState {
  return { ...EMPTY_TURN, status: "streaming", userText, startedAt }
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])]

/**
 * One turn's edits, added up.
 *
 * A turn used to make exactly one `edit_workflow` call, so keeping the latest
 * event was the same as keeping the whole turn. It is not any more: the doctrine
 * asks for a big graph to be written in stages, so a twelve-node build arrives
 * as three events — and "latest wins" would report the last stage's four nodes
 * as the turn's total, focus only those on "Show on canvas", and skip the
 * end-of-turn layout entirely whenever the final stage only wired edges.
 *
 * Ids accumulate; the counts, version and timestamp are already cumulative and
 * so take the newest. A node added early and deleted later is reported as
 * removed and not as added — the graph is what the user ends up with.
 */
function mergeUpdate(prev: CopilotWorkflowUpdate | null, next: CopilotWorkflowUpdate): CopilotWorkflowUpdate {
  if (!prev || prev.workflowId !== next.workflowId) return next
  const removedNodeIds = union(prev.removedNodeIds, next.removedNodeIds)
  const removed = new Set(removedNodeIds)
  return {
    ...next,
    addedNodeIds: union(prev.addedNodeIds, next.addedNodeIds).filter((id) => !removed.has(id)),
    // A node this turn created and then configured is an ADD, not an edit —
    // counting it in both would report more work than was done.
    updatedNodeIds: union(prev.updatedNodeIds, next.updatedNodeIds).filter(
      (id) => !removed.has(id) && !prev.addedNodeIds.includes(id) && !next.addedNodeIds.includes(id),
    ),
    removedNodeIds,
    addedNodeTypes: union(prev.addedNodeTypes, next.addedNodeTypes),
    adjustments: [...prev.adjustments, ...next.adjustments],
    note: next.note ?? prev.note,
  }
}

export function reduceTurn(state: CopilotTurnState, event: CopilotStreamEvent): CopilotTurnState {
  switch (event.type) {
    case "metadata":
      return { ...state, turnId: event.data.turnId, status: "streaming" }

    case "token":
      return { ...state, text: state.text + event.data.text }

    case "tool_call": {
      const { id, label, status, summary } = event.data
      const note = summary ?? ""
      const existing = state.activities.findIndex((a) => a.id === id)
      if (existing === -1) {
        return { ...state, activities: [...state.activities, { id, label, note, status }] }
      }
      const activities = state.activities.map((a, i) =>
        i === existing ? { ...a, label, status, note: note || a.note } : a,
      )
      return { ...state, activities }
    }

    case "workflow_updated":
      return { ...state, update: mergeUpdate(state.update, event.data) }

    case "run_proposed":
      return { ...state, proposal: event.data }

    case "memory_saved": {
      // Idempotent by id: a reconnect can replay the event, and two pinned
      // lines for one save would read as two writes.
      if (state.memorySaves.some((m) => m.id === event.data.id)) return state
      return { ...state, memorySaves: [...state.memorySaves, event.data] }
    }

    case "usage":
      return { ...state, creditsCharged: event.data.creditsCharged }

    case "done":
      return { ...state, status: event.data.status, turnId: event.data.turnId ?? state.turnId }

    case "error":
      return { ...state, status: "failed", error: event.data }

    default:
      return state
  }
}

/** A turn that ended one way or another. Used by the tests as the settled predicate. */
export function isTurnOver(state: CopilotTurnState): boolean {
  return state.status !== "streaming" && state.status !== "idle"
}
