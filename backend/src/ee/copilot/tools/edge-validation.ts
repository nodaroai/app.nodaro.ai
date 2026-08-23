/**
 * Edge validation for `edit_workflow`.
 *
 * Two tiers on purpose:
 *   ERRORS block the write — a dangling endpoint, a self-loop or a duplicate
 *   id is broken under any reading of the graph.
 *   WARNINGS are returned to the model — `NODE_HANDLES` is a vocabulary with
 *   intentional gaps (entity image pass-through, Collect/Group lane pips,
 *   dynamic list columns), so an unknown handle name is a smell, not proof.
 *   The authoritative per-type predicates live in the frontend
 *   (`connection-validation.ts`); porting them is a later item, and blocking
 *   on a partial copy would refuse graphs the editor accepts.
 */
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { NODE_HANDLES } from "../../../lib/mcp/generated/node-handles.js"

export interface EdgeLike {
  id?: string
  source?: string
  sourceHandle?: string | null
  target?: string
  targetHandle?: string | null
}

export interface NodeLike {
  id?: unknown
  type?: unknown
  data?: Record<string, unknown> | null
}

export interface EdgeValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** Types whose handles are created at run time and cannot be checked against the static map. */
const DYNAMIC_HANDLE_TYPES: ReadonlySet<string> = new Set([
  "list",
  "loop",
  "group",
  "collect",
  "router",
  "component",
  "sub-workflow",
  "sub-workflow-input",
  "sub-workflow-output",
  "selector",
])

/** Target handles that expect a specific media class. */
const MEDIA_TARGET_HANDLES: Readonly<Record<string, "video" | "audio">> = {
  video: "video",
  videoUrl: "video",
  audio: "audio",
  audioUrl: "audio",
  soundtrack: "audio",
}

function handleKnown(type: string, handle: string, side: "inputs" | "outputs"): boolean {
  if (DYNAMIC_HANDLE_TYPES.has(type)) return true
  const spec = NODE_HANDLES[type]
  if (!spec) return true // unknown type is reported by the type check, not here
  return spec[side].includes(handle)
}

export function validateWorkflowEdges(nodes: ReadonlyArray<NodeLike>, edges: ReadonlyArray<EdgeLike>): EdgeValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const typeById = new Map<string, string>()
  for (const n of nodes) {
    if (typeof n.id === "string" && typeof n.type === "string") typeById.set(n.id, n.type)
  }

  const seenIds = new Set<string>()
  for (const edge of edges) {
    const id = typeof edge.id === "string" ? edge.id : ""
    const source = typeof edge.source === "string" ? edge.source : ""
    const target = typeof edge.target === "string" ? edge.target : ""
    const where = id || `${source}→${target}`

    if (id) {
      if (seenIds.has(id)) errors.push(`edge "${id}": duplicate edge id`)
      seenIds.add(id)
    }
    if (!source || !target) {
      errors.push(`edge "${where}": both source and target are required`)
      continue
    }
    if (source === target) {
      errors.push(`edge "${where}": an edge cannot connect a node to itself`)
      continue
    }
    const sourceType = typeById.get(source)
    const targetType = typeById.get(target)
    if (!sourceType) errors.push(`edge "${where}": source node "${source}" does not exist`)
    if (!targetType) errors.push(`edge "${where}": target node "${target}" does not exist`)
    if (!sourceType || !targetType) continue

    const sourceHandle = typeof edge.sourceHandle === "string" ? edge.sourceHandle : null
    const targetHandle = typeof edge.targetHandle === "string" ? edge.targetHandle : null

    if (sourceHandle && !handleKnown(sourceType, sourceHandle, "outputs")) {
      warnings.push(
        `edge "${where}": "${sourceHandle}" is not a published output of ${sourceType} (known: ${(NODE_HANDLES[sourceType]?.outputs ?? []).join(", ") || "none"})`,
      )
    }
    if (targetHandle && !handleKnown(targetType, targetHandle, "inputs")) {
      warnings.push(
        `edge "${where}": "${targetHandle}" is not a published input of ${targetType} (known: ${(NODE_HANDLES[targetType]?.inputs ?? []).join(", ") || "none"})`,
      )
    }

    const expected = targetHandle ? MEDIA_TARGET_HANDLES[targetHandle] : undefined
    if (expected && !DYNAMIC_PRODUCER_TYPES.has(sourceType)) {
      const produces = expected === "video" ? VIDEO_PRODUCER_TYPES.has(sourceType) : AUDIO_PRODUCER_TYPES.has(sourceType)
      if (!produces) {
        warnings.push(`edge "${where}": ${sourceType} does not look like a ${expected} source for the "${targetHandle}" input`)
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Node types the map knows about — used for the "unknown type" suggestion. */
export function knownNodeTypes(): string[] {
  return Object.keys(NODE_HANDLES)
}

/** Cheap closest-match suggestion for an unknown node type. */
export function suggestNodeTypes(type: string, limit = 3): string[] {
  const target = type.toLowerCase()
  return knownNodeTypes()
    .map((candidate) => ({ candidate, score: similarity(target, candidate) }))
    .filter((s) => s.score > 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.candidate)
}

/** Dice coefficient over character bigrams — enough to catch a typo or a plural. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const bigrams = (s: string): string[] => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2))
  const first = bigrams(a)
  const second = bigrams(b)
  if (first.length === 0 || second.length === 0) return 0
  const pool = [...second]
  let hits = 0
  for (const gram of first) {
    const idx = pool.indexOf(gram)
    if (idx >= 0) {
      hits += 1
      pool.splice(idx, 1)
    }
  }
  return (2 * hits) / (first.length + second.length)
}
