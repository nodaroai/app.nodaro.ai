/**
 * A workflow as anyone but its author receives it, read with every sub-workflow graph and component
 * snapshot it references (`ugcStripSet`, @nodaro/render-rules). The ONE funnel every surface goes
 * through — app, component and template publish, a share link's view and run, a shared workflow's
 * public read and copy, and a run of a published app or component, or a share-link viewer's run —
 * so "My photo" is always the runner's own photo and nothing made from a UGC run ships: no node
 * whose value can flow into a UGC Creator's photo input, and no node made from it or from a UGC
 * video, ships with what it holds, becomes a preview, or reaches anyone else's run. Each keeps only
 * its configuration.
 *
 * The composed graph is read once per request, each referenced graph loaded once:
 * - a sub-workflow node's graph is the owner's own workflow, read whole, at every depth up to the
 *   run's limit — a component's own sub-workflows, its creator's;
 * - a component node's graph is the published snapshot its run would load (the component route's
 *   own lookup), read only for the UGC video it holds — never walked into;
 * - a graph that does not load (missing, deleted, not the owner's, a cycle, past the depth or the
 *   read's cap) FAILS CLOSED: its node is read as holding a UGC video, and what feeds it as reaching
 *   a creator's photo. A load that fails with an error does the same on a read or a run; a publish
 *   (`failOnError`) is refused instead, before anything is written, so no published version is cut
 *   from a graph read in part.
 *
 * A node only made from the video clears a file address in its settings only when it is tainted
 * (`ugcTaintOf`, @nodaro/render-rules): the author's photo and everything that carries it, or what a
 * run of the video or of a node made from it left. The workflow's own character definitions follow
 * the same rule: one whose reference picture a node on a creator's photo path draws on, or whose
 * picture is tainted, ships without it (`settings.characterDefinitions[].referenceImageUrl`).
 */
import {
  stripUgcPublishState,
  ugcComposedKey,
  ugcKeepPlan,
  ugcKeepVerdict,
  type UgcKeepReason,
  type UgcKeptChain,
  ugcIsTaintedValue,
  ugcReadComposedGraph,
  ugcStripSet,
  ugcWithTaintedAddresses,
  ugcWithoutTainted,
  type UgcComposedGraph,
  type UgcComposedRead,
  type UgcGraphReaders,
  type UgcPartLoad,
  type UgcStripSet,
  type UgcTaint,
} from "@nodaro/render-rules"
import { supabase } from "./supabase.js"
import { DENIED_NODE_TYPES, OUTBOUND_SELECTOR_FIELDS, isLockedField } from "./outbound-node-lock.js"
import { MAX_SUB_WORKFLOW_DEPTH } from "../services/workflow-engine/types.js"
import { storageUrlPath } from "./key-ownership.js"
import { normalizeLegacyNodeTypes } from "../services/workflow-engine/normalize-node-types.js"
import { proveKeptChain, type KeepJobRow } from "./ugc-template-keep-ledger.js"

interface GraphNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly data?: unknown
}
interface GraphEdge {
  readonly source?: string
  readonly target?: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

const dataOf = (n: GraphNode): Record<string, unknown> =>
  n.data && typeof n.data === "object" && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {}
const ROOT = ugcComposedKey([])

/** PostgREST's "no row" answer to `.single()`: the graph is missing, not the read. */
const NO_ROW = "PGRST116"

/** A sub-workflow node's graph: the owner's own workflow (a missing row, or another owner's, is missing). */
async function loadSubWorkflowPart(referenceId: string, ownerId: string | undefined): Promise<UgcPartLoad> {
  if (!ownerId) return { kind: "missing" }
  const { data, error } = await supabase
    // tenant-scope-ignore: owner-scoped below — a sub-workflow resolves only against its author's own workflows, as a run's does.
    .from("workflows")
    .select("nodes, edges")
    .eq("id", referenceId)
    .eq("user_id", ownerId)
    .single()
  if (error) return (error as { code?: string }).code === NO_ROW ? { kind: "missing" } : { kind: "error" }
  const row = data as { nodes?: unknown; edges?: unknown } | null
  // A row without its graph is no graph read: it fails closed with a missing one.
  if (!row || !Array.isArray(row.nodes)) return { kind: "missing" }
  const nodes = normalizeLegacyNodeTypes(row.nodes as Array<{ id: string; type?: string }>)
  return { kind: "loaded", part: { nodes, edges: Array.isArray(row.edges) ? (row.edges as GraphEdge[]) : [] } }
}

/** A component node's graph: the published snapshot `/v1/component/execute` would run (the same lookup), with its creator. */
async function loadComponentPart(appSlug: string, version: number | undefined): Promise<UgcPartLoad> {
  let query = supabase
    // tenant-scope-ignore: a published component is public by its slug, as the component route reads it.
    .from("published_apps")
    .select("snapshot_nodes, snapshot_edges, creator_id")
    .eq("slug", appSlug)
    .eq("publish_type", "component")
    .eq("is_active", true)
    .is("deleted_at", null)
  query = version ? query.eq("version", version) : query.order("version", { ascending: false }).limit(1)
  const { data, error } = await query
  if (error) return { kind: "error" }
  const row = (Array.isArray(data) ? data[0] : data) as { snapshot_nodes?: unknown; snapshot_edges?: unknown; creator_id?: unknown } | undefined
  // A row without its snapshot is no snapshot read: it fails closed with a missing one.
  if (!row || !Array.isArray(row.snapshot_nodes)) return { kind: "missing" }
  const nodes = normalizeLegacyNodeTypes(row.snapshot_nodes as Array<{ id: string; type?: string }>)
  return {
    kind: "loaded",
    part: {
      nodes,
      edges: Array.isArray(row.snapshot_edges) ? (row.snapshot_edges as GraphEdge[]) : [],
      ...(typeof row.creator_id === "string" && row.creator_id !== "" ? { ownerId: row.creator_id } : {}),
    },
  }
}

const READERS: UgcGraphReaders = { subWorkflow: loadSubWorkflowPart, component: loadComponentPart }

/** A reader that asks again, up to `retries` times, when a load fails with an error (not a missing graph). */
function retrying<A extends unknown[]>(read: (...args: A) => Promise<UgcPartLoad>, retries: number): (...args: A) => Promise<UgcPartLoad> {
  return async (...args: A) => {
    let result = await read(...args)
    for (let i = 0; i < retries && result.kind === "error"; i++) result = await read(...args)
    return result
  }
}

/**
 * The graph and every graph it references, recursively, as the owner's own (see the file comment).
 * With `retryErrors`, a load that fails with an error is asked again that many times first.
 */
export async function loadUgcComposedGraph(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge> | null | undefined,
  ownerId: unknown,
  opts: { readonly retryErrors?: number } = {},
): Promise<UgcComposedRead> {
  const owner = typeof ownerId === "string" && ownerId !== "" ? ownerId : undefined
  const retries = opts.retryErrors ?? 0
  const readers: UgcGraphReaders = retries > 0 ? { subWorkflow: retrying(loadSubWorkflowPart, retries), component: retrying(loadComponentPart, retries) } : READERS
  return ugcReadComposedGraph(nodes, edges ?? [], readers, { maxDepth: MAX_SUB_WORKFLOW_DEPTH, ...(owner ? { ownerId: owner } : {}) })
}

/**
 * Where an outbound node sends or fetches (its locked destination fields, `outbound-node-lock.ts`):
 * kept on a node that is only made from the video — where the app posts is the app's — and never on
 * one whose value can flow into a creator's photo (`stripUgcPublishState` decides which).
 */
function keepDestination(type: string, key: string): boolean {
  return DENIED_NODE_TYPES.has(type) && (isLockedField(key) || OUTBOUND_SELECTOR_FIELDS.has(key))
}

/**
 * One graph of a composed read as it ships: stripped by its part of the strip set (`key`, the path
 * that leads to it). A part the read does not know FAILS CLOSED: every node ships empty. With no
 * set at all, the set is read on this graph alone.
 */
export function ugcStripPart<T extends GraphNode>(
  nodes: readonly T[],
  edges: ReadonlyArray<GraphEdge> | null | undefined,
  sets: UgcStripSet | undefined,
  key: string,
  keep?: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): T[] {
  if (!sets) return stripUgcPublishState(nodes, edges ?? [], { keepSetting: keepDestination })
  const known = sets.strip.get(key)
  if (!known) {
    const every = new Set(nodes.flatMap((n) => (typeof n.id === "string" ? [n.id] : [])))
    return stripUgcPublishState(nodes, edges ?? [], { strip: every, photo: every, keepSetting: keepDestination })
  }
  return stripUgcPublishState(nodes, edges ?? [], {
    strip: known,
    photo: sets.photo.get(key) ?? new Set(),
    sinks: sets.sinks?.get(key),
    taint: sets.taint,
    keepSetting: keepDestination,
    ...(keep && keep.size > 0 && key === ROOT ? { keep } : {}),
  })
}

/** Every string a value holds, at any depth. */
function strings(value: unknown, into: Set<string>, depth = 0): Set<string> {
  if (typeof value === "string") into.add(value.trim())
  else if (depth <= 8 && value && typeof value === "object") for (const item of Array.isArray(value) ? value : Object.values(value)) strings(item, into, depth + 1)
  return into
}

/** A workflow-level character definition: its id, and the reference picture a node can draw on. */
type CharacterDefinition = Record<string, unknown> & { readonly id?: unknown; readonly referenceImageUrl?: unknown }

/** The workflow's character definitions (`settings.characterDefinitions`). */
function characterDefinitionsOf(settings: Record<string, unknown> | null | undefined): CharacterDefinition[] {
  const list = settings?.characterDefinitions
  return Array.isArray(list) ? list.filter((d): d is CharacterDefinition => !!d && typeof d === "object" && !Array.isArray(d)) : []
}

/**
 * The character definitions whose picture is tainted: one a node on a creator's photo path names —
 * any value of its equal to the definition's id, a generator's `characterDefinitionIds` or a Scene's
 * characters — or whose picture is a tainted value itself.
 */
function taintedDefinitionIds(composed: UgcComposedGraph, sets: UgcStripSet, definitions: readonly CharacterDefinition[], taint: UgcTaint | undefined): Set<string> {
  const named = new Set<string>()
  for (const [key, ids] of sets.photo) {
    const part = composed.get(key)
    for (const node of part?.nodes ?? []) if (typeof node.id === "string" && ids.has(node.id)) strings(dataOf(node), named)
  }
  const out = new Set<string>()
  for (const definition of definitions) {
    if (typeof definition.id !== "string") continue
    const picture = typeof definition.referenceImageUrl === "string" ? definition.referenceImageUrl : ""
    if (named.has(definition.id) || (picture !== "" && (!taint || ugcIsTaintedValue(taint, picture)))) out.add(definition.id)
  }
  return out
}

/** The object an address names on our own storage, on any of its hosts (`storageUrlPath`), or null. */
function ourStorageKey(address: string): string | null {
  const where = storageUrlPath(address)
  return where.kind === "ours" ? where.path : null
}

/** The owner's jobs among `ids`, for the kept run's proof (`proveKeptChain`). A failed read throws. */
async function readOwnerJobs(ids: readonly string[], owner: string): Promise<readonly KeepJobRow[]> {
  const { data, error } = await supabase
    // tenant-scope-ignore: owner-scoped below — the proof reads only the template author's own jobs.
    .from("jobs")
    .select("id, user_id, status, input_data, output_data")
    .in("id", [...ids])
    .eq("user_id", owner)
  if (error) throw new UgcGraphReadError()
  return (data ?? []) as KeepJobRow[]
}

/** What a template's kept run came to (`keepRunResults`). */
export interface UgcKeptResults {
  readonly included: boolean
  readonly reason?: UgcKeepReason
  /** A kept render to fall back on as the preview: the first proven video's last finish render (its copy). */
  readonly previewUrl?: string
}

/** Every string of `value` equal to a key of `to`, replaced by its value; anything else as it is. */
function rewritten(value: unknown, to: ReadonlyMap<string, string>, depth = 0): unknown {
  if (typeof value === "string") return to.get(value) ?? value
  if (depth > 8 || !value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => rewritten(item, to, depth + 1))
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewritten(v, to, depth + 1)]))
}

/** A composed read that failed with an error: a publish answers a retryable error and writes nothing. */
export class UgcGraphReadError extends Error {
  constructor() {
    super("A graph this workflow references could not be read")
    this.name = "UgcGraphReadError"
  }
}

/** A workflow as anyone but its author receives it, with what was read to get there. */
export interface UgcPublishedGraph<T> {
  /** The workflow's nodes as they ship. */
  readonly nodes: T[]
  /** The strip set over the composed graph, graph by graph (`ugcComposedKey` of the path): what a run strips each graph it loads by. */
  readonly sets: UgcStripSet
  /**
   * A copy of a node's field kept beside the graph (a component's exposed setting's default): for a
   * node that ships empty, what the node ships with; for any other node, the copy as it is.
   */
  readonly shippedValue: (nodeId: string, field: string, copy: unknown) => unknown
  /** How many referenced graphs the read loaded. */
  readonly loads: number
  /** Whether a referenced graph failed to load with an error (and was read as holding a UGC video). */
  readonly readFailed: boolean
  /** The workflow's settings as they ship (`opts.settings`): a tainted character definition without its picture. */
  readonly settings: Record<string, unknown> | null | undefined
  /** The workflow's nodes as they ship WITHOUT a kept run: what a listing is priced on. The same array when nothing is kept. */
  readonly pricedNodes: T[]
  /** With `keepRunResults`: whether a proven run's values ship, and why not. */
  readonly kept?: UgcKeptResults
}

/**
 * A TEMPLATE's kept example run (design: UGC templates with data). Only the template publish route
 * passes it (a guard test holds that). Without `copy` it is a dry run (the dialog's check).
 */
export interface UgcKeepRunResults {
  /** Copies one kept address to the template's own storage; returns the copy's address. A failure throws. */
  readonly copy?: (address: string) => Promise<string>
}

/**
 * The ONE funnel (see the file comment): read the composed graph, its strip set, strip. With
 * `failOnError`, a read that failed with an error throws `UgcGraphReadError` instead. With
 * `settings` (the workflow's), the settings ship with every tainted character definition's picture
 * gone, and those pictures are tainted wherever else they appear.
 */
export async function ugcPublishedGraph<T extends GraphNode>(
  nodes: readonly T[],
  edges: ReadonlyArray<GraphEdge> | null | undefined,
  ownerId: unknown,
  opts: {
    readonly failOnError?: boolean
    readonly settings?: Record<string, unknown> | null
    readonly retryErrors?: number
    readonly keepRunResults?: UgcKeepRunResults
  } = {},
): Promise<UgcPublishedGraph<T>> {
  const read = await loadUgcComposedGraph(nodes, edges, ownerId, { retryErrors: opts.retryErrors })
  if (read.failed && opts.failOnError) throw new UgcGraphReadError()
  const base = ugcStripSet(read.graph, read.opaque, { storage: ourStorageKey })
  const definitions = characterDefinitionsOf(opts.settings)
  const taintedDefinitions = taintedDefinitionIds(read.graph, base, definitions, base.taint)
  const pictures = definitions.flatMap((d) => (typeof d.id === "string" && taintedDefinitions.has(d.id) && typeof d.referenceImageUrl === "string" ? [d.referenceImageUrl] : []))
  const sets: UgcStripSet = base.taint && pictures.length > 0 ? { ...base, taint: ugcWithTaintedAddresses(base.taint, pictures) } : base
  const settings = taintedDefinitions.size === 0 || !opts.settings
    ? opts.settings
    : {
        ...opts.settings,
        characterDefinitions: (opts.settings.characterDefinitions as unknown[]).map((d) => {
          if (!d || typeof d !== "object" || Array.isArray(d)) return d
          const { referenceImageUrl: _picture, ...rest } = d as CharacterDefinition
          return typeof (d as CharacterDefinition).id === "string" && taintedDefinitions.has((d as CharacterDefinition).id as string) ? rest : d
        }),
      }
  const strip = sets.strip.get(ROOT) ?? new Set<string>()
  const stripped = ugcStripPart(nodes, edges, sets, ROOT)
  const kept = opts.keepRunResults ? await keptRun(nodes, edges, ownerId, sets, opts.keepRunResults) : undefined
  const shipped = kept?.keep ? ugcStripPart(nodes, edges, sets, ROOT, kept.keep) : stripped
  return {
    nodes: shipped,
    pricedNodes: stripped,
    ...(kept ? { kept: kept.results } : {}),
    sets,
    shippedValue: (nodeId, field, copy) => {
      if (!strip.has(nodeId)) return sets.taint ? ugcWithoutTainted(copy, sets.taint) : copy
      const shipped = stripped.find((node) => node.id === nodeId)
      return shipped ? dataOf(shipped)[field] : undefined
    },
    loads: read.loads,
    readFailed: read.failed,
    settings,
  }
}

/**
 * The kept run (see `UgcKeepRunResults`): layer 1 on the workflow's own graph, the ledger's proof per
 * video, then the proven videos' values, each kept address replaced by its copy. A video not proven
 * keeps nothing; a read that fails throws.
 */
async function keptRun<T extends GraphNode>(
  nodes: readonly T[],
  edges: ReadonlyArray<GraphEdge> | null | undefined,
  ownerId: unknown,
  sets: UgcStripSet,
  how: UgcKeepRunResults,
): Promise<{ results: UgcKeptResults; keep?: Map<string, Readonly<Record<string, unknown>>> }> {
  const owner = typeof ownerId === "string" ? ownerId : ""
  const plan = ugcKeepPlan(nodes as ReadonlyArray<GraphNode>, edges ?? [], {
    photo: sets.photo.get(ROOT),
    sinks: sets.sinks?.get(ROOT),
    storage: ourStorageKey,
  })
  const chains: UgcKeptChain[] = []
  for (const chain of plan.chains) {
    const proven = chain.proven && (await proveKeptChain(chain, owner, { readJobs: readOwnerJobs, storageKey: ourStorageKey }))
    chains.push(proven ? chain : chain.proven ? { clipsId: chain.clipsId, proven: false, reason: "unverified" } : chain)
  }
  const verdict = ugcKeepVerdict(chains)
  const proven = chains.filter((c) => c.proven && c.values && c.claims)
  if (proven.length === 0) return { results: verdict }
  // Every kept address, copied once (a dry run copies nothing).
  const addresses = [...new Set(proven.flatMap((c) => [c.claims!.creatorImage, ...c.claims!.takes, ...c.claims!.finishes.map((f) => f.url)]))]
  const to = new Map<string, string>()
  if (how.copy) for (const address of addresses) to.set(address, await how.copy(address))
  const keep = new Map<string, Readonly<Record<string, unknown>>>()
  for (const chain of proven) for (const [id, values] of chain.values!) keep.set(id, rewritten(values, to) as Record<string, unknown>)
  // The preview to fall back on: the first proven video's output the app shows, else its last render.
  const finishes = proven[0]!.claims!.finishes
  const shown = finishes.find((f) => dataOf(nodes.find((n) => n.id === f.nodeId) ?? {}).presentationOutput === true) ?? finishes.at(-1)
  return { results: { ...verdict, ...(shown ? { previewUrl: to.get(shown.url) ?? shown.url } : {}) }, keep }
}
