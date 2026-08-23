/**
 * "Select and frame these nodes" — a one-way signal to the canvas.
 *
 * Lives in core (not `ee/`) because `workflow-canvas.tsx` listens for it and
 * core code may not import from `ee/`. The Copilot panel is the only sender
 * today; anything else that needs to point the user at a set of nodes can
 * reuse it rather than reaching into React Flow from outside the canvas.
 *
 * **This stays a VIEW-ONLY signal.** Any script running on the page can
 * dispatch it, so it must never grow a field that performs an action —
 * `{ run: true }`, `{ delete: true }`, or node data to write. Selecting and
 * framing is the whole contract; anything more turns an ordinary DOM event
 * into an unauthenticated action channel.
 */
export const FOCUS_NODES_EVENT = "nodaro:focus-nodes"

export interface FocusNodesDetail {
  nodeIds: string[]
}

/** Upper bound on ids the listener will act on — a malformed detail must not wedge `fitView`. */
export const FOCUS_NODES_MAX = 500

/** A `select` change, as React Flow / the workflow store model it. */
export interface SelectChange {
  type: "select"
  id: string
  selected: boolean
}

/**
 * The changes that focus a set of nodes.
 *
 * ONLY `select` changes, never replacement node objects: `<ReactFlow>` is
 * controlled, so handing it new objects arrives at the store as a CONTENT
 * change and marks the workflow dirty. Pointing the user at something must
 * never write anything — and a dirty canvas additionally blocks the Copilot's
 * own catch-up, which refuses to adopt a remote graph over local edits.
 */
export function focusNodesChanges(allNodeIds: readonly string[], wantedIds: readonly string[]): SelectChange[] {
  const wanted = new Set(wantedIds)
  return allNodeIds.map((id) => ({ type: "select", id, selected: wanted.has(id) }))
}

/** Read the ids out of an event detail any page script could have authored. */
export function parseFocusNodesDetail(detail: unknown): string[] {
  const raw = (detail as FocusNodesDetail | undefined)?.nodeIds
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === "string").slice(0, FOCUS_NODES_MAX)
}
