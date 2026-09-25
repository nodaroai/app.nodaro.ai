/**
 * Execution graph utilities — ported from frontend, no React/Zustand dependencies.
 * Pure functions operating on SimpleNode/SimpleEdge arrays.
 */

import { buildChildrenByParent, buildFeedMaps, VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES } from "@nodaro/shared"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "./types.js"

// The per-node legacy-type migration lives in normalize-node-types.ts (single
// source of truth, shared by the orchestrator, sub-workflow handler, app-input
// extraction, and api-token routes — now also incl. loop → list). Re-exported
// here so callers importing it alongside the other engine helpers from this
// module keep a stable import path.
export { migrateLegacyNodeType } from "./normalize-node-types.js"

/**
 * Topological sort via Kahn's algorithm.
 * Returns array of levels where nodes in the same level can execute in parallel.
 *
 * When `preResolvedNodeIds` is provided, edges FROM those nodes are excluded
 * from both in-degree computation and the children map.  This allows nodes
 * whose only dependencies are pre-resolved (e.g. source nodes whose outputs
 * are already available) to be promoted to earlier levels, enabling more
 * parallelism.
 */
export function buildExecutionLevels(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  preResolvedNodeIds?: Set<string>,
): SimpleNode[][] {
  const inDegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  const nodeMap = new Map<string, SimpleNode>()

  for (const node of nodes) {
    nodeMap.set(node.id, node)
    inDegree.set(node.id, 0)
    children.set(node.id, [])
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue
    // Skip edges from pre-resolved nodes — their outputs are already available,
    // so they shouldn't create execution-level dependencies.
    if (preResolvedNodeIds?.has(edge.source)) continue
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    children.get(edge.source)?.push(edge.target)
  }

  // Implicit child → group dependency: a Group's output is computed from its
  // children (computeGroupBuckets), so it must be ordered AFTER all children
  // have executed. Without this, the topological walk could schedule the
  // group on the same level as its children and read stale/undefined output.
  const childrenByGroup = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentId) {
      const list = childrenByGroup.get(n.parentId)
      if (list) list.push(n.id)
      else childrenByGroup.set(n.parentId, [n.id])
    }
  }
  for (const g of nodes) {
    if (g.type !== "group") continue
    const childIds = childrenByGroup.get(g.id)
    if (!childIds) continue
    for (const cid of childIds) {
      inDegree.set(g.id, (inDegree.get(g.id) ?? 0) + 1)
      children.get(cid)?.push(g.id)
    }
  }

  const levels: SimpleNode[][] = []
  let currentLevel = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0)

  while (currentLevel.length > 0) {
    levels.push(currentLevel)
    const nextLevel: SimpleNode[] = []
    const seen = new Set<string>()

    for (const node of currentLevel) {
      for (const childId of children.get(node.id) ?? []) {
        const newDeg = (inDegree.get(childId) ?? 1) - 1
        inDegree.set(childId, newDeg)
        if (newDeg === 0 && !seen.has(childId)) {
          seen.add(childId)
          const childNode = nodeMap.get(childId)
          if (childNode) nextLevel.push(childNode)
        }
      }
    }

    currentLevel = nextLevel
  }

  return levels
}

/**
 * Compute skipped (frozen) node IDs.
 * "Skip" means "freeze" — the node keeps its existing output but does not
 * re-execute.  Downstream nodes still run using the frozen node's saved output.
 * No propagation: only directly skipped nodes are returned.
 */
export function getEffectivelySkippedIds(
  nodes: SimpleNode[],
  _edges: SimpleEdge[],
): Set<string> {
  return new Set(
    nodes.filter((n) => !!n.data.skipped).map((n) => n.id),
  )
}

/**
 * Compute node IDs gated by inactive router routes.
 * A node is "router-gated" if ALL its incoming edges originate from inactive
 * router output handles or from other router-gated nodes (transitive).
 * Must be called after each execution level because router state is dynamic.
 */
export function computeRouterGatedIds(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
): Set<string> {
  // Collect "source:sourceHandle" keys for inactive router output handles
  const inactiveHandles = new Set<string>()

  for (const node of nodes) {
    if (node.type !== "router") continue
    const state = nodeStates[node.id]
    if (!state || state.status !== "completed" || !state.output) continue
    const routeOutputs = state.output.routeOutputs
    if (!routeOutputs) continue

    for (const routeId of Object.keys(routeOutputs)) {
      if (routeOutputs[routeId] === undefined) {
        inactiveHandles.add(`${node.id}:${routeId}`)
      }
    }
  }

  if (inactiveHandles.size === 0) return new Set()

  // Build incoming-edges map
  const incomingEdges = new Map<string, SimpleEdge[]>()
  for (const edge of edges) {
    const list = incomingEdges.get(edge.target) ?? []
    list.push(edge)
    incomingEdges.set(edge.target, list)
  }

  // Fixed-point: a node is gated when ALL its incoming edges come from
  // inactive router handles or from already-gated nodes.
  const gatedIds = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (gatedIds.has(node.id)) continue
      const incoming = incomingEdges.get(node.id)
      if (!incoming || incoming.length === 0) continue

      const allGated = incoming.every((edge) => {
        if (inactiveHandles.has(`${edge.source}:${edge.sourceHandle ?? ""}`)) return true
        return gatedIds.has(edge.source)
      })

      if (allGated) {
        gatedIds.add(node.id)
        changed = true
      }
    }
  }

  return gatedIds
}

// ---------------------------------------------------------------------------
// Source node detection
// ---------------------------------------------------------------------------

/** Node types that are source nodes — they produce output from their data, not from execution */
// Group and Collect are deliberately EXCLUDED from this set: they are non-executable
// aggregators resolved at field-resolution time, not orchestrator-queued jobs. Adding
// them would cause `isSourceNode()` to return true and the orchestrator would try to
// enqueue jobs for them (would throw "Unknown node type" in payload-builder.ts).
const SOURCE_NODE_TYPES = new Set([
  "text-prompt",
  "upload-image",
  "upload-video",
  "upload-audio",
  "youtube-video",
  "reference-audio",
  "list",
  "webhook-trigger",
  "schedule-trigger",
  "telegram-trigger",
  "telegram-account-trigger",
  "sub-workflow-input",
  // suno-voice — configured once via setup modal; emits stored voiceId at
  // workflow runtime without any execution. Without this, the orchestrator
  // tries to enqueue a job and payload-builder throws "Unknown node type".
  "suno-voice",
  // preview — a display/passthrough node. It produces its output from saved
  // `data.previewItems` (see output-extractor.ts `case "preview"`) and routes
  // it downstream (input-resolver.ts `srcType === "preview"`); it never makes
  // an API call. Without this it falls through to executeWorkerNode →
  // buildPayload throws "Unknown node type" and the whole workflow fails on any
  // full server-side run. (Surfaced by node-registry-sync.test.ts hardening.)
  "preview",
  // paint-mask — the hand-painted maskUrl on node data IS the output (see
  // output-extractor.ts `case "paint-mask"`). Painting happens in the editor;
  // at workflow runtime the node only serves its stored value.
  "paint-mask",
])

export function isSourceNode(nodeType: string): boolean {
  return SOURCE_NODE_TYPES.has(nodeType)
}

/** Node types that should be skipped during backend execution */
// Group and Collect: non-executable aggregators resolved at field-resolution time.
// The orchestrator skips them entirely; downstream extractor cases
// (output-extractor.ts) materialize their structured-list output from upstream
// member nodes (Group via parentId membership, Collect via order[] array).
const SKIP_NODE_TYPES = new Set([
  "manual-edit",
  "sub-workflow-output",
  "group",
  "collect",
  // Visual / config-only nodes that are NOT executable, NOT parameter pickers,
  // and produce no DAG output. Without an explicit classification they fall
  // through the orchestrator's executable filter → buildPayload throws
  // "Unknown node type" → the ENTIRE workflow fails on any full server-side run
  // (webhook / schedule / MCP / published-app) or the default Run button. The
  // frontend masks this because it gates on EXECUTABLE_TYPES. The platform's
  // own film template ships a sticky-note (lib/film-template.ts), so film
  // workflows hit this. Guarded by node-registry-sync.test.ts (full nodeTypes
  // map, not just NODE_REGISTRY).
  "sticky-note", // free-form canvas annotation
  "provider", // emits a provider value consumed at field-mapping time, not via DAG execution
  "rss-feed", // legacy/commented-out source; no executable handler — skip rather than crash
])

export function isSkipNode(nodeType: string): boolean {
  return SKIP_NODE_TYPES.has(nodeType)
}

/** Node types representing user-uploaded private content */
const UPLOAD_NODE_TYPES = new Set([
  "upload-image",
  "upload-video",
  "upload-audio",
])

/**
 * Compute all node IDs that are downstream descendants of upload-* nodes.
 * These nodes use private uploaded content as input and should be force_private.
 * Uses BFS forward from upload nodes through edges.
 */
export function getUploadDescendantIds(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
): Set<string> {
  const uploadNodeIds = new Set(
    nodes.filter((n) => UPLOAD_NODE_TYPES.has(n.type)).map((n) => n.id),
  )
  if (uploadNodeIds.size === 0) return new Set()

  // Build adjacency list (source → targets)
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    const list = children.get(edge.source) ?? []
    list.push(edge.target)
    children.set(edge.source, list)
  }

  // BFS forward from upload nodes
  const descendants = new Set<string>()
  const queue = [...uploadNodeIds]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    for (const childId of children.get(nodeId) ?? []) {
      if (!descendants.has(childId)) {
        descendants.add(childId)
        queue.push(childId)
      }
    }
  }

  return descendants
}

// ---------------------------------------------------------------------------
// Trigger run scope
// ---------------------------------------------------------------------------

/** The node type each trigger lane starts from. Manual / API / app runs have none: they run what they are asked. */
const TRIGGER_NODE_TYPE_BY_LANE: Readonly<Record<string, string>> = {
  schedule: "schedule-trigger",
  webhook: "webhook-trigger",
  telegram: "telegram-trigger",
  telegram_account: "telegram-account-trigger",
}

/**
 * What a TRIGGERED run executes. A trigger wired to something runs only the
 * branch behind it — its descendants, plus every node those descendants need
 * (their ancestors), so a branch that also reads from a node off to the side
 * still gets a fresh result rather than a stale one. A trigger wired to
 * nothing runs the whole workflow, as before. This is what lets one workflow
 * carry several triggers, each starting its own branch.
 *
 * The trigger node is the one the trigger row names (`triggerNodeId`, from
 * the row's `config.nodeId`); a row that names none (hand-made through the
 * API, or a lane whose rows carry no node id) falls back to the ONLY node of
 * that lane's type — with two such nodes there is no honest answer, so the
 * whole workflow runs.
 *
 * "Wired" means every way one node feeds another, not only a drawn edge: a
 * node inside a Group feeds the group (`parentId` — the engine models that
 * dependency without an edge, see `buildExecutionLevels`), and a field
 * mapping feeds its node by `sourceNodeId` even after the edge it was made
 * from is gone. An edge whose end is no longer on the graph (a delta that
 * deleted a node leaves its edges behind) feeds nothing and is ignored —
 * otherwise it would make an unwired trigger look wired and the run would
 * execute nothing at all.
 *
 * Returns `null` for "the whole workflow"; otherwise the node ids to execute
 * (the trigger node included).
 */
export function triggerRunScope(
  nodes: ReadonlyArray<{ id: string; type: string; parentId?: string | null; data?: unknown }>,
  edges: ReadonlyArray<{ source: string; target: string }>,
  trigger: { readonly triggerType: string; readonly triggerNodeId?: string | null },
): Set<string> | null {
  const nodeType = TRIGGER_NODE_TYPE_BY_LANE[trigger.triggerType]
  if (!nodeType) return null

  let triggerNode = trigger.triggerNodeId
    ? nodes.find((n) => n.id === trigger.triggerNodeId && n.type === nodeType)
    : undefined
  if (!triggerNode) {
    const candidates = nodes.filter((n) => n.type === nodeType)
    if (candidates.length !== 1) return null
    triggerNode = candidates[0]
  }

  // The SAME feed definition the editor's "is this trigger wired?" reads
  // (`@nodaro/shared` trigger-feeds): live edges, Group membership, field
  // mappings — so the card and the server never disagree on branch vs whole.
  const { children, parents } = buildFeedMaps(nodes, edges)
  if ((children.get(triggerNode.id) ?? []).length === 0) return null

  const scope = new Set<string>([triggerNode.id])
  const walk = (start: string, next: ReadonlyMap<string, ReadonlyArray<string>>) => {
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const id of next.get(current) ?? []) {
        if (!scope.has(id)) {
          scope.add(id)
          queue.push(id)
        }
      }
    }
  }
  walk(triggerNode.id, children)
  for (const id of [...scope]) walk(id, parents)
  return scope
}

// ---------------------------------------------------------------------------
// Media type sets — used for routing inputs
// ---------------------------------------------------------------------------

export const IMAGE_SOURCE_TYPES = new Set([
  "generate-image",
  "reference-board",
  "upload-image",
  "edit-image",
  "image-to-image",
  "modify-image",
  "upscale-image",
  "remove-background",
  "extract-frame",
  "character",
  "face",
  "object",
  "creature",
  "location",
  "scene",
])

/**
 * Re-exported from `@nodaro/shared` so the frontend handle validator
 * (frontend/src/lib/generate-video-handles.ts) and this backend orchestrator
 * dispatch share a single source of truth. The legacy `_SOURCE_TYPES` names
 * are kept for backwards compatibility with the 4 backend call sites and
 * the test suite that import these names directly.
 *
 * See packages/shared/src/producer-types.ts for the canonical lists.
 */
export const VIDEO_SOURCE_TYPES = VIDEO_PRODUCER_TYPES
export const AUDIO_SOURCE_TYPES = AUDIO_PRODUCER_TYPES

export const TEXT_SOURCE_TYPES = new Set([
  "text-prompt",
  "transcribe",
  "suno-lyrics",
  "suno-style-boost",
  "image-to-text",
  "ai-writer",
  "llm-chat",
  "combine-text",
  "split-text",
  "preview",
  "generate-script",
  "list",
])
