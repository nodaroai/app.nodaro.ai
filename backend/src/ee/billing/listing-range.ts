import { canonicalExposedFieldKey } from "@nodaro/shared/apps"
import { normalizeNodeModelParams } from "@nodaro/shared/nodes"
import { extractAppInputSchema } from "../../lib/mcp/extract-app-inputs.js"
import type { AppListingEstimate, EstimateNode } from "./credits.js"

/**
 * A published listing's "up to" figure (decided 2026-10-14): the most a run can
 * cost over the choices the app's user has — every exposed field, at the
 * publisher's restricted values (`allowedValues`) where set, else every value
 * the field takes (the strip-derived and hand-declared tables `get_app_inputs`
 * types it by; a toggle both ways; a numeric range at its ends). A media input
 * the user supplies is already priced at its worst case by the listing itself
 * (a Seedance reference clip, a recording's length per minute).
 *
 * Each combination is normalized per model the way the run normalizes it
 * (`normalizeNodeModelParams`), so a value one model does not take is priced
 * as what that model would run — "evaluate per allowed model".
 *
 * Bounded: up to {@link LISTING_RANGE_MAX_COMBINATIONS} combinations are priced
 * exhaustively. Past that, for each combination of the MODEL fields (a model
 * picks the others' lists) every other field is taken, one at a time, at the
 * value that prices highest given the picks so far. A price rises with each
 * lever on its own (a longer clip, a higher resolution, a dearer model), so this
 * finds the top of independent fields exactly; two levers whose effect depends
 * on each other beyond the model may be under-explored there (documented).
 *
 * Every part of the listing is maximized on its own (fixed, per minute, per
 * item), over every combination priced, and never below the saved settings:
 * the "up to" is an upper bound on what a run can be charged.
 */
export const LISTING_RANGE_MAX_COMBINATIONS = 256

/** Fields that name the node's model: they decide the others' lists, so they are explored first and together. */
const MODEL_FIELD_KEYS = new Set(["provider", "providers", "llmModel", "model", "engine", "ttsModel"])

export interface ListingFieldDomain {
  readonly nodeId: string
  /** The node-data key a choice writes (canonical spelling). */
  readonly field: string
  readonly values: ReadonlyArray<unknown>
  readonly model: boolean
}

/** The exposed fields whose choice can move a price, each with every value it can take. */
export function listingFieldDomains(
  snapshotSettings: Record<string, unknown> | null | undefined,
  nodes: ReadonlyArray<EstimateNode>,
): ListingFieldDomain[] {
  if (!snapshotSettings) return []
  const withIds = nodes.filter((n): n is EstimateNode & { id: string } => typeof n.id === "string")
  const { fields, keyMap } = extractAppInputSchema({
    snapshotSettings,
    snapshotNodes: withIds.map((n) => ({ id: n.id, type: n.type, data: (n.data ?? {}) as Record<string, unknown> })),
  })
  const typeById = new Map(withIds.map((n) => [n.id, n.type]))
  const out: ListingFieldDomain[] = []
  const seen = new Set<string>()
  for (const f of fields) {
    const target = keyMap[f.key]
    if (!target) continue
    let values: ReadonlyArray<unknown> | undefined
    if (f.type === "select" && f.options && f.options.length > 0) values = f.options
    else if (f.type === "boolean") values = [true, false]
    else if (f.type === "number" && f.min !== undefined && f.max !== undefined) values = [...new Set([...(f.options ?? []), f.min, f.max])]
    if (!values || values.length < 1) continue
    const field = canonicalExposedFieldKey(typeById.get(target.nodeId) ?? "", target.fieldKey)
    const id = `${target.nodeId}\u0000${field}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ nodeId: target.nodeId, field, values, model: MODEL_FIELD_KEYS.has(field) })
  }
  // Model fields first: they decide what the others can take.
  return [...out.filter((d) => d.model), ...out.filter((d) => !d.model)]
}

type Choice = ReadonlyMap<number, unknown>

/** The nodes with `choice` written into them, normalized per model as the run normalizes them. */
function applyChoice(nodes: ReadonlyArray<EstimateNode>, domains: ReadonlyArray<ListingFieldDomain>, choice: Choice): EstimateNode[] {
  const patches = new Map<string, Record<string, unknown>>()
  for (const [i, value] of choice) {
    const d = domains[i]!
    patches.set(d.nodeId, { ...(patches.get(d.nodeId) ?? {}), [d.field]: value })
  }
  const applied = nodes.map((n) => {
    const patch = n.id ? patches.get(n.id) : undefined
    if (!patch) return n
    // A single model chosen for a node that saved several runs that one model.
    const data = { ...(n.data ?? {}), ...patch }
    if ("provider" in patch && Array.isArray(data.providers)) delete data.providers
    return { ...n, data }
  })
  return normalizeNodeModelParams(applied).nodes as EstimateNode[]
}

const PARTS = ["preview", "final", "previewPerMinute", "finalPerMinute", "previewPerItem", "finalPerItem"] as const

/** One figure to compare combinations by: the fixed price plus a typical hour and one further item. */
function weight(e: AppListingEstimate): number {
  return e.preview + e.final + 60 * (e.previewPerMinute + e.finalPerMinute) + (e.previewPerItem ?? 0) + (e.finalPerItem ?? 0)
}

/** Each part's largest value over the given estimates. */
function partwiseMax(all: ReadonlyArray<AppListingEstimate>): AppListingEstimate {
  const top: Record<string, number> = {}
  for (const part of PARTS) top[part] = Math.max(0, ...all.map((e) => e[part] ?? 0))
  return {
    preview: top.preview!, final: top.final!, previewPerMinute: top.previewPerMinute!, finalPerMinute: top.finalPerMinute!,
    ...(top.previewPerItem! > 0 ? { previewPerItem: top.previewPerItem } : {}),
    ...(top.finalPerItem! > 0 ? { finalPerItem: top.finalPerItem } : {}),
  }
}

function product(sizes: ReadonlyArray<number>): number {
  return sizes.reduce((p, n) => (p > Number.MAX_SAFE_INTEGER / Math.max(n, 1) ? Number.MAX_SAFE_INTEGER : p * n), 1)
}

/** Every combination of the domains at `indices`, as choices. */
function combinations(domains: ReadonlyArray<ListingFieldDomain>, indices: ReadonlyArray<number>): Choice[] {
  let out: Array<Map<number, unknown>> = [new Map()]
  for (const i of indices) {
    const next: Array<Map<number, unknown>> = []
    for (const c of out) for (const v of domains[i]!.values) next.push(new Map(c).set(i, v))
    out = next
  }
  return out
}

/**
 * The listing's "up to": each part's largest value over the combinations of
 * `domains`, never below `floor` (the saved settings). `price` prices a graph.
 */
export function listingCeiling(
  nodes: ReadonlyArray<EstimateNode>,
  domains: ReadonlyArray<ListingFieldDomain>,
  floor: AppListingEstimate,
  price: (nodes: ReadonlyArray<EstimateNode>) => AppListingEstimate,
): AppListingEstimate {
  if (domains.length === 0) return floor
  const priced: AppListingEstimate[] = [floor]
  const evaluate = (choice: Choice): AppListingEstimate => {
    const e = price(applyChoice(nodes, domains, choice))
    priced.push(e)
    return e
  }
  const all = domains.map((_, i) => i)
  if (product(domains.map((d) => d.values.length)) <= LISTING_RANGE_MAX_COMBINATIONS) {
    for (const choice of combinations(domains, all)) evaluate(choice)
    return partwiseMax(priced)
  }
  // Per model combination (all of them while they fit, else the model fields
  // greedily too), every other field at its priciest value given the picks so far.
  const modelIdx = all.filter((i) => domains[i]!.model)
  const otherIdx = all.filter((i) => !domains[i]!.model)
  const modelChoices = product(modelIdx.map((i) => domains[i]!.values.length)) <= LISTING_RANGE_MAX_COMBINATIONS
    ? combinations(domains, modelIdx)
    : [new Map<number, unknown>()]
  const greedyIdx = modelChoices.length === 1 && modelIdx.length > 0 && !modelChoices[0]!.size ? all : otherIdx
  for (const start of modelChoices) {
    const picks = new Map(start)
    for (const i of greedyIdx) {
      let best: { value: unknown; w: number } | undefined
      for (const value of domains[i]!.values) {
        const w = weight(evaluate(new Map(picks).set(i, value)))
        if (!best || w > best.w) best = { value, w }
      }
      picks.set(i, best!.value)
    }
    evaluate(picks)
  }
  return partwiseMax(priced)
}
