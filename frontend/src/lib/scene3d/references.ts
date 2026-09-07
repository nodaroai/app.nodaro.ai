/**
 * Resolve the image/video references wired into a 3D-scene node's `references`
 * handle into the wire shape the route forwards to the authoring LLM.
 *
 * Pure on purpose: the canvas run path, a re-run after restore and the tests
 * all use the same function, and none of them needs the React Flow store to
 * decide what a reference IS.
 */
import { SCENE3D_LIMITS } from "@nodaro/shared"
import type { Scene3DNodeReference } from "@/types/nodes"

export const SCENE3D_REFERENCE_ROLES = ["appearance", "layout", "motion"] as const
export type Scene3DReferenceRole = (typeof SCENE3D_REFERENCE_ROLES)[number]

export const DEFAULT_REFERENCE_ROLE: Scene3DReferenceRole = "appearance"

function isRole(value: unknown): value is Scene3DReferenceRole {
  return typeof value === "string" && (SCENE3D_REFERENCE_ROLES as readonly string[]).includes(value)
}

export type ResolveReferencesParams = {
  nodeId: string
  /** Explicit/imported references; live wires replace matching IDs. */
  references?: readonly Scene3DNodeReference[]
  edges: ReadonlyArray<{ source: string; target: string; targetHandle?: string | null }>
  /** The upstream node's primary output (a URL for a media producer). */
  outputOf: (sourceNodeId: string) => string | undefined
  /** Per-source-node role chosen in the config panel. Missing → `appearance`. */
  roles?: Record<string, string>
  /** Per-source-node object binding chosen in the config panel. */
  objectIds?: Record<string, string>
  isVideoUrl: (url: string) => boolean
}

/**
 * One entry per wired producer, in edge order, de-duplicated by source node.
 * A source with no resolvable URL is skipped — sending an unresolved handle
 * would fail the route's `safeUrlSchema` for no user-visible reason.
 */
export function resolveScene3DReferences(params: ResolveReferencesParams): Scene3DNodeReference[] {
  const { nodeId, edges, outputOf, roles, objectIds, isVideoUrl } = params
  const out: Scene3DNodeReference[] = [...(params.references ?? [])]
  const seen = new Set<string>()

  for (const edge of edges) {
    if (edge.target !== nodeId || edge.targetHandle !== "references") continue
    if (seen.has(edge.source)) continue
    const url = outputOf(edge.source)
    if (!url || !(url.startsWith("http") || url.startsWith("/"))) continue
    seen.add(edge.source)
    const role = roles?.[edge.source]
    const objectId = objectIds?.[edge.source]
    const reference: Scene3DNodeReference = {
      id: edge.source,
      url,
      kind: isVideoUrl(url) ? "video" : "image",
      role: isRole(role) ? role : isVideoUrl(url) ? "motion" : DEFAULT_REFERENCE_ROLE,
      ...(objectId ? { objectId } : {}),
    }
    const existing = out.findIndex((entry) => entry.id === reference.id)
    if (existing >= 0) out[existing] = reference
    else out.push(reference)
  }
  return out
}

/**
 * Gate a resolved reference set against the wire limit.
 *
 * This REFUSES rather than trims. Truncating (what this used to do, with a
 * toast) means the run that gets charged is not the run the user wired: the
 * dropped references are exactly the ones they added last, the warning scrolls
 * past, and the scene comes back missing a subject nobody can point at. A
 * refusal costs nothing, happens before the request, and says which references
 * to detach.
 *
 * The ceiling is read from the SHARED `SCENE3D_LIMITS`, the same constant the
 * route's Zod uses — a hardcoded 8 here would be a silent drift the day the
 * limit moves, and the failure mode of being STALE-HIGH is a charged request
 * the route then 400s. (The route additionally allows only one VIDEO reference.
 * That constant is not exported from `@nodaro/shared` yet, so it is deliberately
 * NOT restated here: the route's friendly 400 lands on the node before any
 * credits are reserved. Hardcoding a `1` client-side would be the same drift in
 * the other direction.)
 */
export function checkScene3DReferenceLimit(
  references: readonly Scene3DNodeReference[],
): { ok: true } | { ok: false; message: string } {
  const max = SCENE3D_LIMITS.maxReferences
  if (references.length <= max) return { ok: true }
  return {
    ok: false,
    message: `${references.length} references are wired; this node sends at most ${max}. Detach ${references.length - max} before running.`,
  }
}
