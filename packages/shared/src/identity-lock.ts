/**
 * Identity Lock — strength control for facial likeness preservation when a
 * Character node's reference photo is fed into downstream generation.
 *
 * Real prompts seen in the wild (especially on Nano-Banana-Pro and
 * ChatGPT-Image) explicitly write `"identitylock": "priority absolute"` /
 * `"strictvisualfidelity": true` to clamp the face to the reference. This
 * helper produces the equivalent natural-language clause so the rest of the
 * stack stays unchanged.
 *
 * Used by:
 *  - frontend DAG executor (`workflow-editor/execute-node.ts`)
 *  - backend orchestrator (`services/workflow-engine/payload-builder.ts`)
 */
import type { GenericNode, GenericEdge } from "./types.js"
import { PASSTHROUGH_TYPES } from "./ancestor-refs.js"

export type IdentityLockMode = "off" | "soft" | "strict"

/** Default applied when a Character node was created before the field existed. */
export const DEFAULT_IDENTITY_LOCK: IdentityLockMode = "soft"

/** Strict beats Soft beats Off — when multiple Character nodes feed one node. */
const RANK: Record<IdentityLockMode, number> = { off: 0, soft: 1, strict: 2 }

/**
 * Natural-language clause for each mode. Returns an empty string for "off"
 * (or anything unrecognised) so callers can append unconditionally.
 */
export function getIdentityLockClause(mode: IdentityLockMode | undefined): string {
  switch (mode) {
    case "strict":
      return "the subject's facial identity must match the reference photo exactly — no creative reinterpretation; preserve facial structure, eye color, skin tone, and distinctive features precisely."
    case "soft":
      return "preserve the reference subject's overall facial likeness."
    default:
      return ""
  }
}

/** Coerce arbitrary node-data field into a valid `IdentityLockMode`. */
export function toIdentityLockMode(value: unknown): IdentityLockMode {
  if (value === "off" || value === "soft" || value === "strict") return value
  return DEFAULT_IDENTITY_LOCK
}

/**
 * Walk upstream from `nodeId`, find every Character node (passing through
 * text/logic helpers like `ai-writer`, `loop`, etc.), and return the prompt
 * clause for the strongest `identityLock` setting encountered.
 *
 * Returns an empty string when:
 *  - no Character nodes are upstream, OR
 *  - every upstream Character has `identityLock === "off"`
 *
 * Mirrors `collectAncestorRefs` so traversal rules stay aligned.
 */
export function collectIdentityLockClause<N extends GenericNode, E extends GenericEdge>(
  nodeId: string,
  nodes: readonly N[],
  edges: readonly E[],
): string {
  const strongest = collectStrongestIdentityLock(nodeId, nodes, edges)
  return getIdentityLockClause(strongest)
}

function collectStrongestIdentityLock<N extends GenericNode, E extends GenericEdge>(
  nodeId: string,
  nodes: readonly N[],
  edges: readonly E[],
  visited = new Set<string>(),
): IdentityLockMode | undefined {
  if (visited.has(nodeId)) return undefined
  visited.add(nodeId)
  let strongest: IdentityLockMode | undefined
  const incoming = edges.filter((e) => e.target === nodeId)
  for (const edge of incoming) {
    const src = nodes.find((n) => n.id === edge.source)
    if (!src) continue
    if (src.type === "character") {
      const mode = toIdentityLockMode((src.data as Record<string, unknown>).identityLock)
      if (!strongest || RANK[mode] > RANK[strongest]) strongest = mode
    }
    // Pass-through types don't produce refs themselves but may forward an
    // upstream Character (e.g. ai-writer wired to a Character then to image-gen).
    if (PASSTHROUGH_TYPES.has(src.type)) {
      const upstream = collectStrongestIdentityLock(src.id, nodes, edges, visited)
      if (upstream && (!strongest || RANK[upstream] > RANK[strongest])) strongest = upstream
    }
  }
  return strongest
}
