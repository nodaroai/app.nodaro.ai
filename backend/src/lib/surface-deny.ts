import { runtimeSurfaceProfile } from "./surface-profile.js"

/**
 * Backend-authoritative node/model deny for the deployment surface profile (B1).
 *
 * Mirrors cloud-only-nodes.ts exactly — a predicate + a `find` + a shared
 * message — and is applied at the same chokepoints (`GET /v1/nodes`, the
 * workflow write guards, the MCP write tool) plus the run-time throw in
 * payload-builder that pre-existing rows / imports / templates reach without
 * touching a write guard. Reads the resolved profile, so a denied node is
 * invisible in discovery, refused at write, and fails honestly at run.
 */

/** True when the surface profile denies this node type for this deployment. */
export function isNodeDenied(type: string): boolean {
  return runtimeSurfaceProfile().nodes.deny.includes(type)
}

export function findDeniedNodeTypes(nodes: ReadonlyArray<{ type?: unknown }> | undefined): string[] {
  if (!nodes?.length) return []
  const found = new Set<string>()
  for (const n of nodes) if (typeof n?.type === "string" && isNodeDenied(n.type)) found.add(n.type)
  return [...found]
}

/** Shared refusal text so import / MCP / REST / run explain it the same way. */
export function deniedNodeRejectionMessage(types: readonly string[]): string {
  return (
    `This workflow uses ${types.length > 1 ? "nodes that are" : "a node that is"} not available on this deployment: ` +
    `${types.join(", ")}. Remove ${types.length > 1 ? "them" : "it"} to run this workflow.`
  )
}

/** True when the surface profile denies this model id for this deployment. */
export function isModelDenied(id: string): boolean {
  return runtimeSurfaceProfile().models.deny.includes(id)
}

/** Shared refusal text for a denied model, parallel to the node message. */
export function deniedModelRejectionMessage(ids: readonly string[]): string {
  return (
    `This workflow uses ${ids.length > 1 ? "models that are" : "a model that is"} not available on this deployment: ` +
    `${ids.join(", ")}. Switch to an available model to run this workflow.`
  )
}

/** Drop models the deployment surface denies (applied at each read/projection site). */
export function filterDeniedModels<T extends { id: string }>(models: readonly T[]): T[] {
  const deny = runtimeSurfaceProfile().models.deny
  return deny.length ? models.filter((m) => !deny.includes(m.id)) : [...models]
}
