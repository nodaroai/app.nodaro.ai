/**
 * A graph holding a UGC video as it is published: a published app's, component's or template's
 * snapshot (whoever runs it, its author included), a share link's view and a share-link viewer's
 * run, the graphs a run of a published app or component, or a share-link viewer's run, loads for
 * its sub-workflows, and a shared workflow's public read and copy by anyone but its author.
 * Nothing made from a UGC run ships, and never the author's photo.
 *
 * Every node in the strip set (`ugcStripSet`: what can flow into a UGC Creator's photo input, and
 * everything downstream of it or of a UGC node) ships EMPTY, read as an allowlist: it keeps only its
 * configuration (`nodeSettingKeys`: the keys its type declares, minus what a run left, its own value,
 * the copies of its inputs a run wrote, and the pointers back to the author's library). A key no rule
 * names goes. Within that configuration an address is cleared without dropping the setting (an object
 * loses the key holding one, a list the item holding one):
 * - STRICTLY — every web, data or blob address and every asset id — on a node whose value can flow
 *   into a creator's photo, a node that takes the photo (a component holding a UGC video, a graph that
 *   could not be read), a UGC node and a library entity;
 * - on any other node in the set (one only made from the photo's path or a UGC node), only a TAINTED
 *   value (`ugcTaintOf`: the author's photo and everything that carries it, or what a run of the
 *   video, or of a node made from it, left), so a logo, a Lottie file or an outro the author set by
 *   its address ships; a key named as an address is its configuration there when its type declares it.
 *   Without the taint (a caller that read none), every address is cleared.
 *
 * - A UGC node also starts empty in its own terms: Keep off, no kept creator (`stripUgcRunState`).
 * - A Preview in the set lists no items.
 * - An outbound node's destination (`keepSetting`: a webhook's address, a publisher's account, a
 *   fetcher's source) stays on a node that is only made from the video — where the app sends is the
 *   app's — but never on a node whose value can flow into a creator's photo.
 *
 * The caller passes this graph's part of the strip set (`strip`, and its photo part `photo`) when it
 * read the graph with what it references; without it the set is read on this graph alone. Every
 * other node keeps what it holds. Nothing passed in is changed.
 */
import { UGC_NODE_TYPES, stripUgcRunState } from "@nodaro/shared"
import { ugcGraphFeeds } from "./ugc-graph-feeds"
import { ugcComposedKey, ugcComposedOf, ugcStripSet } from "./ugc-photo-influence"
import { LIBRARY_POINTER_KEYS, RUN_INPUT_COPY_KEYS, isRunInputCopyKey, nodeSettingKeys } from "./node-settings"
import { isRunResultKey } from "./run-result-keys"
import { ugcStrictString, ugcStripsStrictly, ugcStruckString, ugcTaintedString, type UgcTaint } from "./ugc-taint"
import { UGC_TEMPLATE_KEEP_KEYS } from "./ugc-template-keep"

/** What a node in the set never keeps, a destination or not: the copies of its inputs a run wrote, and the pointers back to the author's library. */
const ALWAYS_GOES: ReadonlySet<string> = new Set([...RUN_INPUT_COPY_KEYS, ...LIBRARY_POINTER_KEYS])

interface StripNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly parentId?: unknown
  readonly data?: unknown
}
interface StripEdge {
  readonly source?: string
  readonly target?: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface UgcPublishStripOptions {
  /** This graph's part of the strip set (`ugcStripSet`), read over the graph and what it references. */
  readonly strip?: ReadonlySet<string>
  /** This graph's part of the photo influence set: the nodes of `strip` whose value can flow into a creator's photo. */
  readonly photo?: ReadonlySet<string>
  /** This graph's nodes that take the photo themselves: a component holding a UGC video, a node whose graph could not be read. */
  readonly sinks?: ReadonlySet<string>
  /** The composition's tainted values (`ugcTaintOf`); without them every address is cleared. */
  readonly taint?: UgcTaint
  /** This graph's nodes that hold a tainted value of their own (`ugcHoldsTaint`): roots, stripped strictly. */
  readonly promoted?: ReadonlySet<string>
  /** A setting an outbound node keeps when it is only made from the video (its destination). */
  readonly keepSetting?: (type: string, key: string) => boolean
  /**
   * A TEMPLATE's kept example run only (`ugc-template-keep.ts`): per node id, the display values a
   * proven video's node ships with, written over what it ships emptied. A key its type may not keep
   * (`UGC_TEMPLATE_KEEP_KEYS`) throws: nothing else ever rides along.
   */
  readonly keep?: ReadonlyMap<string, Readonly<Record<string, unknown>>>
}

/** A kept value written over a node emptied (see `UgcPublishStripOptions.keep`). */
function withKept(data: Data, type: string, kept: Readonly<Record<string, unknown>> | undefined): Data {
  if (!kept) return data
  const allowed = UGC_TEMPLATE_KEEP_KEYS[type] ?? []
  for (const key of Object.keys(kept)) {
    if (!allowed.includes(key)) throw new Error(`A ${type || "node"} may not keep "${key}" in a template`)
  }
  return { ...data, ...kept }
}

type Data = Record<string, unknown>
const isData = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x)
const idOf = (n: StripNode): string | undefined => (typeof n.id === "string" ? n.id : undefined)
const typeOf = (n: StripNode): string => (typeof n.type === "string" ? n.type : "")

/** How deep a setting is searched for a value to clear. */
const VALUE_DEPTH = 8

/** What a setting's string becomes: `undefined` when it goes, else itself, or itself with an address cut out. */
type Clean = (value: string, key: string | undefined) => string | undefined

/** The strict rule: every address — a string that is one, or one inside a sentence — and every asset id. */
const CLEAN_STRICT: Clean = (value, key) => ugcStrictString(value, key)
/** With no taint read: every address. */
const CLEAN_ADDRESSES: Clean = (value, key) => ugcStruckString(value, key, () => true, () => false)

/** Does `value` hold a string `clean` takes away whole, anywhere inside it? */
function dropsAnywhere(value: unknown, clean: Clean, key: string | undefined, depth = 0): boolean {
  if (typeof value === "string") return clean(value, key) === undefined
  if (depth > VALUE_DEPTH || !value || typeof value !== "object") return false
  if (Array.isArray(value)) return value.some((item) => dropsAnywhere(item, clean, key, depth + 1))
  return Object.entries(value).some(([k, item]) => dropsAnywhere(item, clean, k, depth + 1))
}

/**
 * A setting with what `clean` takes cleared: such a string is gone (or loses the address it quotes),
 * an object loses each key holding one that goes, and a list loses each item holding one (an item is
 * one entry — a reference, a layer — and half of one is no entry). Returns `undefined` when the
 * setting itself goes, and the very same value when nothing in it changes.
 */
function without(value: unknown, clean: Clean, key: string | undefined, depth = 0): unknown {
  if (typeof value === "string") return clean(value, key)
  if (!value || typeof value !== "object") return value
  if (depth > VALUE_DEPTH) return dropsAnywhere(value, clean, key, depth) ? undefined : value
  if (Array.isArray(value)) {
    let changed = false
    const out: unknown[] = []
    for (const item of value) {
      if (dropsAnywhere(item, clean, key, depth + 1)) {
        changed = true
        continue
      }
      const kept = without(item, clean, key, depth + 1)
      if (kept !== item) changed = true
      out.push(kept)
    }
    return changed ? out : value
  }
  let changed = false
  const out: Data = {}
  for (const [k, item] of Object.entries(value)) {
    const kept = without(item, clean, k, depth + 1)
    if (kept !== item) changed = true
    if (kept !== undefined) out[k] = kept
  }
  return changed ? out : value
}

/** `value` without a tainted address or asset id anywhere in it (as a node outside the strip set ships). */
export function ugcWithoutTainted(value: unknown, taint: UgcTaint): unknown {
  return without(value, (v, key) => ugcTaintedString(taint, v, key), undefined)
}

/**
 * A node's data as it ships when it is in the strip set (see the file comment). In this order: what a
 * run left, a copy of its inputs and a library pointer always go (a destination-shaped run result —
 * a publisher's post link — included); then a destination `keepSetting` names stays as it is; then
 * anything that is not configuration goes; then what `drop` takes is cleared from what is left.
 */
function emptied(data: Data, type: string, strict: boolean, keepSetting: ((type: string, key: string) => boolean) | undefined, taint: UgcTaint | undefined): Data {
  const settings = nodeSettingKeys(type, { addressSettings: !strict && taint !== undefined })
  const clean: Clean = strict ? CLEAN_STRICT : taint ? (value, key) => ugcTaintedString(taint, value, key) : CLEAN_ADDRESSES
  const out: Data = {}
  for (const [key, value] of Object.entries(data)) {
    if (isRunResultKey(key, type) || ALWAYS_GOES.has(key) || isRunInputCopyKey(key, type)) continue
    if (keepSetting?.(type, key)) {
      out[key] = value
      continue
    }
    if (!settings.has(key)) continue
    const kept = without(value, clean, key)
    if (kept !== undefined) out[key] = kept
  }
  if (type === "preview" && Array.isArray(out.previewItems)) out.previewItems = []
  return out
}

/**
 * Every node a UGC node feeds, at any distance, the UGC nodes themselves included — and the nodes
 * `roots` names and what they feed. Read on one graph.
 */
export function ugcDownstreamIds(
  nodes: ReadonlyArray<StripNode>,
  edges: ReadonlyArray<StripEdge> | undefined,
  roots?: ReadonlySet<string>,
): Set<string> {
  const { children } = ugcGraphFeeds(nodes, edges)
  const reached = new Set<string>()
  const queue = nodes.flatMap((n) => {
    const id = idOf(n)
    return id !== undefined && (UGC_NODE_TYPES.has(typeOf(n)) || roots?.has(id) === true) ? [id] : []
  })
  while (queue.length > 0) {
    const id = queue.pop()!
    if (reached.has(id)) continue
    reached.add(id)
    for (const next of children.get(id) ?? []) if (!reached.has(next)) queue.push(next)
  }
  return reached
}

/**
 * The graph as it is published (see the file comment). A graph with nothing in its strip set is
 * returned as it is.
 */
export function stripUgcPublishState<T extends StripNode>(
  nodes: readonly T[],
  edges: ReadonlyArray<StripEdge> | undefined,
  opts: UgcPublishStripOptions = {},
): T[] {
  let strip = opts.strip
  let photo = opts.photo
  let sinks = opts.sinks
  let taint = opts.taint
  let promoted = opts.promoted
  if (!strip) {
    const root = ugcComposedKey([])
    const alone = ugcStripSet(ugcComposedOf(nodes, edges))
    strip = alone.strip.get(root) ?? new Set<string>()
    photo = alone.photo.get(root) ?? new Set<string>()
    sinks = alone.sinks?.get(root)
    taint = alone.taint
    promoted = alone.promoted?.get(root)
  }
  if (strip.size === 0) return [...nodes]
  const inSet = strip
  const onPhoto = photo ?? new Set<string>()
  const takesPhoto = sinks ?? new Set<string>()
  const ownTaint = promoted ?? new Set<string>()
  const outside: Clean | undefined = taint ? (value, key) => ugcTaintedString(taint, value, key) : undefined
  return stripUgcRunState(nodes).map((node) => {
    const id = idOf(node)
    if (!isData(node.data)) return node
    if (id === undefined || !inSet.has(id)) {
      // Outside the set a node keeps what it holds, but never a tainted value: an address that is the
      // author's photo or made from a UGC run is cut wherever it appears.
      if (!outside) return node
      const cleaned = without(node.data, outside, undefined)
      return cleaned === node.data ? node : { ...node, data: (cleaned ?? {}) as typeof node.data }
    }
    const type = typeOf(node)
    // An outbound node keeps its destination only when nothing of it can reach a creator's photo.
    const keep = onPhoto.has(id) ? undefined : opts.keepSetting
    const strict = ugcStripsStrictly(type, onPhoto.has(id), takesPhoto.has(id), ownTaint.has(id))
    // The photo path never keeps anything, whatever a caller passes.
    const kept = onPhoto.has(id) || takesPhoto.has(id) ? undefined : opts.keep?.get(id)
    return { ...node, data: withKept(emptied(node.data, type, strict, keep, taint), type, kept) }
  })
}
