/**
 * The preview stop rule (Track A, decided 2026-10-04): a run stops at a
 * Preview render, and nothing downstream of it runs until Render final.
 *
 * It starts at a render node (`PREVIEW_RENDER_NODE_TYPES`) in either of two
 * cases:
 *   - the render EXECUTES in this run and its effective quality, after the
 *     run's input overrides (`withRunOverrides`), is `proxy`;
 *   - the render sits OUTSIDE the run and an item its saved output would hand
 *     a consumer is a stamped Preview — decided per wire, exactly as the input
 *     resolvers read it: an `each` wire reads the latest batch, any other wire
 *     the selected result (`SavedRenderStampReader`).
 *
 * Everything forward of a start — through every way one node feeds another
 * (`buildFeedMaps`: edges, teleports, Group membership, field mappings) — is
 * GATED: never executed, never counted, never billed. A forward closure, not
 * router gating, so a Combine Videos fed by the render AND an intro upload
 * stops too. The invariant: no node ever consumes a preview. The render's own
 * run stays allowed — a start render is gated only when it is itself
 * downstream of another preview.
 *
 * One rule for both engines, the editor's estimates and its chip, and SDK users.
 */
import { buildFeedMaps } from "./trigger-feeds.js"
import { defaultEdgeOutputMode } from "./producer-types.js"
import { mergeNodeInputOverrides } from "./presentation-utils.js"
import { RENDER_NODE_TYPE_IDS } from "./render-nodes.js"

/** Render nodes a run can stop at: every render in the registry (SV18). */
export const PREVIEW_RENDER_NODE_TYPES: ReadonlySet<string> = new Set(RENDER_NODE_TYPE_IDS)

/**
 * Stable refusal code: a run with nobody to review it (a trigger, an API or
 * MCP call, a present link, an app run) holds a Preview render. Set the
 * render to Final, or run with a Final override on it.
 */
export const PREVIEW_REVIEW_REQUIRED = "preview_review_required"

/**
 * Stable refusal code: a sub-workflow or a component holds a Preview render.
 * A nested graph has no Render final path, so this refusal is permanent.
 */
export const PREVIEW_RENDER_NESTED = "preview_render_nested"

/** A node as the stop rule reads it (either engine's graph, or a saved one). */
export interface PreviewGateNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
  readonly parentId?: string | null
}

/** A wire as the stop rule reads it. `data.outputMode` is the wire's mode. */
export interface PreviewGateEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly data?: unknown
}

/** What a saved render result says about itself: `"proxy"` is a Preview. */
export interface SavedRenderQualityStamp {
  readonly quality?: string
}

/**
 * How the rule reads a saved render: the result a scalar wire receives
 * (`output`) and the rows an `each` wire iterates (`batch`, the LATEST batch
 * only — `undefined` when the render has none, and the wire then reads the one
 * result). The saved-output reader both engines use plugs in here.
 */
export interface SavedRenderStampReader {
  output(data: Readonly<Record<string, unknown>>): SavedRenderQualityStamp | undefined
  batch(data: Readonly<Record<string, unknown>>): ReadonlyArray<SavedRenderQualityStamp | null> | undefined
}

/** A reader that sees no stamps: every saved render reads as unstamped. */
export const NO_SAVED_RENDER_STAMPS: SavedRenderStampReader = {
  output: () => undefined,
  batch: () => undefined,
}

/**
 * The production reader. No render result carries a `quality` stamp until the
 * results themselves are stamped, so today it reads none and the saved-preview
 * half of the rule is inert; the stamped-result reader replaces it here, the
 * one place every caller takes it from.
 */
export const SAVED_RENDER_STAMPS: SavedRenderStampReader = NO_SAVED_RENDER_STAMPS

/** One run's view: which nodes execute, and how saved renders are read. */
export interface PreviewGateRun {
  /** Does this node execute in this run? Default: every node that is not frozen (`data.skipped`). */
  readonly executes?: (nodeId: string) => boolean
  /** Default: `SAVED_RENDER_STAMPS`. */
  readonly savedRenders?: SavedRenderStampReader
}

export interface PreviewStops {
  /** Render nodes that execute in this run at Preview quality. */
  readonly previewRenderIds: readonly string[]
  /** Render nodes outside the run whose saved output hands a Preview on. */
  readonly savedPreviewRenderIds: readonly string[]
  /** Every node that would consume a preview: never executed in this run. */
  readonly gatedNodeIds: ReadonlySet<string>
}

type Data = Readonly<Record<string, unknown>>

const dataOf = (n: PreviewGateNode): Data =>
  (n.data && typeof n.data === "object" ? n.data : {}) as Data

const isPreviewStamp = (stamp: SavedRenderQualityStamp | null | undefined): boolean => stamp?.quality === "proxy"

/** A render node set to Preview: its quality (after any run overrides) is `proxy`. */
export function rendersAsPreview(node: PreviewGateNode): boolean {
  return PREVIEW_RENDER_NODE_TYPES.has(node.type ?? "") && dataOf(node).quality === "proxy"
}

const TELEPORT_TYPES: ReadonlySet<string> = new Set(["teleport-send", "teleport-receive"])
const isTeleport = (n: PreviewGateNode | undefined): boolean => TELEPORT_TYPES.has(n?.type ?? "")

const outputModeOf = (edge: PreviewGateEdge): string | undefined => {
  const mode = edge.data && typeof edge.data === "object" ? (edge.data as { outputMode?: unknown }).outputMode : undefined
  return typeof mode === "string" ? mode : undefined
}

/**
 * Does a consumer's wire read the render's latest batch, as the resolvers
 * decide it? The consumer-side wire's own mode, else the default for the real
 * source (the render) on the render-side handle. Through a teleport pair the
 * consumer's wire is the one leaving the last teleport, and the render-side
 * handle is the one on the render → teleport wire.
 */
function readsEach(render: PreviewGateNode, consumerEdge: PreviewGateEdge, renderHandle: string | null | undefined): boolean {
  return (outputModeOf(consumerEdge) ?? defaultEdgeOutputMode(render.type, renderHandle)) === "each"
}

/**
 * The consumers a saved render hands a Preview to (empty when it hands none).
 * A teleport pair is transparent, exactly as the input resolvers walk it: the
 * nodes reached through it are decided per consumer wire, so a teleport fanning
 * out to an `each` and a scalar consumer stops only the one reading a Preview.
 */
function savedPreviewConsumers(
  render: PreviewGateNode,
  children: ReadonlyMap<string, readonly string[]>,
  nodeById: ReadonlyMap<string, PreviewGateNode>,
  edges: readonly PreviewGateEdge[],
  reader: SavedRenderStampReader,
): string[] {
  const data = dataOf(render)
  const scalarIsPreview = isPreviewStamp(reader.output(data))
  const batch = reader.batch(data)
  const eachIsPreview = batch ? batch.some(isPreviewStamp) : scalarIsPreview
  const out = new Set<string>()
  const visited = new Set<string>([render.id])
  // (node a Preview may reach, the render-side handle it travels on)
  const walk = (from: string, renderHandle: string | null | undefined, isRender: boolean): void => {
    const wires = edges.filter((e) => e.source === from)
    for (const child of children.get(from) ?? []) {
      const wiresToChild = wires.filter((e) => e.target === child)
      if (isTeleport(nodeById.get(child))) {
        if (visited.has(child)) continue
        visited.add(child)
        // Leaving the render, the wire into the teleport names the handle;
        // past it the handle is the one already carried.
        if (isRender && wiresToChild.length > 0) for (const w of wiresToChild) walk(child, w.sourceHandle, false)
        else walk(child, renderHandle, false)
        continue
      }
      // A child fed with no wire (Group membership, a field mapping) reads the
      // render's one result, as a scalar wire does.
      const preview =
        wiresToChild.length === 0
          ? scalarIsPreview
          : wiresToChild.some((e) =>
              readsEach(render, e, isRender ? e.sourceHandle : renderHandle) ? eachIsPreview : scalarIsPreview,
            )
      if (preview) out.add(child)
    }
  }
  walk(render.id, undefined, true)
  return [...out]
}

/** The stop rule: where this run stops, and everything it does not run. */
export function previewStops(
  nodes: readonly PreviewGateNode[],
  edges: readonly PreviewGateEdge[],
  run: PreviewGateRun = {},
): PreviewStops {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const executes =
    run.executes ?? ((id: string) => { const n = nodeById.get(id); return !!n && dataOf(n).skipped !== true })
  const reader = run.savedRenders ?? SAVED_RENDER_STAMPS
  const { children } = buildFeedMaps(nodes, edges)
  const previewRenderIds: string[] = []
  const savedPreviewRenderIds: string[] = []
  const seeds: string[] = []
  for (const n of nodes) {
    if (!PREVIEW_RENDER_NODE_TYPES.has(n.type ?? "")) continue
    const kids = children.get(n.id) ?? []
    if (executes(n.id)) {
      if (!rendersAsPreview(n)) continue
      previewRenderIds.push(n.id)
      seeds.push(...kids)
    } else {
      const consumers = savedPreviewConsumers(n, children, nodeById, edges, reader)
      if (consumers.length === 0) continue
      savedPreviewRenderIds.push(n.id)
      seeds.push(...consumers)
    }
  }
  const gated = new Set<string>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (gated.has(id)) continue
    gated.add(id)
    for (const next of children.get(id) ?? []) if (!gated.has(next)) queue.push(next)
  }
  return { previewRenderIds, savedPreviewRenderIds, gatedNodeIds: gated }
}

/** The nodes this run does not execute because they would consume a preview. */
export function previewGatedNodeIds(
  nodes: readonly PreviewGateNode[],
  edges: readonly PreviewGateEdge[],
  run?: PreviewGateRun,
): Set<string> {
  return new Set(previewStops(nodes, edges, run).gatedNodeIds)
}

/** Does this run hold anything a reviewer would have to review: a Preview
 *  render it executes, or a saved Preview it hands on? */
export function holdsPreviewRender(
  nodes: readonly PreviewGateNode[],
  edges: readonly PreviewGateEdge[],
  run?: PreviewGateRun,
): boolean {
  const stops = previewStops(nodes, edges, run)
  return stops.previewRenderIds.length > 0 || stops.savedPreviewRenderIds.length > 0
}

/**
 * The fields a run's input override clears from the node it overrides, so a
 * fresh input wins over a cached result. The server's merge and
 * `withRunOverrides` both clear exactly these.
 */
export const RUN_OVERRIDE_CLEARED_FIELDS = [
  "generatedResults",
  "activeResultIndex",
  "generatedImageUrl",
  "generatedVideoUrl",
  "generatedAudioUrl",
  "generatedText",
] as const

/**
 * The graph a run executes once its input overrides (`{ [nodeId]: fields }`)
 * are merged: the same shallow merge as the server's, clearing the overridden
 * node's saved results. Never mutates; a node with no override is returned as
 * is. Render final is a run with `{ [renderId]: { quality: "final" } }`.
 */
export function withRunOverrides<N extends PreviewGateNode>(
  nodes: readonly N[],
  overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): N[] {
  if (!overrides) return [...nodes]
  return nodes.map((n) => {
    const fields = overrides[n.id]
    if (!fields) return n
    const merged = mergeNodeInputOverrides(n.type ?? undefined, { ...dataOf(n) }, { ...fields })
    for (const key of RUN_OVERRIDE_CLEARED_FIELDS) delete merged[key]
    return { ...n, data: merged }
  })
}
