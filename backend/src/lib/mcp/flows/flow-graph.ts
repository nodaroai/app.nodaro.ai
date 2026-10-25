import { createHash } from "node:crypto"
import { NODE_HANDLES } from "../generated/node-handles.js"
import type { FlowMediaKind, FlowNodeInput, FlowNodeSpec } from "./node-mappers.js"

/**
 * Pure graph edits for a conversation flow: where a new node goes, and which
 * edges and input nodes a call's media inputs become. No I/O here.
 */

type GraphNode = Record<string, unknown> & { id: string; type?: string; data?: Record<string, unknown>; position?: { x: number; y: number } }
type GraphEdge = Record<string, unknown>

const COLUMN_WIDTH = 440
const ROW_HEIGHT = 420
const ORIGIN = { x: 80, y: 80 }

const UPLOAD_TYPE: Record<FlowMediaKind, string> = {
  image: "upload-image",
  video: "upload-video",
  audio: "upload-audio",
}

/**
 * A conversation node's id names its conversation: `mcp-<workflowId>-<suffix>`.
 *
 * The job is tied to its node by `jobs.node_id` alone, never by `jobs.workflow_id`:
 * that column cascades, so a job filed in the conversation workflow would be
 * deleted with it (and every conversation of a month with its hub), taking the
 * results out of the library. The completion hook finds the conversation from
 * the node id instead.
 */
export function flowNodeId(workflowId: string, suffix: string): string {
  return `mcp-${workflowId}-${suffix}`
}

const FLOW_NODE_ID = /^mcp-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[A-Za-z0-9]+$/i

/** The conversation a node id of {@link flowNodeId} belongs to, or null. */
export function workflowIdOfFlowNode(nodeId: string | null | undefined): string | null {
  return (nodeId && FLOW_NODE_ID.exec(nodeId)?.[1]?.toLowerCase()) || null
}

const UUID_PREFIX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/** The job a Nodaro media URL was made by (`images/<jobId>.png`), or null. */
export function jobIdOfMediaUrl(url: string): string | null {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? ""
    return UUID_PREFIX.exec(last)?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

function asNode(value: Record<string, unknown>): GraphNode | null {
  return typeof value.id === "string" ? (value as GraphNode) : null
}

/** Does this node hold the media at `url` (as a result, its current job, or an upload)? */
function nodeHolds(node: GraphNode, url: string, jobId: string | null): boolean {
  const data = node.data ?? {}
  if (data.url === url || data.r2Url === url) return true
  if (jobId && data.currentJobId === jobId) return true
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown>>) : []
  return results.some((r) => r.url === url || (jobId !== null && r.jobId === jobId))
}

/** The output handle a node of `type` sends its media on. */
export function outputHandleOf(type: string | undefined): string {
  return (type && NODE_HANDLES[type]?.outputs[0]) || "out"
}

function inputNodeId(url: string): string {
  return `mcp-in-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`
}

function edgeId(source: string, sourceHandle: string, target: string, targetHandle: string): string {
  return `e-${source}-${sourceHandle}-${target}-${targetHandle}`
}

/** The next free column right of every node in the flow. */
function nextColumnX(nodes: readonly GraphNode[]): number {
  const xs = nodes.map((n) => n.position?.x).filter((x): x is number => typeof x === "number")
  return xs.length === 0 ? ORIGIN.x + COLUMN_WIDTH : Math.max(...xs) + COLUMN_WIDTH
}

export interface PlacedFlowNode {
  readonly upsertNodes: GraphNode[]
  readonly upsertEdges: GraphEdge[]
}

/**
 * The new node, any upload nodes its inputs need, and the edges between them.
 * An input the flow already holds (an earlier node's result, an upload node
 * of the same URL) is wired from there; any other input becomes an upload
 * node, placed in the column left of the new node.
 */
export function placeFlowNode(
  existing: ReadonlyArray<Record<string, unknown>>,
  nodeId: string,
  spec: FlowNodeSpec,
  data: Record<string, unknown>,
): PlacedFlowNode {
  const nodes = existing.map(asNode).filter((n): n is GraphNode => n !== null)
  const x = nextColumnX(nodes)
  const upsertNodes: GraphNode[] = []
  const upsertEdges: GraphEdge[] = []
  let inputRow = 0
  const seen = new Set<string>()
  for (const input of spec.inputs) {
    const key = `${input.url}\u0000${input.targetHandle}`
    if (seen.has(key)) continue
    seen.add(key)
    const source = sourceFor(nodes, upsertNodes, input, { x: x - COLUMN_WIDTH, y: ORIGIN.y + inputRow * ROW_HEIGHT })
    if (source.created) {
      upsertNodes.push(source.node)
      inputRow += 1
    }
    const sourceHandle = outputHandleOf(source.node.type)
    upsertEdges.push({
      id: edgeId(source.node.id, sourceHandle, nodeId, input.targetHandle),
      source: source.node.id,
      sourceHandle,
      target: nodeId,
      targetHandle: input.targetHandle,
    })
  }
  upsertNodes.push({ id: nodeId, type: spec.type, position: { x, y: ORIGIN.y }, data })
  return { upsertNodes, upsertEdges }
}

function sourceFor(
  nodes: readonly GraphNode[],
  pending: readonly GraphNode[],
  input: FlowNodeInput,
  position: { x: number; y: number },
): { node: GraphNode; created: boolean } {
  const jobId = jobIdOfMediaUrl(input.url)
  const held = [...pending, ...nodes].find((n) => nodeHolds(n, input.url, jobId))
  if (held) return { node: held, created: false }
  const type = UPLOAD_TYPE[input.kind]
  // The URL's id may already be taken by a node the user changed since (another
  // image in it): never overwrite it, an upsert replaces a node whole.
  const taken = new Set([...pending, ...nodes].map((n) => n.id))
  const base = inputNodeId(input.url)
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  return {
    created: true,
    node: {
      id,
      type,
      position,
      data: {
        label: input.kind === "image" ? "Image" : input.kind === "video" ? "Video" : "Audio",
        url: input.url,
        r2Url: input.url,
        ...(input.kind === "image" ? { thumbnailUrl: input.url } : {}),
        ...(jobId ? { assetId: jobId } : {}),
      },
    },
  }
}
