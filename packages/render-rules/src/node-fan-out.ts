/**
 * How many times a node runs in one run of its workflow: the runs its incoming
 * Each wires fan it out to (a List's items, a Content Ideas' ideas, a clips
 * plan's clips, a Social Search's posts, …) times its Repeat count. The one
 * rule the editor's run estimate (`getFanOutMultiplier`) and the listing a
 * published app, component or template stores both read (decided 2026-10-07),
 * so a listed price counts every run the editor's estimate counts.
 *
 * Several providers on one node are counted by the caller, which prices each
 * provider at its own row ({@link nodeProviders}).
 */
import {
  clampContentIdeasCount,
  COLLECTION_READ_LIMIT_MAX,
  decodeProviderItem,
  defaultEdgeOutputMode,
  editPlanSavedOutput,
  expandItemsWithRepeat,
  FAN_OUT_EACH_TYPES,
  getEffectiveRepeatCount,
  isDefaultSelectorConfig,
  isSocialSearchPickFrozen,
  listResultsServeHandle,
  REPEATABLE_NODE_TYPES,
  selectListItems,
  socialPostsFrom,
  socialSearchPickTop,
  TELEGRAM_FEED_DEFAULT_LIMIT,
  TELEGRAM_FEED_LIMIT_MAX,
  telegramPostsFrom,
  type SelectorFields,
} from "@nodaro/shared"
import type { EditPlanOutputReader, EstimateGraphNode } from "./apply-edl-estimate"
import { editPlanClipFanOut, heldBatchFanOut, inheritedClipFanOut, selectedFanOutCount, type FanOutGraphEdge } from "./clip-fan-out"

/** Downstream runs one run of a producer makes the node after it run. */
export type ProducerFanOut = (
  data: Record<string, unknown>,
  reruns: boolean,
  selector?: SelectorFields,
  planOutputOf?: EditPlanOutputReader,
) => number

const dataOf = (n: EstimateGraphNode): Record<string, unknown> => (n.data as Record<string, unknown> | undefined) ?? {}
const edgeDataOf = (e: FanOutGraphEdge): Record<string, unknown> | undefined =>
  e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : undefined

/** How many of `items` a selector keeps: 0 when it keeps one or none. */
function fanOutCount(items: readonly string[], selector: SelectorFields | undefined): number {
  const count = isDefaultSelectorConfig(selector) ? items.length : selectListItems([...items], selector).length
  return count > 1 ? count : 0
}

/** `n` items, of which the selector keeps; at least 1. */
function keptOrOne(n: number, selector: SelectorFields | undefined): number {
  const kept = selectedFanOutCount(n, selector)
  return kept > 0 ? kept : 1
}

/**
 * Downstream executions one Content Ideas run fans out: one per idea. Not
 * re-running → its saved briefs are what iterate (exact). Running → it writes
 * `count` ideas, clamped the way the run clamps it (1–10, default 5).
 */
function contentIdeasFanOut(data: Record<string, unknown>, reruns: boolean, selector?: SelectorFields): number {
  const saved = Array.isArray(data.ideaBriefs)
    ? data.ideaBriefs.filter((b) => typeof b === "string" && b.trim() !== "").length
    : 0
  return keptOrOne(!reruns && saved > 0 ? saved : clampContentIdeasCount(data.count), selector)
}

/**
 * Downstream executions one Social Search fans out on an Each wire: one per
 * post it passes on. Not re-running, or picks kept → the posts it holds now
 * (exact). Running a fresh search → the first `pickTop` posts (default 5).
 */
function socialSearchFanOut(data: Record<string, unknown>, reruns: boolean, selector?: SelectorFields): number {
  const held = socialPostsFrom(data.generatedJson).length
  const posts = (!reruns || isSocialSearchPickFrozen("social-search", data)) && held > 0 ? held : socialSearchPickTop(data.pickTop)
  return keptOrOne(posts, selector)
}

/** Telegram Channel Feed on an Each wire: one run per post the node holds, else per post its limit allows. */
function telegramFeedFanOut(data: Record<string, unknown>, reruns: boolean, selector?: SelectorFields): number {
  const held = telegramPostsFrom(data.generatedJson).length
  const posts = !reruns && held > 0 ? held : Math.max(1, Math.min(TELEGRAM_FEED_LIMIT_MAX, Number(data.limit) || TELEGRAM_FEED_DEFAULT_LIMIT))
  return keptOrOne(posts, selector)
}

/** Read Collection on an Each wire: the records it holds, else its limit. */
function collectionReadFanOut(data: Record<string, unknown>, reruns: boolean, selector?: SelectorFields): number {
  const held = Array.isArray(data.generatedJson) ? data.generatedJson.length : 0
  const records = !reruns && held > 0 ? held : Math.max(1, Math.min(COLLECTION_READ_LIMIT_MAX, Number(data.limit) || 50))
  return keptOrOne(records, selector)
}

/**
 * Fan-out producers in FAN_OUT_EACH_TYPES that are not list operations: one
 * downstream run per item they emit. A producer missing here is estimated as
 * ONE run downstream, which under-quotes; the editor's cost-multiplier test
 * fails the build for any such producer.
 */
export const PRODUCER_FAN_OUT: Readonly<Record<string, ProducerFanOut>> = {
  "edit-plan": (data, reruns, selector, planOutputOf) => editPlanClipFanOut(data, reruns, selector, planOutputOf ?? editPlanSavedOutput),
  "content-ideas": contentIdeasFanOut,
}

/**
 * Producers NOT in FAN_OUT_EACH_TYPES (a wire from them passes the whole list
 * by default) whose wire, once set to Each, runs the next node once per item
 * they emit. Sized the same way as PRODUCER_FAN_OUT.
 */
export const EACH_WIRE_FAN_OUT: Readonly<Record<string, ProducerFanOut>> = {
  "social-search": socialSearchFanOut,
  "telegram-channel-feed": telegramFeedFanOut,
  "collection-read": collectionReadFanOut,
}

const producerOf = (type: string | null | undefined): ProducerFanOut | undefined =>
  PRODUCER_FAN_OUT[type ?? ""] ?? EACH_WIRE_FAN_OUT[type ?? ""]

/** The mode an edge runs in: its own, else its producer's default. */
function edgeMode(edge: FanOutGraphEdge, source: EstimateGraphNode): string | undefined {
  return (edgeDataOf(edge)?.outputMode as string | undefined) ?? defaultEdgeOutputMode(source.type, edge.sourceHandle)
}

/** A List's items as a run iterates them (its single column, newline-separated). */
function listItemsOf(data: Record<string, unknown>): string[] {
  return (typeof data.items === "string" ? data.items : "").split("\n").map((s) => s.trim()).filter(Boolean)
}

/** A List's runs on a wire: its items, else (more than one) its rows. 0 when it fans nothing out. */
function listFanOut(data: Record<string, unknown>, selector: SelectorFields | undefined): number {
  const items = fanOutCount(listItemsOf(data), selector)
  if (items > 0) return items
  const rows = data.rows as unknown[] | undefined
  if (Array.isArray(rows) && rows.length > 1) return fanOutCount(rows.map((_, i) => String(i + 1)), selector)
  return 0
}

/** An Each wire whose producer emits nothing on it: 0 runs. */
function eachWireCarriesNothing(
  edge: FanOutGraphEdge,
  nodes: readonly EstimateGraphNode[],
  edges: readonly FanOutGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader,
): boolean {
  const source = nodes.find((n) => n.id === edge.source)
  if (!source || edgeMode(edge, source) !== "each") return false
  const producer = producerOf(source.type)
  if (producer) return producer(dataOf(source), rerunIds.has(source.id), edgeDataOf(edge) as SelectorFields | undefined, planOutputOf) === 0
  if (!listResultsServeHandle(source.type, edge.sourceHandle) || heldBatchFanOut(source, rerunIds) > 1) return false
  return inheritedClipFanOut(source, nodes, edges, rerunIds, planOutputOf) === 0
}

/** The runs `node`'s incoming Each wires make it (1 when none; 0 when one carries nothing). */
export function baseFanOut(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly FanOutGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): number {
  const incoming = edges.filter((e) => e.target === node.id)
  // A wire that carries nothing (an Edit Plan whose review or selection keeps
  // no clip) means the node does not run, whatever another wire lists. Checked
  // over every wire BEFORE any count, so the answer never depends on the order
  // the wires were drawn in.
  if (incoming.some((e) => eachWireCarriesNothing(e, nodes, edges, rerunIds, planOutputOf))) return 0

  for (const edge of incoming) {
    const source = nodes.find((n) => n.id === edge.source)
    if (!source) continue
    const mode = edgeMode(edge, source)
    if (mode !== "each") continue
    const selector = edgeDataOf(edge) as SelectorFields | undefined

    const producer = producerOf(source.type)
    if (producer) {
      const n = producer(dataOf(source), rerunIds.has(source.id), selector, planOutputOf)
      if (n > 1) return n
    }

    if (source.type === "list") {
      const n = listFanOut(dataOf(source), selector)
      if (n > 0) return n
    }

    // Transitive: a Text node fed by a List on an Each wire.
    if (source.type === "text-prompt") {
      for (const upEdge of edges) {
        if (upEdge.target !== source.id) continue
        const list = nodes.find((n) => n.id === upEdge.source)
        if (!list || !FAN_OUT_EACH_TYPES.has(list.type ?? "")) continue
        if (((edgeDataOf(upEdge)?.outputMode as string | undefined) ?? "each") !== "each") continue
        if (list.type !== "list") continue
        const n = listFanOut(dataOf(list), edgeDataOf(upEdge) as SelectorFields | undefined)
        if (n > 0) return n
      }
    }

    // Clip Pack: an Each wire (set by hand, or a per-handle default like
    // Camera Switch's EDL) from a node that is itself fanned out per clip.
    if (listResultsServeHandle(source.type, edge.sourceHandle)) {
      const held = heldBatchFanOut(source, rerunIds)
      if (held > 1) return held
      const inherited = inheritedClipFanOut(source, nodes, edges, rerunIds, planOutputOf)
      if (inherited > 1) return inherited
    }
  }
  return 1
}

/**
 * How many times `node` runs: {@link baseFanOut} times its Repeat count.
 * `rerunIds` are the nodes about to execute: a producer among them makes a
 * fresh set (its count setting, or its default), one outside them hands on
 * the set it holds.
 */
export function nodeFanOut(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly FanOutGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): number {
  return baseFanOut(node, nodes, edges, rerunIds, planOutputOf) * getEffectiveRepeatCount(dataOf(node))
}

/**
 * The providers a node runs when it names two or more (`data.providers`), in
 * order and once per entry: the run's own expansion (`expandItemsWithRepeat`,
 * which runs each entry once per repeat). The caller prices each at its own
 * row and multiplies by {@link nodeFanOut}. `undefined` for a single-provider node.
 */
export function nodeProviders(type: string | undefined, data: Record<string, unknown> | undefined): readonly string[] | undefined {
  const d = data ?? {}
  const items = expandItemsWithRepeat(undefined, type ?? "", d)
  if (!items) return undefined
  const repeat = REPEATABLE_NODE_TYPES.has(type ?? "") ? getEffectiveRepeatCount(d) : 1
  const providers = items.filter((_, i) => i % repeat === 0).map(decodeProviderItem)
  return providers.length >= 2 && providers.every((p): p is string => p !== undefined) ? providers : undefined
}
