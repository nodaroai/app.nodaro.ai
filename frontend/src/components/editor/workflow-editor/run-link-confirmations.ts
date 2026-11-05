import { withNodeLinkRightsConfirmations } from "@/lib/node-link-rights"
import { runGraph } from "./run-graph"

/**
 * A server run's overrides, with this run's confirmation for every node about
 * to run whose own link the run hands on (`node-link-rights.ts`; the pre-run
 * gate, `ensureVideoLinksBeforeRun`, made sure each one's box is ticked).
 * Called once per Run click, outside its retry, so a retry of the click sends
 * the same confirmation under the same key. A refused confirmation (a changed
 * declaration unticks every box), or a link whose box is not ticked for it (one
 * the gate did not see: the request's own override of the link), throws, and
 * the run does not start. With no such node the overrides come back as they were.
 */
export function withRunLinkConfirmations(
  scopeIds: readonly string[] | null,
  overrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Promise<Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined> {
  return withNodeLinkRightsConfirmations(runGraph().nodes, scopeIds, overrides)
}
