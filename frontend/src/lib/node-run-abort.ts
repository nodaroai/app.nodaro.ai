/**
 * Per-node run cancellation registry.
 *
 * A single-node run (`handleRunSingleNode`) registers an `AbortController`
 * keyed by node id and threads its signal into the execution (streaming SSE,
 * and anything else that honors `ctx.signal`). The node's Stop button calls
 * `abortNodeRun(nodeId)` to abort it — which cancels an in-flight `fetch`/SSE
 * stream immediately, instead of only flipping the UI status while the request
 * keeps running.
 *
 * Module-level (not Zustand) on purpose: this is imperative control-flow
 * plumbing, not reactive UI state, so it shouldn't trigger re-renders.
 */
const registry = new Map<string, AbortController>()

/** Register the controller for a node's run, aborting any prior run first. */
export function registerNodeRunAbort(nodeId: string, controller: AbortController): void {
  registry.get(nodeId)?.abort()
  registry.set(nodeId, controller)
}

/** Remove a node's controller. Pass the controller to avoid clearing a newer
 *  run that may have replaced it (stale-finally guard). */
export function clearNodeRunAbort(nodeId: string, controller?: AbortController): void {
  const current = registry.get(nodeId)
  if (!controller || current === controller) registry.delete(nodeId)
}

/** Abort a node's in-flight run. Returns true if a controller was registered. */
export function abortNodeRun(nodeId: string): boolean {
  const controller = registry.get(nodeId)
  if (!controller) return false
  controller.abort()
  registry.delete(nodeId)
  return true
}
