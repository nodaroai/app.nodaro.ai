/**
 * SSE event -> panel state. Pure and total: every event the backend can emit
 * has a branch, and an unknown event leaves the state untouched rather than
 * throwing inside the stream loop.
 *
 * Kept free of React so the turn engine can reduce outside a component and the
 * tests can drive a whole turn as a list of events.
 */
import { EMPTY_TURN, type CopilotStreamEvent, type CopilotTurnState } from "./types"

export function startTurn(userText: string): CopilotTurnState {
  return { ...EMPTY_TURN, status: "streaming", userText }
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
      // Only the latest update is shown: the card reports the cumulative graph,
      // so an earlier one is always a subset of a later one.
      return { ...state, update: event.data }

    case "run_proposed":
      return { ...state, proposal: event.data }

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
