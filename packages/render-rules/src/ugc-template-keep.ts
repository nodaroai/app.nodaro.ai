/**
 * A template's kept example run: which values of a UGC video may ship in a TEMPLATE whose author
 * opted in ("Include this run's results"), read on the graph alone (layer 1 of the provenance gate).
 * The server proves the same claims against its job ledger before any of it ships (layer 2,
 * backend `ugc-template-keep-ledger.ts`); nothing here is enough on its own.
 *
 * Only a video PROVEN to be one run made with an AI creator keeps anything, and then only what its
 * nodes need to SHOW the example (`UGC_TEMPLATE_KEEP_KEYS`): the creator's image, the script's
 * spoken lines, each clip's current take, the join, overlay and captions renders, and the cards'
 * plans and Notes. Nothing a run reads ever ships with them: no wires, no tickets, no plan, no
 * creator record, no job ids, no kept switch. A video made from the author's own photo never keeps
 * anything; neither does one that cannot be read whole. Every other node of the strip set, and the
 * photo path above all, ships emptied as before.
 *
 * Content-free: a plan is read for its spoken lines only (`hook`, `beats[i].line`, `closer.line`),
 * a creator record for `kind` and `identityImages`.
 */
import { UGC_PUBLISH_PRIVATE_FIELDS, ugcPickPending } from "@nodaro/shared"
import { ugcChains, ugcVideoPlaces, type UgcVideoPlaces } from "./ugc-estimate-input"
import { ugcAddressesIn, ugcCanonicalAddress, type UgcStorageKey } from "./ugc-taint"

/** The display-only key a template's UGC Script carries its example's spoken lines under. */
export const UGC_EXAMPLE_LINES_KEY = "exampleLines"

const FINISH_KEEP = ["generatedVideoUrl", "generatedResults", "activeResultIndex"] as const

/**
 * Per node type, the ONLY keys a proven video's node may ship with in a template: what the node
 * needs to show the example. `stripUgcPublishState` refuses anything else (it throws).
 */
export const UGC_TEMPLATE_KEEP_KEYS: Readonly<Record<string, readonly string[]>> = {
  "ugc-creator": ["generatedImageUrl"],
  "ugc-script": [UGC_EXAMPLE_LINES_KEY],
  "ugc-clips": [],
  "ugc-clip": ["generatedVideoUrl", "generatedResults", "activeResultIndex", "__listResults", "__listResultMeta"],
  "ugc-cards": ["result"],
  "combine-videos": FINISH_KEEP,
  "video-overlay": FINISH_KEEP,
  "add-captions": FINISH_KEEP,
}

/**
 * Per UGC type, every run-state key that NEVER ships, named: what a run reads (wires, tickets, the
 * plan, the creator record), what a run left that is not needed to show it, and the author's own.
 * Every key of `UGC_NODE_RUN_STATE_KEYS` is in exactly one of this list and the keep list (a test
 * holds it), so a run-state key added later is never shipped by accident.
 */
export const UGC_TEMPLATE_NEVER_KEYS: Readonly<Record<string, readonly string[]>> = {
  "ugc-creator": ["result", "keepResult", "ugcOutputs", "candidates", "optionFailed", "photoUrl"],
  "ugc-script": ["result", "keepResult", "ugcOutputs"],
  "ugc-clips": ["result", "quote", "__listResults", "ugcOutputs"],
  "ugc-clip": ["warnings", "rerender", "rerenderPending", "clipWarnings", "durationSec", "ugcOutputs"],
  "ugc-cards": ["ugcOutputs", "generatedText", "text"],
  // UGC Finish keeps nothing in a template: the join's render shows the example, and a finished clip is
  // not one the clip-take proofs cover (a template ships the node emptied).
  "ugc-finish-clips": ["ugcOutputs", "__listResults", "__listResultMeta", "generatedVideoUrl", "generatedResults", "activeResultIndex"],
}

/** Why a video keeps nothing. */
export type UgcKeepReason = "no_ugc_video" | "no_results" | "photo_run" | "unverified"

/** A finish node's kept render, and the videos its job may have been made from. */
export interface UgcKeptFinish {
  readonly nodeId: string
  readonly part: "join" | "overlay" | "captions"
  readonly url: string
}

/** One video's reading. `proven` is layer 1's verdict; the ledger still has to confirm `claims`. */
export interface UgcKeptChain {
  readonly clipsId: string
  readonly proven: boolean
  readonly reason?: UgcKeepReason
  /** What the ledger must confirm (present when `proven`). */
  readonly claims?: {
    readonly creatorImage: string
    readonly takes: readonly string[]
    readonly finishes: readonly UgcKeptFinish[]
  }
  /** Per node id, the values it re-admits (present when `proven`): addresses as the author's run left them. */
  readonly values?: ReadonlyMap<string, Readonly<Record<string, unknown>>>
}

export interface UgcKeepPlan {
  readonly chains: readonly UgcKeptChain[]
}

interface PlanNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly data?: unknown
}
interface PlanEdge {
  readonly source?: string
  readonly target?: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface UgcKeepPlanOptions {
  /** This graph's part of the photo influence set: its values never ship, and nothing kept may match one. */
  readonly photo?: ReadonlySet<string>
  /** This graph's nodes that take the photo themselves (a component holding a UGC video, a graph that could not be read). */
  readonly sinks?: ReadonlySet<string>
  /** The deployment's storage, so an address compares on any of its hosts. */
  readonly storage?: UgcStorageKey
}

type Data = Readonly<Record<string, unknown>>
const isData = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x)
const dataOf = (n: PlanNode | undefined): Data => (n && isData(n.data) ? n.data : {})
const idOf = (n: PlanNode): string | undefined => (typeof n.id === "string" ? n.id : undefined)
const typeOf = (n: PlanNode | undefined): string => (n && typeof n.type === "string" ? n.type : "")
const WEB = /^https?:\/\//i
const web = (x: unknown): string | undefined => (typeof x === "string" && WEB.test(x.trim()) ? x.trim() : undefined)

/** Every address a value holds, at any depth. */
function addressesOf(value: unknown, into: string[] = [], depth = 0): string[] {
  if (typeof value === "string") into.push(...ugcAddressesIn(value))
  else if (depth <= 8 && value && typeof value === "object") for (const item of Array.isArray(value) ? value : Object.values(value)) addressesOf(item, into, depth + 1)
  return into
}

/** The node's active result: its address, from `generatedResults[activeResultIndex]`, else `generatedVideoUrl`. */
function activeVideo(data: Data): string | undefined {
  const results = Array.isArray(data.generatedResults) ? data.generatedResults : []
  const index = typeof data.activeResultIndex === "number" && Number.isInteger(data.activeResultIndex) ? data.activeResultIndex : 0
  const entry: unknown = results[index] ?? results[0]
  return (isData(entry) ? web(entry.url) : undefined) ?? web(data.generatedVideoUrl)
}

/** A finish node's kept values: its active render alone, with no job id, no thumbnail and no history. */
function finishValues(url: string): Data {
  return { generatedVideoUrl: url, generatedResults: [{ url }], activeResultIndex: 0 }
}

/** A clip node's current takes: its fan-out results, else its active result. */
function takesOf(data: Data): string[] {
  const list = Array.isArray(data.__listResults) ? data.__listResults : undefined
  if (list) return list.flatMap((item) => (web(item) ? [web(item)!] : []))
  const one = activeVideo(data)
  return one ? [one] : []
}

/** A clip node's kept values: its takes, and per take its length only. */
function clipValues(data: Data, takes: readonly string[]): Data {
  const meta = Array.isArray(data.__listResultMeta) ? data.__listResultMeta : []
  const listed = Array.isArray(data.__listResults)
  return {
    generatedVideoUrl: takes[0],
    generatedResults: takes.map((url) => ({ url })),
    activeResultIndex: 0,
    ...(listed
      ? {
          __listResults: [...takes],
          __listResultMeta: takes.map((_, i) => {
            const m: unknown = meta[i]
            return isData(m) && typeof m.durationSec === "number" && Number.isFinite(m.durationSec) ? { durationSec: m.durationSec } : {}
          }),
        }
      : {}),
  }
}

/** The plan's spoken lines (hook, each beat's line, the closer), in order, empty ones left out. */
export function ugcScriptSpokenLines(plan: unknown): string[] {
  if (!isData(plan)) return []
  const text = (x: unknown) => (typeof x === "string" ? x.trim() : "")
  const lineOf = (x: unknown) => (isData(x) ? text(x.line) : "")
  const beats = Array.isArray(plan.beats) ? plan.beats.map(lineOf) : []
  return [text(plan.hook), ...beats, lineOf(plan.closer)].filter((line) => line !== "")
}

/** The cards' kept result: the layer plan, the caption plan and the Notes, each a string, nothing else. */
function cardsValues(data: Data): Data | undefined {
  const result = data.result
  if (!isData(result)) return undefined
  const { layerPlan, captionPlan, report } = result
  if (typeof layerPlan !== "string" || typeof captionPlan !== "string" || typeof report !== "string") return undefined
  return { result: { layerPlan, captionPlan, report } }
}

const notProven = (clipsId: string, reason: UgcKeepReason): UgcKeptChain => ({ clipsId, proven: false, reason })

/** Layer 1 for one video (see the file comment): every clause holds, or the video keeps nothing. */
function readChain(
  place: UgcVideoPlaces,
  byId: ReadonlyMap<string, PlanNode>,
  shared: ReadonlySet<string>,
  priced: ReadonlySet<string>,
  feedsFromOutside: (id: string) => boolean,
  photoAddresses: ReadonlySet<string>,
  canonical: (address: string) => string,
): UgcKeptChain {
  const { clipsId, scriptId, creatorId } = place
  if (!scriptId || !creatorId || place.clipIds.length === 0) return notProven(clipsId, "unverified")
  const creator = dataOf(byId.get(creatorId))
  const result = isData(creator.result) ? creator.result : undefined
  // P1: an AI creator, by its setting AND by the run's own record. A photo, a Character, anything else: never.
  if (creator.source === "photo" || result?.kind === "photo") return notProven(clipsId, "photo_run")
  if (ugcPickPending(creator)) return notProven(clipsId, "no_results")
  const image = web(creator.generatedImageUrl)
  if (!image || !result) return notProven(clipsId, "no_results")
  if (creator.source !== "sampled" || result.kind !== "sampled") return notProven(clipsId, "unverified")
  // P2: the image handed on is the record's.
  const identity = Array.isArray(result.identityImages) ? web(result.identityImages[0]) : undefined
  if (identity === undefined || canonical(identity) !== canonical(image)) return notProven(clipsId, "unverified")

  const members = [scriptId, creatorId, clipsId, ...place.clipIds, ...place.cardsIds, ...place.joinIds, ...place.overlayIds, ...place.captionIds]
  // P5: one video's own nodes, none of them another video's, none fed from a sub-workflow or a component.
  if (members.some((id) => shared.has(id) || feedsFromOutside(id))) return notProven(clipsId, "unverified")

  const values = new Map<string, Data>()
  values.set(creatorId, { generatedImageUrl: image })
  const lines = ugcScriptSpokenLines(isData(dataOf(byId.get(scriptId)).result) ? (dataOf(byId.get(scriptId)).result as Data).plan : undefined)
  if (lines.length > 0) values.set(scriptId, { [UGC_EXAMPLE_LINES_KEY]: lines })

  // P4: each clip's current takes only.
  const takes: string[] = []
  for (const clipId of place.clipIds) {
    const clipData = dataOf(byId.get(clipId))
    const own = takesOf(clipData)
    if (own.length === 0) return notProven(clipsId, "no_results")
    takes.push(...own)
    values.set(clipId, clipValues(clipData, own))
  }
  for (const cardsId of place.cardsIds) {
    const kept = cardsValues(dataOf(byId.get(cardsId)))
    if (kept) values.set(cardsId, kept)
  }
  // The finish nodes the video's price counts (a join of its takes alone, an overlay of its cards alone).
  const finishes: UgcKeptFinish[] = []
  const parts: ReadonlyArray<readonly [UgcKeptFinish["part"], readonly string[]]> = [["join", place.joinIds], ["overlay", place.overlayIds], ["captions", place.captionIds]]
  for (const [part, ids] of parts) {
    for (const id of ids) {
      if (!priced.has(id)) return notProven(clipsId, "unverified")
      const url = activeVideo(dataOf(byId.get(id)))
      if (!url) continue
      finishes.push({ nodeId: id, part, url })
      values.set(id, finishValues(url))
    }
  }
  // P3: nothing kept is, or quotes, a value on the photo path.
  const kept = [...values.values()].flatMap((v) => addressesOf(v))
  if (kept.some((address) => photoAddresses.has(canonical(address)))) return notProven(clipsId, "photo_run")
  return { clipsId, proven: true, claims: { creatorImage: image, takes, finishes }, values }
}

/**
 * Layer 1 of the provenance gate over ONE graph (a template's own, never a sub-workflow's or a
 * component's): per UGC video, whether it is proven, why not, and what it would keep.
 */
export function ugcKeepPlan(nodes: ReadonlyArray<PlanNode>, edges: ReadonlyArray<PlanEdge> | undefined, opts: UgcKeepPlanOptions = {}): UgcKeepPlan {
  const all = edges ?? []
  const byId = new Map(nodes.flatMap((n) => (idOf(n) !== undefined ? [[idOf(n)!, n] as const] : [])))
  const typed = nodes as ReadonlyArray<{ id?: string; type?: string | null; data?: unknown }>
  const places = ugcVideoPlaces(typed, all)
  // A node in two videos' places is neither's.
  const seen = new Map<string, number>()
  for (const p of places) {
    for (const id of new Set([p.clipsId, p.scriptId, p.creatorId, ...p.clipIds, ...p.cardsIds, ...p.joinIds, ...p.overlayIds, ...p.captionIds])) {
      if (id !== undefined) seen.set(id, (seen.get(id) ?? 0) + 1)
    }
  }
  const shared = new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id))
  const priced = new Set(ugcChains(typed, all).flatMap((c) => c.members.map((m) => m.id)))
  const outside = new Set([...nodes].filter((n) => typeOf(n) === "sub-workflow" || typeOf(n) === "component" || opts.sinks?.has(idOf(n) ?? "")).flatMap((n) => (idOf(n) ? [idOf(n)!] : [])))
  const feedsFromOutside = (id: string) => all.some((e) => e.target === id && e.source !== undefined && outside.has(e.source))
  const canonical = (address: string) => ugcCanonicalAddress(address, opts.storage)
  const photoAddresses = new Set<string>()
  for (const id of [...(opts.photo ?? []), ...(opts.sinks ?? [])]) for (const a of addressesOf(dataOf(byId.get(id)))) photoAddresses.add(canonical(a))
  // The author's own photo on any creator, whatever its source now.
  for (const n of nodes) {
    if (typeOf(n) !== "ugc-creator") continue
    for (const key of UGC_PUBLISH_PRIVATE_FIELDS["ugc-creator"] ?? []) for (const a of addressesOf(dataOf(n)[key])) photoAddresses.add(canonical(a))
  }
  return { chains: places.map((p) => readChain(p, byId, shared, priced, feedsFromOutside, photoAddresses, canonical)) }
}

/** The answer for a whole graph: kept when any video is proven, else the first reason that matters. */
export function ugcKeepVerdict(chains: readonly { readonly proven: boolean; readonly reason?: UgcKeepReason }[]): { included: boolean; reason?: UgcKeepReason } {
  if (chains.length === 0) return { included: false, reason: "no_ugc_video" }
  if (chains.some((c) => c.proven)) return { included: true }
  for (const reason of ["photo_run", "unverified", "no_results"] as const) if (chains.some((c) => c.reason === reason)) return { included: false, reason }
  return { included: false, reason: "unverified" }
}
