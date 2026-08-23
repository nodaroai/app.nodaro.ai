/**
 * `edit_workflow` — the copilot's ONLY write path.
 *
 * Applies an id-keyed delta through the `apply_workflow_delta` RPC
 * (migration 219) so the model never re-sends the whole graph, and runs the
 * same write pipeline the MCP tool runs plus the checks that tool lacks:
 * denied node types and locked URL fields (egress), sub-workflow route
 * validation, edge/handle validation, id rules and size caps.
 *
 * On a version conflict it re-reads and re-applies ONCE — the delta is
 * id-keyed, so rebasing is a re-merge, not a guess. A second conflict is
 * returned to the model, which must re-read with get_graph.
 */
import {
  describeNodeAdjustments,
  EXECUTION_DATA_KEYS,
  normalizeNodeModelParams,
  stripTransientRuntimeData,
  validateSubWorkflowRoutes,
  type GenericNode,
} from "@nodaro/shared"
import { supabase } from "../../../lib/supabase.js"
import { migrateGenerateImageHandles } from "../../../lib/generate-image-handle-migration.js"
import { GRAPH_CAPS, LAYOUT, NODE_ID_RE } from "../constants.js"
import { changedLockedUrlFields, isDeniedNodeType } from "./deny-lists.js"
import { knownNodeTypes, suggestNodeTypes, validateWorkflowEdges, type EdgeLike } from "./edge-validation.js"
import type { CopilotToolContext } from "./types.js"

export interface UpsertNodeInput {
  id: string
  type: string
  position?: { x: number; y: number }
  parentId?: string
  data?: Record<string, unknown>
}

export interface PatchNodeInput {
  id: string
  data?: Record<string, unknown>
  position?: { x: number; y: number }
}

export interface EditWorkflowArgs {
  upsertNodes?: UpsertNodeInput[]
  patchNodes?: PatchNodeInput[]
  deleteNodeIds?: string[]
  upsertEdges?: EdgeLike[]
  deleteEdgeIds?: string[]
  /**
   * Rename only. `settings` is deliberately NOT writable: it carries the
   * workflow's sharing flag (`studio.shared` makes the graph readable by id
   * without auth) and the prompt templates every node's payload is built
   * from — neither is something an assistant should be able to set.
   */
  set?: { name?: string }
  note: string
}

export interface EditWorkflowResult {
  version: number
  updatedAt: string
  addedNodeIds: string[]
  updatedNodeIds: string[]
  removedNodeIds: string[]
  addedNodeTypes: string[]
  nodeCount: number
  edgeCount: number
  adjustments: string[]
  warnings: string[]
}

/** A rejected edit. The message is written for the model, not for a log. */
export class EditRejected extends Error {}

interface StoredGraph {
  nodes: GenericNode[]
  edges: EdgeLike[]
  version: number
}

async function loadGraph(ctx: CopilotToolContext): Promise<StoredGraph> {
  const { data, error } = await supabase
    .from("workflows")
    .select("nodes, edges, version")
    .eq("id", ctx.workflowId)
    .eq("user_id", ctx.userId)
    .maybeSingle()
  if (error) throw new Error(`edit_workflow: ${error.message}`)
  if (!data) throw new EditRejected("This workflow no longer exists or is not yours.")
  const row = data as { nodes: unknown; edges: unknown; version: number }
  return {
    nodes: Array.isArray(row.nodes) ? (row.nodes as GenericNode[]) : [],
    edges: Array.isArray(row.edges) ? (row.edges as EdgeLike[]) : [],
    version: row.version,
  }
}

function edgeId(edge: EdgeLike): string {
  if (typeof edge.id === "string" && edge.id.length > 0) return edge.id
  const parts = [edge.source, edge.sourceHandle ?? "out", edge.target, edge.targetHandle ?? "in"]
  return `e-${parts.join("-")}`
}

/** Longest-path depth per node, so new nodes land in a readable left-to-right layout. */
function layoutPositions(nodes: GenericNode[], edges: EdgeLike[]): Map<string, { x: number; y: number }> {
  const incoming = new Map<string, string[]>()
  for (const e of edges) {
    if (typeof e.source !== "string" || typeof e.target !== "string") continue
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source])
  }
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0 // cycle guard
    visiting.add(id)
    const parents = incoming.get(id) ?? []
    const value = parents.length === 0 ? 0 : Math.max(...parents.map(depthOf)) + 1
    visiting.delete(id)
    depth.set(id, value)
    return value
  }
  const rowsPerColumn = new Map<number, number>()
  const out = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const id = node.id
    const column = depthOf(id)
    const row = rowsPerColumn.get(column) ?? 0
    rowsPerColumn.set(column, row + 1)
    out.set(id, { x: column * LAYOUT.columnGap, y: row * LAYOUT.rowGap })
  }
  return out
}

/** Parents before children: the delta RPC appends new nodes in the order it receives them. */
function orderParentFirst(nodes: GenericNode[]): GenericNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const out: GenericNode[] = []
  const visit = (node: GenericNode): void => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    const parentId = (node as { parentId?: unknown }).parentId
    if (typeof parentId === "string") {
      const parent = byId.get(parentId)
      if (parent) visit(parent)
    }
    out.push(node)
  }
  for (const node of nodes) visit(node)
  return out
}

interface Prepared {
  upsertNodes: GenericNode[]
  deleteNodeIds: string[]
  upsertEdges: EdgeLike[]
  deleteEdgeIds: string[]
  addedNodeIds: string[]
  updatedNodeIds: string[]
  addedNodeTypes: string[]
  fullNodes: GenericNode[]
  fullEdges: EdgeLike[]
  adjustments: string[]
  warnings: string[]
}

/**
 * Build (and check) the prospective graph. Runs against a FRESH read every
 * time, so a rebase after a version conflict re-merges patches onto the
 * current node rather than re-sending a stale copy.
 */
function prepare(args: EditWorkflowArgs, stored: StoredGraph): Prepared {
  const existingById = new Map(stored.nodes.map((n) => [n.id, n]))
  const deleteNodeIds = [...new Set(args.deleteNodeIds ?? [])]
  const deleteSet = new Set(deleteNodeIds)
  const upserts: GenericNode[] = []
  const addedNodeIds: string[] = []
  const updatedNodeIds: string[] = []
  const addedNodeTypes = new Set<string>()

  for (const input of args.upsertNodes ?? []) {
    if (!NODE_ID_RE.test(input.id)) {
      throw new EditRejected(`Node id "${input.id}" is not allowed. Use lowercase letters, digits, "-" or "_" (max 64 chars).`)
    }
    if (/_iter_\d+$/.test(input.id)) {
      throw new EditRejected(`Node id "${input.id}" is reserved for list-expansion clones. Pick another id.`)
    }
    if (isDeniedNodeType(input.type)) {
      throw new EditRejected(
        `I can't add a "${input.type}" node — nodes that send data out of Nodaro (webhooks, social publishing) have to be added by you on the canvas.`,
      )
    }
    const existing = existingById.get(input.id)
    const data = { ...(input.data ?? {}) }
    const locked = changedLockedUrlFields(existing?.data as Record<string, unknown> | undefined, data)
    if (locked.length > 0) {
      throw new EditRejected(
        `I can't set ${locked.join(", ")} on "${input.id}". Media reaches a node through an edge, a saved character/location, or the user's upload — not a URL I type.`,
      )
    }
    const node: GenericNode = {
      id: input.id,
      type: input.type,
      ...(input.position ? { position: input.position } : existing?.position ? { position: existing.position } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      data,
    } as GenericNode
    upserts.push(node)
    if (existing) updatedNodeIds.push(input.id)
    else {
      addedNodeIds.push(input.id)
      addedNodeTypes.add(input.type)
    }
  }

  for (const patch of args.patchNodes ?? []) {
    const existing = existingById.get(patch.id)
    if (!existing) throw new EditRejected(`Can't patch "${patch.id}" — no node with that id. Read the graph with get_graph.`)
    // Same gate as the upsert path: an existing outbound node must not be
    // RE-POINTED either (a patched chatId publishes the user's media to
    // someone else's channel).
    if (isDeniedNodeType(existing.type)) {
      throw new EditRejected(
        `I can't change the "${existing.type}" node "${patch.id}" — nodes that send data out of Nodaro are yours to configure.`,
      )
    }
    if (deleteSet.has(patch.id)) throw new EditRejected(`"${patch.id}" is both patched and deleted in the same call.`)
    if (upserts.some((n) => n.id === patch.id)) throw new EditRejected(`"${patch.id}" appears in both upsertNodes and patchNodes.`)
    const merged = { ...((existing.data as Record<string, unknown> | undefined) ?? {}), ...(patch.data ?? {}) }
    const locked = changedLockedUrlFields(existing.data as Record<string, unknown> | undefined, merged)
    if (locked.length > 0) {
      throw new EditRejected(`I can't change ${locked.join(", ")} on "${patch.id}".`)
    }
    upserts.push({
      ...existing,
      ...(patch.position ? { position: patch.position } : {}),
      data: merged,
    } as GenericNode)
    updatedNodeIds.push(patch.id)
  }

  const upsertIds = new Set(upserts.map((n) => n.id))
  if (upsertIds.size !== upserts.length) throw new EditRejected("Duplicate node ids in this call.")
  for (const id of deleteNodeIds) {
    if (upsertIds.has(id)) throw new EditRejected(`"${id}" is both written and deleted in the same call.`)
  }

  // The prospective full graph.
  const survivingNodes = stored.nodes.filter((n) => !deleteSet.has(n.id) && !upsertIds.has(n.id))
  const fullNodes = [...survivingNodes, ...upserts]

  const explicitEdgeDeletes = new Set(args.deleteEdgeIds ?? [])
  const upsertEdges = (args.upsertEdges ?? []).map((e) => ({ ...e, id: edgeId(e) }))
  const upsertEdgeIds = new Set(upsertEdges.map((e) => e.id as string))
  // Edges incident to a deleted node go with it — the RPC would otherwise
  // leave the graph with dangling endpoints the editor cannot render.
  const orphanedEdgeIds = stored.edges
    .filter((e) => deleteSet.has(String(e.source)) || deleteSet.has(String(e.target)))
    .map((e) => edgeId(e))
  const deleteEdgeIds = [...new Set([...explicitEdgeDeletes, ...orphanedEdgeIds])].filter((id) => !upsertEdgeIds.has(id))
  const deletedEdgeSet = new Set(deleteEdgeIds)
  const fullEdges = [
    ...stored.edges.filter((e) => !deletedEdgeSet.has(edgeId(e)) && !upsertEdgeIds.has(edgeId(e))),
    ...upsertEdges,
  ]

  if (fullNodes.length > GRAPH_CAPS.maxNodes) {
    throw new EditRejected(`That would leave ${fullNodes.length} nodes; the limit is ${GRAPH_CAPS.maxNodes}. Split the work across workflows.`)
  }
  if (fullEdges.length > GRAPH_CAPS.maxEdges) {
    throw new EditRejected(`That would leave ${fullEdges.length} edges; the limit is ${GRAPH_CAPS.maxEdges}.`)
  }

  for (const node of fullNodes) {
    if (!node.type || typeof node.type !== "string") throw new EditRejected(`Node "${node.id}" has no type.`)
  }
  const known = knownTypeSet()
  const trulyUnknown = [...new Set(upserts.map((n) => n.type).filter((t) => !known.has(t)))]
  if (trulyUnknown.length > 0) {
    const hints = trulyUnknown.map((t) => {
      const suggestions = suggestNodeTypes(t)
      return suggestions.length > 0 ? `"${t}" (did you mean ${suggestions.join(", ")}?)` : `"${t}"`
    })
    throw new EditRejected(`Unknown node type(s): ${hints.join("; ")}. Check the catalog in your reference.`)
  }

  const subWorkflow = validateSubWorkflowRoutes(fullNodes)
  if (!subWorkflow.ok) {
    const detail = subWorkflow.errors.map((e) => `${e.code} (route ${e.routeId})`).join("; ")
    throw new EditRejected(`Sub-workflow wiring is invalid: ${detail}`)
  }

  const edgeCheck = validateWorkflowEdges(fullNodes, fullEdges)
  if (!edgeCheck.ok) throw new EditRejected(`Edge problems: ${edgeCheck.errors.join("; ")}`)

  // Same write pipeline as update_workflow_json, on the upserted nodes only —
  // plus the generated-output keys, which `stripTransientRuntimeData` leaves
  // alone. A model that could write `generatedImageUrl` could fake a finished
  // node and feed a downstream one whatever it liked.
  const stripped = stripTransientRuntimeData(upserts).map((node) => {
    const data = node.data as Record<string, unknown> | undefined
    if (!data) return node
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (!EXECUTION_DATA_KEYS.has(key)) cleaned[key] = value
    }
    return { ...node, data: cleaned }
  })
  const normalized = normalizeNodeModelParams(stripped)
  const positioned = applyLayout(normalized.nodes, fullNodes, fullEdges)
  const orderedUpserts = orderParentFirst(positioned)

  // Handle migration can rewrite EXISTING edges too; anything it changed has
  // to travel in the delta or the stored copy stays stale. Every edge carries
  // an id by construction (`edgeId` fills one in), which is what the migration
  // helper's element type requires.
  const identified = fullEdges.map((e) => ({ ...e, id: edgeId(e) })) as Array<EdgeLike & { id: string; source: string; target: string }>
  const migratedEdges: EdgeLike[] = migrateGenerateImageHandles(fullNodes, identified)
  const byIdBefore = new Map(fullEdges.map((e) => [edgeId(e), e]))
  const finalUpsertEdges: EdgeLike[] = []
  for (const edge of migratedEdges) {
    const id = edgeId(edge)
    const before = byIdBefore.get(id)
    const changed = !before || JSON.stringify(before) !== JSON.stringify(edge)
    if (changed || upsertEdgeIds.has(id)) finalUpsertEdges.push({ ...edge, id })
  }

  const jsonBytes = Buffer.byteLength(JSON.stringify({ nodes: fullNodes, edges: migratedEdges }), "utf8")
  if (jsonBytes > GRAPH_CAPS.maxJsonBytes) {
    throw new EditRejected(`The workflow would be ${Math.round(jsonBytes / 1024)} KB; the limit is ${Math.round(GRAPH_CAPS.maxJsonBytes / 1024)} KB.`)
  }

  return {
    upsertNodes: orderedUpserts,
    deleteNodeIds,
    upsertEdges: finalUpsertEdges,
    deleteEdgeIds,
    addedNodeIds,
    updatedNodeIds,
    addedNodeTypes: [...addedNodeTypes],
    fullNodes,
    fullEdges: migratedEdges,
    adjustments: describeNodeAdjustments(normalized.adjustments),
    warnings: edgeCheck.warnings,
  }
}

let knownTypes: Set<string> | null = null
/** The generated catalog, as a set (built once per process). */
function knownTypeSet(): Set<string> {
  if (!knownTypes) knownTypes = new Set(knownNodeTypes())
  return knownTypes
}

/** Give every node without a position one, laid out by graph depth. */
function applyLayout(upserts: GenericNode[], fullNodes: GenericNode[], fullEdges: EdgeLike[]): GenericNode[] {
  const needsLayout = upserts.some((n) => !n.position || typeof n.position.x !== "number")
  if (!needsLayout) return upserts
  const positions = layoutPositions(fullNodes, fullEdges)
  return upserts.map((n) =>
    n.position && typeof n.position.x === "number" ? n : { ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } },
  )
}

export async function runEditWorkflow(ctx: CopilotToolContext, args: EditWorkflowArgs): Promise<EditWorkflowResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const stored = await loadGraph(ctx)
    const prepared = prepare(args, stored)

    const { data, error } = await supabase.rpc("apply_workflow_delta", {
      p_workflow_id: ctx.workflowId,
      p_base_version: stored.version,
      p_upsert_nodes: prepared.upsertNodes,
      p_delete_node_ids: prepared.deleteNodeIds,
      p_upsert_edges: prepared.upsertEdges,
      p_delete_edge_ids: prepared.deleteEdgeIds,
      // Rename only — never `settings` (see EditWorkflowArgs).
      p_set: args.set?.name ? { name: args.set.name } : null,
      p_user_id: ctx.userId,
    })
    if (error) throw new Error(`edit_workflow: ${error.message}`)
    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok: boolean; version: number | null; updated_at: string | null }
      | null
    if (row?.ok && row.version !== null && row.updated_at !== null) {
      const result: EditWorkflowResult = {
        version: row.version,
        updatedAt: row.updated_at,
        addedNodeIds: prepared.addedNodeIds,
        updatedNodeIds: prepared.updatedNodeIds,
        removedNodeIds: prepared.deleteNodeIds,
        addedNodeTypes: prepared.addedNodeTypes,
        nodeCount: prepared.fullNodes.length,
        edgeCount: prepared.fullEdges.length,
        adjustments: prepared.adjustments,
        warnings: prepared.warnings,
      }
      ctx.emit({
        type: "workflow_updated",
        data: {
          workflowId: ctx.workflowId,
          version: result.version,
          updatedAt: result.updatedAt,
          note: args.note,
          addedNodeIds: result.addedNodeIds,
          updatedNodeIds: result.updatedNodeIds,
          removedNodeIds: result.removedNodeIds,
          addedNodeTypes: result.addedNodeTypes,
          nodeCount: result.nodeCount,
          edgeCount: result.edgeCount,
          adjustments: result.adjustments,
        },
      })
      return result
    }
    // ok=false with a version means someone else wrote first: re-read and
    // re-merge once (the delta is id-keyed, so this is safe), then give up.
  }
  throw new EditRejected("The workflow changed while I was editing. Read it again with get_graph and re-apply your change.")
}
