/**
 * Edition/connection gating for node types, backend half.
 *
 * The frontend has its own copy at `frontend/src/lib/cloud-only-nodes.ts`,
 * which the node pickers import. The two are NOT allowed to drift: the guard
 * test `__tests__/cloud-only-nodes.test.ts` parses the frontend file and
 * asserts both sets are identical, so adding a type on one side and
 * forgetting the other fails CI instead of shipping a node that is offered
 * but can't run.
 *
 * They stay as two files rather than one shared module because
 * `packages/shared` is published Apache-2.0 — an irrevocable public grant —
 * and this list is an edition-gating detail, not part of the public wire
 * contract (root CLAUDE.md, IP-placement rule).
 *
 * Why the backend needs it at all: `GET /v1/nodes` is the discovery contract
 * for the SDK, CLI and MCP agents. Without this filter a community install
 * advertised all five Cloud-only nodes — complete with credit costs, in an
 * edition that has no credits — and callers only found out at execution time
 * (community grind, 2026-08-13).
 */

/**
 * The Nodaro-EXCLUSIVE node types (4b): served by @nodaroai/cloud-plugins on
 * the cloud, and on self-hosted editions relayed to the cloud through the
 * nodaro.ai credential (routes/nodaro-exclusive.ts + the relay worker).
 * They SAVE everywhere (a workflow is data); discovery and execution gate on
 * `isNodaroConnected()`, not on edition.
 */
export const NODARO_EXCLUSIVE_NODE_TYPES: ReadonlySet<string> = new Set([
  "voice-changer-pro",
  "generate-video-pro",
  "edit-video-pro",
  "video-analysis",
  "video-audit",
])

/**
 * Truly Cloud-only: no relay exists. generative-pipeline is an interactive
 * pipeline ENGINE (every /v1/pipelines handler is edition-gated and the
 * pipeline worker is Cloud-only) — out of the 4b relay's scope by design.
 */
export const CLOUD_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  "generative-pipeline",
])

/**
 * Node types in `nodes` that this edition cannot execute.
 *
 * The node pickers filter their own menus, but a workflow can also arrive by
 * JSON import, MCP write, template or marketplace component — none of which
 * consult that filter. Such a node rendered with an ENABLED Run button and
 * died as a 404 toast, or server-side as `Unknown job type: video-analysis`
 * (community grind, 2026-08-14). Callers reject the write with the returned
 * list so the user learns why before the run, not after.
 */
export function findCloudOnlyNodeTypes(
  nodes: ReadonlyArray<{ type?: unknown }> | undefined,
): string[] {
  if (!nodes?.length) return []
  const found = new Set<string>()
  for (const n of nodes) {
    if (typeof n?.type === "string" && CLOUD_ONLY_NODE_TYPES.has(n.type)) found.add(n.type)
  }
  return [...found]
}

/** Shared refusal text, so import / MCP / REST all explain it the same way.
 *  Since 4b this names only the truly cloud-only set (generative-pipeline) —
 *  the exclusive nodes save everywhere and gate at run time instead. */
export function cloudOnlyRejectionMessage(types: readonly string[]): string {
  return (
    `This workflow uses ${types.length > 1 ? "nodes that run" : "a node that runs"} on Nodaro Cloud only: ` +
    `${types.join(", ")}. Remove ${types.length > 1 ? "them" : "it"}, or run the workflow on nodaro.ai.`
  )
}
