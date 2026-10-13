/**
 * UGC videos read off a graph, for their estimate: one video per UGC Clips node
 * (`ugcChains`), each with the nodes its estimate prices and the part each one
 * is; each video's estimate inputs, read through its own wires
 * (`ugcChainInput`); and what of them a run of a set of nodes executes
 * (`ugcEstimateRunParts`).
 *
 * One reading for both engines: the server's estimate seam leaves exactly these
 * nodes out of its per-node sum, and the editor prices a run set with the
 * server's figure for exactly these nodes.
 *
 * A finish node is the video's by its place in the chain, never by sitting
 * somewhere below UGC Clip: the join whose every input is the video's UGC Clip
 * and whose output is its UGC Cards' video, the overlay drawing only its UGC
 * Cards' layer plan, the captions taking its UGC Cards' caption plan. Every
 * other Combine Videos, Video Overlay or Add Captions keeps its own price.
 *
 * Content-free: a node's type and its wires; a UGC Script's `targetDurationSec`
 * and the length and screenshot cards its saved plan was written with
 * (`ugcPlanLengthSec`, `ugcPlanScreenshotCount`); a UGC
 * Creator's `source`; the Keep a kept node holds (`ugcKeptOutputs`); an Upload
 * Image's `url` or result; a Video Overlay's own layers' images.
 */
import {
  UGC_NODE_TYPES,
  UGC_PRIMARY_HANDLE,
  UGC_SCRIPT_DEFAULT_TARGET_SEC,
  UGC_SCREENSHOT_HANDLES,
  VIDEO_OVERLAY_HANDLE_IDS,
  ugcKeptOutputs,
  ugcPlanLengthSec,
  ugcPlanScreenshotCount,
} from "@nodaro/shared"

/** A part of the UGC estimate: one step, or one group of steps, of the video. */
export type UgcEstimatePart = "script" | "creator" | "clip" | "cards" | "join" | "overlay" | "captions"

/** Every part, in the order a run reaches them. */
export const UGC_ESTIMATE_PARTS: readonly UgcEstimatePart[] = ["script", "creator", "clip", "cards", "join", "overlay", "captions"]

/**
 * What one line of a UGC quote or estimate prices, by a stable id: the editor names the line by
 * it in the person's language, and the line's `label` stays the server's English for API clients.
 * A clip line also carries its number and length (`n`, `seconds`).
 */
export type UgcQuoteLineKey = "clip" | "join" | "alignment" | "speechCheck" | "cards" | "captions" | "script" | "creatorImage" | "creatorCheck"

/** Every quote line id. */
export const UGC_QUOTE_LINE_KEYS: readonly UgcQuoteLineKey[] = ["clip", "join", "alignment", "speechCheck", "cards", "captions", "script", "creatorImage", "creatorCheck"]

/** What the estimate reads: the target length, the screenshots wired in, and the creator's source. */
export interface UgcEstimateInput {
  readonly targetDurationSec: number
  readonly screenshotCount: number
  readonly source: "sampled" | "photo"
}

interface GraphNode {
  readonly id?: string
  readonly type?: string | null
  readonly data?: unknown
}
interface GraphEdge {
  readonly source?: string
  readonly target?: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}
type Overrides = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** A node a video's estimate prices, and the part it is priced as: null for UGC Clips, which is free. */
export interface UgcChainMember {
  readonly id: string
  readonly part: UgcEstimatePart | null
}

/** One UGC video of a graph. */
export interface UgcChain {
  /** The UGC Clips node the video is grouped by; absent for a UGC node wired into no UGC Clips. */
  readonly clipsId?: string
  /** The UGC Script on the video's `plan` wire. */
  readonly scriptId?: string
  /** The UGC Creator on the video's `creator` wire. */
  readonly creatorId?: string
  /** Every node the video's estimate prices, with its part. */
  readonly members: readonly UgcChainMember[]
}

/**
 * The node types a UGC video's finish nodes are: its join (Combine Videos), the overlay drawing its
 * screenshot cards (Video Overlay) and the captions on its caption plan (Add Captions). A node of
 * one of these types is the video's only by its place in the chain (`ugcVideoPlaces`).
 */
export const UGC_FINISH_NODE_TYPES: ReadonlySet<string> = new Set(["combine-videos", "video-overlay", "add-captions"])

const dataOf = (n: GraphNode | undefined): Readonly<Record<string, unknown>> =>
  n?.data && typeof n.data === "object" ? (n.data as Record<string, unknown>) : {}

/** The output a wire reads: its source handle, or (none) its source's primary output. */
function readsFrom(edge: GraphEdge, sourceType: string | null | undefined): string | undefined {
  if (edge.sourceHandle) return edge.sourceHandle
  return sourceType && Object.hasOwn(UGC_PRIMARY_HANDLE, sourceType) ? UGC_PRIMARY_HANDLE[sourceType] : undefined
}

/** A Video Overlay's own layers: a stored layer holding an image, or an image wired into one of its layer handles. */
function overlayHasOwnLayers(overlay: GraphNode, edges: ReadonlyArray<GraphEdge>): boolean {
  const stored = dataOf(overlay).layers
  if (Array.isArray(stored) && stored.some((l) => !!l && typeof l === "object" && typeof (l as { imageUrl?: unknown }).imageUrl === "string" && (l as { imageUrl: string }).imageUrl.length > 0)) return true
  const handles = new Set<string>(VIDEO_OVERLAY_HANDLE_IDS)
  return edges.some((e) => e.target === overlay.id && handles.has(e.targetHandle ?? ""))
}

/**
 * A UGC video's place in the graph, read through its wires alone: its UGC Clips node, the script on
 * its `plan` wire, the creator on its `creator` wire, the UGC Clip(s) on its clips, the UGC Cards
 * reading them, and the nodes in the places a finish node takes — every Combine Videos with a wire
 * from the video's UGC Clip that hands its video to the video's UGC Cards, every Video Overlay on
 * the cards' layer plan, every Add Captions on their caption plan. What else those nodes hold or
 * take is not read here: the price (`ugcChains`) and the newer-run membership (`ugcFinishNodeIds`)
 * each read the places by their own rule.
 */
export interface UgcVideoPlaces {
  readonly clipsId: string
  readonly scriptId?: string
  readonly creatorId?: string
  readonly clipIds: readonly string[]
  readonly cardsIds: readonly string[]
  readonly joinIds: readonly string[]
  readonly overlayIds: readonly string[]
  readonly captionIds: readonly string[]
}

/** One `UgcVideoPlaces` per UGC Clips node of the graph, in the graph's order. */
export function ugcVideoPlaces(nodes: ReadonlyArray<GraphNode>, edges: ReadonlyArray<GraphEdge> | undefined): UgcVideoPlaces[] {
  const all = edges ?? []
  const byId = new Map(nodes.flatMap((n) => (n.id !== undefined ? [[n.id, n] as const] : [])))
  const typeOf = (id: string | undefined) => (id !== undefined ? byId.get(id)?.type ?? undefined : undefined)
  const into = (id: string, handle: string) => all.filter((e) => e.target === id && (e.targetHandle ?? "") === handle)
  const from = (ids: ReadonlySet<string>, read: string, targetType: string, targetHandle: string): string[] => [
    ...new Set(
      all.flatMap((e) =>
        e.source !== undefined && ids.has(e.source) && e.target !== undefined && typeOf(e.target) === targetType && (e.targetHandle ?? "") === targetHandle && readsFrom(e, typeOf(e.source)) === read
          ? [e.target]
          : [],
      ),
    ),
  ]
  const wiredFrom = (id: string, handle: string, type: string, read: string): string | undefined =>
    into(id, handle).find((e) => typeOf(e.source) === type && readsFrom(e, type) === read)?.source

  const places: UgcVideoPlaces[] = []
  for (const clips of nodes) {
    if (clips.type !== "ugc-clips" || clips.id === undefined) continue
    const scriptId = wiredFrom(clips.id, "plan", "ugc-script", "plan")
    const creatorId = wiredFrom(clips.id, "creator", "ugc-creator", "creator")
    const clipIds = from(new Set([clips.id]), "clips", "ugc-clip", "clip")
    const clipSet = new Set(clipIds)
    const cardsIds = [
      ...new Set([
        ...from(new Set([clips.id]), "plan-out", "ugc-cards", "plan"),
        ...from(new Set([clips.id]), "transcript", "ugc-cards", "transcript"),
        ...from(clipSet, "video-out", "ugc-cards", "notes"),
      ]),
    ]
    const cardsSet = new Set(cardsIds)
    // The join's place: a wire into it from this video's UGC Clip, and its video handed to this video's UGC Cards.
    const joinIds = nodes.flatMap((n) => {
      if (n.type !== "combine-videos" || n.id === undefined) return []
      const fromClip = all.some((e) => e.target === n.id && e.source !== undefined && clipSet.has(e.source))
      const feedsCards = all.some((e) => e.source === n.id && e.target !== undefined && cardsSet.has(e.target) && (e.targetHandle ?? "") === "video")
      return fromClip && feedsCards ? [n.id] : []
    })
    places.push({
      clipsId: clips.id,
      ...(scriptId !== undefined ? { scriptId } : {}),
      ...(creatorId !== undefined ? { creatorId } : {}),
      clipIds,
      cardsIds,
      joinIds,
      overlayIds: from(cardsSet, "layerPlan", "video-overlay", "layerPlan"),
      captionIds: from(cardsSet, "captionPlan", "add-captions", "captionPlan"),
    })
  }
  return places
}

/**
 * The UGC videos of a graph, as their price counts them: one per UGC Clips node
 * (`ugcVideoPlaces`), with the script on its `plan` wire, the creator on its
 * `creator` wire, the UGC Clip on its clips, the UGC Cards that reads it, and the
 * join, overlay and captions its estimate prices — a join only when every wire into
 * it is the video's UGC Clip, an overlay only when it has no layer of its own (either
 * renders anyway, and keeps its own price). A UGC node wired into no UGC Clips is a
 * video of its own, holding only itself.
 */
export function ugcChains(nodes: ReadonlyArray<GraphNode>, edges: ReadonlyArray<GraphEdge> | undefined): UgcChain[] {
  const all = edges ?? []
  const byId = new Map(nodes.flatMap((n) => (n.id !== undefined ? [[n.id, n] as const] : [])))

  const chains: UgcChain[] = []
  const placed = new Set<string>()
  for (const place of ugcVideoPlaces(nodes, edges)) {
    const { clipsId, scriptId, creatorId, clipIds, cardsIds, captionIds } = place
    const clipSet = new Set(clipIds)
    // The join it prices: every wire into it is this video's UGC Clip.
    const joinIds = place.joinIds.filter((id) => all.every((e) => e.target !== id || (e.source !== undefined && clipSet.has(e.source))))
    // The overlay drawing only this video's screenshot cards.
    const overlayIds = place.overlayIds.filter((id) => !overlayHasOwnLayers(byId.get(id)!, all))
    const members: UgcChainMember[] = [
      ...(scriptId !== undefined ? [{ id: scriptId, part: "script" as const }] : []),
      ...(creatorId !== undefined ? [{ id: creatorId, part: "creator" as const }] : []),
      { id: clipsId, part: null },
      ...clipIds.map((id) => ({ id, part: "clip" as const })),
      ...cardsIds.map((id) => ({ id, part: "cards" as const })),
      ...joinIds.map((id) => ({ id, part: "join" as const })),
      ...overlayIds.map((id) => ({ id, part: "overlay" as const })),
      ...captionIds.map((id) => ({ id, part: "captions" as const })),
    ]
    for (const m of members) placed.add(m.id)
    chains.push({ clipsId, ...(scriptId !== undefined ? { scriptId } : {}), ...(creatorId !== undefined ? { creatorId } : {}), members })
  }
  const LONE_PART: Readonly<Record<string, UgcEstimatePart>> = { "ugc-script": "script", "ugc-creator": "creator", "ugc-clip": "clip", "ugc-cards": "cards" }
  for (const n of nodes) {
    if (n.id === undefined || placed.has(n.id) || !UGC_NODE_TYPES.has(n.type ?? "") || !Object.hasOwn(LONE_PART, n.type ?? "")) continue
    const part = LONE_PART[n.type!]!
    chains.push({
      ...(part === "script" ? { scriptId: n.id } : {}),
      ...(part === "creator" ? { creatorId: n.id } : {}),
      members: [{ id: n.id, part }],
    })
  }
  return chains
}

/** How a chain's input is read. */
export interface UgcChainInputOptions {
  /**
   * A run's overrides (the app runner): each node's values for this run. Present, or `run` set,
   * means a RUN's reading: a screenshot slot counts when it will hold an image.
   */
  readonly overrides?: Overrides
  /** An editor run: which nodes it executes. A script it does not execute hands on its saved plan. */
  readonly run?: { readonly executes: (id: string) => boolean }
}

/** A chain's estimate input, and whether its script's saved plan, handed on, carries no length or screenshot cards the app can read. */
export interface UgcChainInputRead {
  readonly input: UgcEstimateInput
  /** The run hands on a saved plan with no readable length: the figure cannot be checked. */
  readonly lengthUnread: boolean
  /** The run hands on a saved plan whose beats cannot be read at all: its cards are the wires' guess, and the figure cannot be checked. */
  readonly screenshotsUnread: boolean
}

/**
 * A chain's estimate input, read through its own wires (never another video's script or creator).
 * Its length is the script's, or, when the run hands on the script's saved plan (Keep, or a run
 * that leaves the script out), the length that plan was written to — never the length setting —
 * and then its screenshot cards are the ones that plan was written with, never the script's wires.
 * Without overrides or a run (publish, the API's graph estimate): the wired screenshot slots whose
 * source exists, the "from" figure for the graph as built. A run: the slots that will hold an
 * image — an Upload Image holding one, or any other producer.
 */
export function ugcChainInput(
  chain: UgcChain,
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge> | undefined,
  opts: UgcChainInputOptions = {},
): UgcChainInputRead {
  const all = edges ?? []
  const byId = new Map(nodes.flatMap((n) => (n.id !== undefined ? [[n.id, n] as const] : [])))
  const val = (n: GraphNode | undefined, k: string): unknown =>
    n ? (n.id ? opts.overrides?.[n.id]?.[k] : undefined) ?? dataOf(n)[k] : undefined
  const script = chain.scriptId !== undefined ? byId.get(chain.scriptId) : undefined
  const creator = chain.creatorId !== undefined ? byId.get(chain.creatorId) : undefined

  let targetDurationSec = UGC_SCRIPT_DEFAULT_TARGET_SEC
  let lengthUnread = false
  let screenshotsUnread = false
  /** The screenshot cards a saved plan handed on was written with (undefined: none handed on, or its beats unreadable). */
  let savedScreenshots: number | undefined
  if (script) {
    const data = dataOf(script)
    const setting = val(script, "targetDurationSec")
    if (typeof setting === "number") targetDurationSec = setting
    const kept = ugcKeptOutputs("ugc-script", data) !== null
    const result = data.result && typeof data.result === "object" ? (data.result as Record<string, unknown>) : undefined
    const outputs = data.ugcOutputs && typeof data.ugcOutputs === "object" ? (data.ugcOutputs as Record<string, unknown>) : undefined
    const savedPlan = result?.plan ?? outputs?.plan
    const handsOnSaved = kept || (opts.run !== undefined && script.id !== undefined && !opts.run.executes(script.id) && savedPlan !== undefined)
    if (handsOnSaved) {
      // The plan's own length; a plan carrying none leaves the setting as the best guess, flagged.
      const sec = ugcPlanLengthSec(savedPlan)
      if (sec !== undefined) targetDurationSec = sec
      else lengthUnread = true
      // Its own screenshot cards, never the script's wires now (which may have changed since), read
      // beat by beat. A plan with no beats to read at all is one UGC Clips refuses: the wires stay the
      // best guess, flagged, so the figure is never quoted as a checked one.
      savedScreenshots = ugcPlanScreenshotCount(savedPlan)
      screenshotsUnread = savedScreenshots === undefined
    }
  }

  const runReading = opts.overrides !== undefined || opts.run !== undefined
  const holdsImage = (sourceId: string | undefined): boolean => {
    const src = sourceId !== undefined ? byId.get(sourceId) : undefined
    if (!src) return false // a wire to nothing hands nothing on
    if (!runReading || src.type !== "upload-image") return true
    const url = val(src, "url")
    if (typeof url === "string" && url.length > 0) return true
    const results = dataOf(src).generatedResults
    return Array.isArray(results) && results.some((r) => !!r && typeof r === "object" && typeof (r as { url?: unknown }).url === "string" && (r as { url: string }).url.length > 0)
  }
  const slots = new Set(UGC_SCREENSHOT_HANDLES)
  const screenshotCount = savedScreenshots ?? (script?.id !== undefined
    ? all.filter((e) => e.target === script.id && slots.has(e.targetHandle ?? "") && holdsImage(e.source)).length
    : 0)

  return {
    input: { targetDurationSec, screenshotCount, source: val(creator, "source") === "photo" ? "photo" : "sampled" },
    lengthUnread,
    screenshotsUnread,
  }
}

/** One executed node a chain prices: its part, and the node whose number of runs multiplies it. */
export interface UgcRunPricedNode {
  readonly id: string
  readonly part: UgcEstimatePart
  /**
   * The node whose runs multiply this part, or null for one run: the node itself, except UGC Clip,
   * whose clips are all in its part already, so it runs as many times as its UGC Clips does.
   */
  readonly fanOutOf: string | null
}

/** One video a run executes some of. */
export interface UgcRunChain {
  readonly input: UgcEstimateInput
  readonly lengthUnread: boolean
  readonly screenshotsUnread: boolean
  /** The executed nodes this video prices. A node two videos share is in both: `ugcSumPerNode` counts it once. */
  readonly nodes: readonly UgcRunPricedNode[]
}

/** What of the graph's UGC videos a run executes. */
export interface UgcEstimateRunParts {
  readonly chains: readonly UgcRunChain[]
  /**
   * Every executed node a video covers, whose own line the estimate replaces: the nodes it prices,
   * and the UGC nodes priced at nothing (UGC Clips; a script or creator that hands on what it keeps).
   */
  readonly coveredIds: ReadonlySet<string>
}

/**
 * What of the UGC estimates a run of `executable` executes; null when it executes none of them
 * (no UGC node, a kept script, the free UGC Clips alone), and the run is priced as any other.
 */
export function ugcEstimateRunParts(
  executable: ReadonlyArray<GraphNode>,
  allNodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge> | undefined,
): UgcEstimateRunParts | null {
  const runIds = new Set(executable.flatMap((n) => (n.id !== undefined ? [n.id] : [])))
  const executes = (id: string) => runIds.has(id)
  const byId = new Map(allNodes.flatMap((n) => (n.id !== undefined ? [[n.id, n] as const] : [])))
  const covered = new Set<string>()
  const chains: UgcRunChain[] = []
  for (const chain of ugcChains(allNodes, edges)) {
    const pricedHere: UgcRunPricedNode[] = []
    for (const m of chain.members) {
      if (!executes(m.id)) continue
      covered.add(m.id)
      if (m.part === null) continue
      const data = dataOf(byId.get(m.id))
      // A script or creator that hands on what it keeps makes no call.
      if ((m.part === "script" && ugcKeptOutputs("ugc-script", data)) || (m.part === "creator" && ugcKeptOutputs("ugc-creator", data))) continue
      const fanOutOf = m.part === "clip" ? (chain.clipsId !== undefined && executes(chain.clipsId) ? chain.clipsId : null) : m.id
      pricedHere.push({ id: m.id, part: m.part, fanOutOf })
    }
    if (pricedHere.length === 0) continue
    const { input, lengthUnread, screenshotsUnread } = ugcChainInput(chain, allNodes, edges, { run: { executes } })
    chains.push({ input, lengthUnread, screenshotsUnread, nodes: pricedHere })
  }
  return chains.length === 0 ? null : { chains, coveredIds: covered }
}

/**
 * Each node's figure across a graph's UGC videos: a node two videos share (a script feeding
 * two UGC Clips, a UGC Cards reading both) takes the larger of its figures, so sharing never
 * adds a part twice and never quotes less than either video asks.
 */
export function ugcFiguresPerNode(entries: Iterable<{ readonly id: string; readonly credits: number }>): Map<string, number> {
  const best = new Map<string, number>()
  for (const { id, credits } of entries) best.set(id, Math.max(best.get(id) ?? 0, credits))
  return best
}

/** The figures of a graph's UGC videos added up, each node once (`ugcFiguresPerNode`). */
export function ugcSumPerNode(entries: Iterable<{ readonly id: string; readonly credits: number }>): number {
  let sum = 0
  for (const credits of ugcFiguresPerNode(entries).values()) sum += credits
  return sum
}
