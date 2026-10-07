/**
 * One normalizer for every workflow graph the server writes on an agent's
 * behalf — the MCP write tools (`create_workflow`, `update_workflow_json`,
 * `import_workflow`), the REST delta lane and the Workflow Copilot's
 * `edit_workflow`.
 *
 * WHY. The canvas draws an edge only when its `sourceHandle` / `targetHandle`
 * name a pip the node actually renders (an unknown id is React Flow error 008:
 * the edge exists, runs on the server, and is invisible) and when the edge
 * has an `id` (nothing backfills one). An agent takes its handle names from
 * the published docs, and for months those named `text` on a node that
 * rendered `out` — a correct-looking graph came out unconnected (2026-10-05).
 * The editor already rewires legacy ids when it LOADS a graph; this applies
 * the same rules when one is WRITTEN, plus the one correction only a server
 * can make at that moment: an id for an edge that has none.
 *
 * REWIRE ONLY WHAT THE EDITOR WOULD. A handle id changes only by a rule the
 * editor's own load-time pass applies (`@nodaro/shared` handle-aliases.ts: the
 * alias tables and the source-type classifiers that follow them), by the
 * Generate Image migration, by `llm-chat`'s legacy `in`, or — for a node whose
 * component still renders a pip its definition does not declare (the burn-down
 * list, `RENDERED_OUTPUT_HANDLES`) — from the declared-only id to the one pip
 * that draws. Any other id the node does not declare is stored AS SENT and
 * reported as a warning, never coerced to "the node's only handle": a client
 * that learned a node's real pip from `get_workflow_json` must not have it
 * "corrected" into an invisible one. An edge that names no node, loops on
 * itself or has no endpoint is DROPPED with a warning — the orchestrator never
 * ran it anyway, and refusing it would refuse every graph that already carries
 * one. A duplicate id is the one thing refused: two edges cannot share it. An
 * edge sent twice WITHOUT an id (the same connection, as stored) is kept once
 * and the repeat dropped with a warning — two ids for one wire would otherwise
 * be stored side by side.
 */
import {
  DYNAMIC_HANDLE_NODE_TYPES,
  IMAGE_PRODUCER_TYPES,
  RENDERED_OUTPUT_HANDLES,
  canonicalSourceHandle,
  canonicalTargetHandle,
  classifyLegacyTargetHandle,
  renderedSourceHandle,
} from "@nodaro/shared"
import { migrateGenerateImageHandles } from "./generate-image-handle-migration.js"
import { NODE_HANDLES } from "./mcp/generated/node-handles.js"

export type EdgeAdjustmentField = "id" | "sourceHandle" | "targetHandle"
export type EdgeAdjustmentReason =
  /** The edge had no id. */
  | "generated"
  /** A recorded legacy spelling of the handle. */
  | "alias"
  /** A classifier chose the handle from the other node's type. */
  | "classified"
  /** The declared id names no rendered pip; the one pip the node renders for it. */
  | "rendered"
  /** The Generate Image handle migration (`cinematography` / `style` / `subjects` / `in`). */
  | "generate-image"

export interface EdgeAdjustment {
  /** The edge's id as stored (after normalization). */
  readonly edgeId: string
  readonly field: EdgeAdjustmentField
  readonly from: string | null
  readonly to: string
  readonly reason: EdgeAdjustmentReason
}

/** The fields the normalizer reads; anything else on an edge rides through untouched. */
export interface NormalizableEdge {
  readonly id?: unknown
  readonly source?: unknown
  readonly target?: unknown
  readonly sourceHandle?: unknown
  readonly targetHandle?: unknown
}

export interface NormalizableNode {
  readonly id?: unknown
  readonly type?: unknown
}

export interface NormalizeEdgesOptions {
  /**
   * Ids already in use elsewhere in the graph — the stored edges a delta
   * leaves alone. A generated id never collides with one of them.
   */
  readonly reservedIds?: Iterable<string>
}

export interface NormalizedEdges<E extends NormalizableEdge> {
  /** The edges to store — the dropped ones left out. */
  readonly edges: E[]
  readonly adjustments: EdgeAdjustment[]
  /** Handles the node does not declare, stored as sent. */
  readonly warnings: string[]
  /** Edges left out: an endpoint naming no node, a self-loop, a missing endpoint, a non-object, an id-less repeat of a connection. */
  readonly dropped: string[]
  /** A duplicate id — a caller refuses the whole write when non-empty. */
  readonly errors: string[]
}

type Draft = Omit<EdgeAdjustment, "edgeId">

interface HandleFix {
  readonly handle: string | null
  readonly drafts: Draft[]
  readonly warning: string | null
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

/** The source pips the canvas draws for a node type: the rendered override when the definition lags, else the declared outputs. */
function renderedOutputs(nodeType: string): ReadonlyArray<string> | null {
  return RENDERED_OUTPUT_HANDLES[nodeType] ?? NODE_HANDLES[nodeType]?.outputs ?? null
}

/**
 * Where an `llm-chat` legacy `in` edge belongs: `references` for an image,
 * `prompt` for everything else. (The editor's own load-time rule for the
 * nodes it renamed from ai-writer sends every `in` to `prompt`; an agent
 * wiring an image producer into `in` meant the references handle.)
 */
function classifyLlmChatInput(sourceType: string): "prompt" | "references" {
  return IMAGE_PRODUCER_TYPES.has(sourceType) ? "references" : "prompt"
}

function fixSourceHandle(handle: string | null, nodeType: string, where: string): HandleFix {
  const keep: HandleFix = { handle, drafts: [], warning: null }
  if (handle === null || DYNAMIC_HANDLE_NODE_TYPES.has(nodeType)) return keep
  const rendered = renderedOutputs(nodeType)
  if (!rendered) return keep // an unknown node type is the type check's finding, not this one's
  if (rendered.includes(handle)) return keep
  const alias = canonicalSourceHandle(nodeType, handle)
  if (alias !== handle && rendered.includes(alias)) {
    return { handle: alias, drafts: [{ field: "sourceHandle", from: handle, to: alias, reason: "alias" }], warning: null }
  }
  // The definition declares it, the component renders something else (the
  // burn-down list): the one pip that draws for it, when there is one.
  const declared = NODE_HANDLES[nodeType]?.outputs ?? []
  if (RENDERED_OUTPUT_HANDLES[nodeType] && declared.includes(handle)) {
    const pip = renderedSourceHandle(nodeType, handle, declared)
    if (pip) return { handle: pip, drafts: [{ field: "sourceHandle", from: handle, to: pip, reason: "rendered" }], warning: null }
    return {
      handle,
      drafts: [],
      warning:
        `edge "${where}": "${handle}" is declared by ${nodeType} but the node renders ${rendered.join(", ")} — ` +
        `stored as sent; the canvas draws an edge only on a pip the node renders`,
    }
  }
  return {
    handle,
    drafts: [],
    warning:
      `edge "${where}": "${handle}" is not an output of ${nodeType} (outputs: ${rendered.length ? rendered.join(", ") : "none"}) — ` +
      `stored as sent; the canvas draws an edge only on a handle the node renders`,
  }
}

function fixTargetHandle(sent: string | null, nodeType: string, sourceType: string, where: string): HandleFix {
  const drafts: Draft[] = []
  let handle: string | null = sent
  // 1. The alias table, then the source-type classifiers — the editor's own
  //    load-time order (a classifier may reinterpret what the table chose).
  if (handle !== null) {
    const alias = canonicalTargetHandle(nodeType, handle)
    if (alias !== handle) {
      drafts.push({ field: "targetHandle", from: handle, to: alias, reason: "alias" })
      handle = alias
    }
  }
  const classified = classifyLegacyTargetHandle(nodeType, handle, sourceType, sent) ?? null
  if (classified !== handle && classified !== null) {
    drafts.push({ field: "targetHandle", from: handle, to: classified, reason: "classified" })
    handle = classified
  }
  if (handle === null || DYNAMIC_HANDLE_NODE_TYPES.has(nodeType)) return { handle, drafts, warning: null }
  const inputs = NODE_HANDLES[nodeType]?.inputs
  if (!inputs || inputs.includes(handle)) return { handle, drafts, warning: null }
  if (nodeType === "llm-chat" && handle === "in") {
    const chosen = classifyLlmChatInput(sourceType)
    drafts.push({ field: "targetHandle", from: handle, to: chosen, reason: "classified" })
    return { handle: chosen, drafts, warning: null }
  }
  return {
    handle,
    drafts,
    warning:
      `edge "${where}": "${handle}" is not an input of ${nodeType} (inputs: ${inputs.length ? inputs.join(", ") : "none"}) — ` +
      `stored as sent; the canvas draws an edge only on a handle the node renders`,
  }
}

/** The id an edge without one gets — the same shape the Copilot's `edgeId` gives, unique in this graph. */
function freshId(source: string, sourceHandle: string | null, target: string, targetHandle: string | null, taken: ReadonlySet<string>): string {
  const base = `e-${source}-${sourceHandle ?? "out"}-${target}-${targetHandle ?? "in"}`
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** The connection an edge makes, as stored — what an id-less repeat is judged by. */
function connectionKey(source: string, sourceHandle: string | null, target: string, targetHandle: string | null): string {
  return [source, sourceHandle ?? "", target, targetHandle ?? ""].join("\u0000")
}

export function normalizeWorkflowEdges<E extends NormalizableEdge>(
  nodes: ReadonlyArray<NormalizableNode>,
  edges: ReadonlyArray<E> | null | undefined,
  options: NormalizeEdgesOptions = {},
): NormalizedEdges<E> {
  const errors: string[] = []
  const warnings: string[] = []
  const dropped: string[] = []
  const typeById = new Map<string, string>()
  for (const n of nodes) {
    if (typeof n.id === "string" && typeof n.type === "string") typeById.set(n.id, n.type)
  }

  // 1. Structural. A broken edge is dropped (the run never used it); a duplicate id refuses the write.
  const seenIds = new Set<string>()
  const sound: Array<{ readonly edge: E; readonly source: string; readonly target: string; readonly where: string }> = []
  for (const raw of edges ?? []) {
    if (!raw || typeof raw !== "object") {
      dropped.push("an edge that is not an object was dropped")
      continue
    }
    const id = str(raw.id)
    const source = str(raw.source)
    const target = str(raw.target)
    const where = id ?? `${source ?? "?"}→${target ?? "?"}`
    if (id !== null) {
      if (seenIds.has(id)) {
        errors.push(`edge "${id}": duplicate edge id`)
        continue
      }
      seenIds.add(id)
    }
    if (!source || !target) {
      dropped.push(`edge "${where}": both source and target are required — dropped`)
      continue
    }
    if (source === target) {
      dropped.push(`edge "${where}": an edge cannot connect a node to itself — dropped`)
      continue
    }
    const missing = [
      typeById.has(source) ? null : `source node "${source}" does not exist`,
      typeById.has(target) ? null : `target node "${target}" does not exist`,
    ].filter((m): m is string => m !== null)
    if (missing.length > 0) {
      dropped.push(`edge "${where}": ${missing.join("; ")} — dropped`)
      continue
    }
    sound.push({ edge: raw, source, target, where })
  }

  // 2. Generate Image's own classifier (legacy `cinematography` / `style` / `subjects` / `in`), one pass.
  const migrated = migrateGenerateImageHandles(
    [...typeById].map(([id, type]) => ({ id, type })),
    sound.map(({ edge, source, target }, i) => ({
      id: `__${i}`,
      source,
      target,
      sourceHandle: str(edge.sourceHandle),
      targetHandle: str(edge.targetHandle),
    })),
  )

  // 3. Handle ids, then 4. an id for an edge without one — the adjustments carry the id as stored.
  const taken = new Set([...seenIds, ...(options.reservedIds ?? [])])
  const connections = new Map<string, string>()
  const out: E[] = []
  const adjustments: EdgeAdjustment[] = []
  sound.forEach(({ edge, source, target, where }, i) => {
    const sourceType = typeById.get(source)!
    const targetType = typeById.get(target)!
    const sentSource = str(edge.sourceHandle)
    const sentTarget = str(edge.targetHandle)
    const migratedTarget = str(migrated[i]!.targetHandle)
    const drafts: Draft[] =
      migratedTarget !== null && migratedTarget !== sentTarget
        ? [{ field: "targetHandle", from: sentTarget, to: migratedTarget, reason: "generate-image" }]
        : []

    const sourceFix = fixSourceHandle(sentSource, sourceType, where)
    const targetFix = fixTargetHandle(migratedTarget, targetType, sourceType, where)
    const given = str(edge.id)
    // The same connection sent again without an id is the same wire, not a
    // second one — kept once. (Two ids for one connection are a client's choice.)
    const key = connectionKey(source, sourceFix.handle, target, targetFix.handle)
    const earlier = connections.get(key)
    if (given === null && earlier !== undefined) {
      dropped.push(`edge "${where}": the same connection as edge "${earlier}", sent again without an id — dropped`)
      return
    }
    drafts.push(...sourceFix.drafts, ...targetFix.drafts)
    if (sourceFix.warning) warnings.push(sourceFix.warning)
    if (targetFix.warning) warnings.push(targetFix.warning)

    const id = given ?? freshId(source, sourceFix.handle, target, targetFix.handle, taken)
    taken.add(id)
    if (earlier === undefined) connections.set(key, id)
    if (given === null) drafts.push({ field: "id", from: null, to: id, reason: "generated" })

    let next: E = edge
    if (sourceFix.handle !== sentSource) next = { ...next, sourceHandle: sourceFix.handle }
    if (targetFix.handle !== sentTarget) next = { ...next, targetHandle: targetFix.handle }
    if (id !== given) next = { ...next, id }
    out.push(next)
    adjustments.push(...drafts.map((draft) => ({ edgeId: id, ...draft })))
  })

  return { edges: out, adjustments, warnings, dropped, errors }
}

/** One line per adjustment, for a tool's reply. */
export function describeEdgeAdjustments(adjustments: ReadonlyArray<EdgeAdjustment>): string[] {
  return adjustments.map((a) => {
    if (a.field === "id") return `edge ${a.edgeId}: had no id — given "${a.to}"`
    const why =
      a.reason === "alias"
        ? "a legacy name for this handle"
        : a.reason === "classified"
          ? "chosen from the other node's type"
          : a.reason === "rendered"
            ? "the pip the node renders for its declared output"
            : "the Generate Image handle migration"
    return `edge ${a.edgeId}: ${a.field} ${a.from === null ? "(none)" : `"${a.from}"`} → "${a.to}" (${why})`
  })
}
