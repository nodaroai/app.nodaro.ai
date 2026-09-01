import { runtimeSurfaceProfile } from "./surface-profile.js"
import {
  availabilityOverride,
  GATEABLE_NODE_TYPES,
  GATEABLE_MODEL_IDS,
} from "./availability-override.js"

/**
 * Backend-authoritative node/model availability for a deployment (B1 + B5).
 *
 * Mirrors cloud-only-nodes.ts exactly — a predicate + a `find` + a shared
 * message — and is applied at the same chokepoints (`GET /v1/nodes`, the
 * workflow write guards, the MCP write tool) plus the run-time throw in
 * payload-builder that pre-existing rows / imports / templates reach without
 * touching a write guard. A denied node is invisible in discovery, refused at
 * write, and fails honestly at run.
 *
 * THREE LAYERS, resolved here so every chokepoint stays a one-word predicate:
 *
 *   1. code/edition — what the build ships (edition gates are their own layer
 *      and always apply on top: cloud-only-nodes etc.).
 *   2. surface profile (the FACTORY set) — `allow` non-empty ⇒ whitelist over
 *      the gateable universe, minus `deny`. The whitelist is the safer,
 *      recommended shape for a curated deployment: a node the profile never
 *      heard of is unavailable by default instead of available by omission.
 *   3. admin override (availability-override.ts) — a stored enabled-set that
 *      REPLACES layer 2 while present; "reset to factory" deletes it.
 *
 * INVERSION SCOPE: allow-lists and overrides say "not listed ⇒ denied", so
 * they only invert over the GATEABLE universes (registry minus utility nodes;
 * catalog + LLM model ids). Workflow-internal pseudo-types and utility nodes
 * (sticky-note, preview) can never be denied by omission — only by an explicit
 * `deny` entry.
 */

/** True when this deployment does not offer this node type. */
export function isNodeDenied(type: string): boolean {
  const override = availabilityOverride("nodes")
  if (override) return GATEABLE_NODE_TYPES.has(type) && !override.has(type)
  const { deny, allow } = runtimeSurfaceProfile().nodes
  if (allow.length && GATEABLE_NODE_TYPES.has(type) && !allow.includes(type)) return true
  return deny.includes(type)
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

/** True when this deployment does not offer this model id. */
export function isModelDenied(id: string): boolean {
  const override = availabilityOverride("models")
  if (override) return GATEABLE_MODEL_IDS.has(id) && !override.has(id)
  const { deny, allow } = runtimeSurfaceProfile().models
  if (allow.length && GATEABLE_MODEL_IDS.has(id) && !allow.includes(id)) return true
  return deny.includes(id)
}

/** Shared refusal text for a denied model, parallel to the node message. */
export function deniedModelRejectionMessage(ids: readonly string[]): string {
  return (
    `This workflow uses ${ids.length > 1 ? "models that are" : "a model that is"} not available on this deployment: ` +
    `${ids.join(", ")}. Switch to an available model to run this workflow.`
  )
}

/** Drop models the deployment does not offer (applied at each read/projection site). */
export function filterDeniedModels<T extends { id: string }>(models: readonly T[]): T[] {
  return models.filter((m) => !isModelDenied(m.id))
}

/**
 * The EFFECTIVE denied sets over the gateable universes — what the browser's
 * picker/dropdown filters mirror (GET /v1/surface/availability). Explicit
 * profile `deny` entries outside the universe are included so the frontend
 * keeps hiding them exactly as it does today.
 */
export function effectiveDeniedNodeTypes(): string[] {
  const denied = new Set<string>()
  for (const t of GATEABLE_NODE_TYPES) if (isNodeDenied(t)) denied.add(t)
  for (const t of runtimeSurfaceProfile().nodes.deny) if (isNodeDenied(t)) denied.add(t)
  return [...denied]
}

export function effectiveDeniedModelIds(): string[] {
  const denied = new Set<string>()
  for (const id of GATEABLE_MODEL_IDS) if (isModelDenied(id)) denied.add(id)
  for (const id of runtimeSurfaceProfile().models.deny) if (isModelDenied(id)) denied.add(id)
  return [...denied]
}
