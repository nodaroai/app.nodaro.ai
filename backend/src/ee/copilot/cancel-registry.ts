/**
 * In-process abort handles for running turns, keyed by turn id. The cancel
 * route fires the local controller when the turn runs on this replica; the
 * DB flag (`copilot_turns.cancel_requested_at`), polled before every tool
 * call, covers the other replicas.
 */
const controllers = new Map<string, AbortController>()

export function registerTurnAbort(turnId: string, controller: AbortController): void {
  controllers.set(turnId, controller)
}

export function unregisterTurnAbort(turnId: string): void {
  controllers.delete(turnId)
}

/** True when a controller was found (and aborted) on this replica. */
export function abortTurnLocally(turnId: string, reason: string): boolean {
  const controller = controllers.get(turnId)
  if (!controller) return false
  controller.abort(new Error(reason))
  return true
}
