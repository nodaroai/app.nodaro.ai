/**
 * WHICH NODES CAN RUN A CATALOG MODEL (decided 2026-11-16), so that on a
 * deployment that restricts what it offers, `list_models` lists a model only
 * where something offered to the session can run it: a deployment that offers
 * no music node lists no music model.
 *
 * DERIVED, never hand-listed. A node type runs a catalog model when:
 *  1. its registry entry lists the model as a provider (`NODE_REGISTRY`
 *     `providers`, what `GET /v1/nodes` serves — the plugin engines' lists
 *     included);
 *  2. the shared model tree creates that node for the model (`modelToNodeTarget`:
 *     a provider enum the model is in, else the catalog's modes);
 *  3. a job the node's route runs resolves the request to that model, as its
 *     handler decides (`RESOLVED_MODEL_OF_JOB`, the route's node through
 *     `routeNodeGate`, the run's own door): the job's default model, the
 *     version code a request names (`model: "V5"` → `suno-v5`), or any model a
 *     request names (`provider`) of the kind its default is and sharing one of
 *     its default's modes (an entity's sheet runs every text-to-image model,
 *     its motion every image-to-video one);
 *  4. it runs the text-to-image model whose image-to-image variant the model
 *     is (`T2I_TO_I2I_VARIANT`: Generate Image runs the variant when it is
 *     given a picture).
 * The rules lean to listing: a model any of them gives a node is listed while
 * that node is offered. A model none of them gives a node is kept, never
 * dropped, and named in `NO_DERIVABLE_NODE` with why (held both ways by
 * `__tests__/model-run-nodes.test.ts`).
 *
 * WITH NOTHING RESTRICTED nothing here runs: there is no offer, and
 * `list_models` lists exactly what it always did.
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { T2I_TO_I2I_VARIANT, modelToNodeTarget } from "@nodaro/shared/models"
import { nodeUniverseLoaded } from "../availability-override.js"
import { routeNodeGate } from "../route-node-gate.js"
import type { ToolOffer } from "./tool-offer.js"

/**
 * Catalog models no rule gives a node: kept wherever they are otherwise
 * offered (a model is never dropped for want of a mapping), each with why.
 */
export const NO_DERIVABLE_NODE: Readonly<Record<string, string>> = Object.freeze({
  "video-audit": "the Video Audit node's own model; its mode is left out of the model tree on purpose, so it never reaches a picker",
  "video-audit-auto": "the Video Audit node's automatic tier; its mode is left out of the model tree on purpose, so it never reaches a picker",
})

type Catalog = typeof MODEL_CATALOG
type CatalogEntry = Catalog[string]

/** The node types `route` runs for `body`, as the run's door resolves them; none for a route it cannot tell. */
function routeNodes(route: string, body: Readonly<Record<string, unknown>>): readonly string[] {
  const gate = routeNodeGate(route, body)
  return gate.kind === "node" ? gate.types : []
}

/** Whether `m` is of `like`'s kind and shares one of its modes. */
function sameKindAndMode(m: CatalogEntry, like: CatalogEntry): boolean {
  return m.kind === like.kind && m.modes.some((mode) => like.modes.includes(mode))
}

/** How each job decides the model it runs, from its payload (`RESOLVED_MODEL_OF_JOB`). */
export type JobModelResolvers = Readonly<Record<string, (d: Record<string, unknown>) => string | undefined>>

/** Rule 3: the nodes whose job, as its handler decides, runs `m`. */
function jobNodes(m: CatalogEntry, catalog: Catalog, jobs: JobModelResolvers): string[] {
  const out: string[] = []
  for (const [job, resolve] of Object.entries(jobs)) {
    const fallback = resolve({})
    const like = fallback === undefined ? undefined : catalog[fallback]
    const runs =
      fallback === m.id ||
      (typeof m.dataValue === "string" && resolve({ model: m.dataValue }) === m.id) ||
      (like !== undefined && resolve({ provider: m.id }) === m.id && sameKindAndMode(m, like))
    if (runs) out.push(...routeNodes(`/v1/${job}`, { provider: m.id }))
  }
  return out
}

/** Every catalog model's nodes, rules 1–4. */
export function deriveModelRunNodes(
  registry: ReadonlyArray<{ type: string; providers?: readonly string[] }>,
  jobs: JobModelResolvers,
  catalog: Catalog = MODEL_CATALOG,
): Map<string, Set<string>> {
  const nodes = new Map<string, Set<string>>()
  const add = (id: string, types: Iterable<string>) => {
    if (!Object.hasOwn(catalog, id)) return
    const set = nodes.get(id) ?? new Set<string>()
    for (const t of types) set.add(t)
    if (set.size > 0) nodes.set(id, set)
  }
  for (const d of registry) for (const p of d.providers ?? []) add(p, [d.type])
  for (const m of Object.values(catalog)) {
    const target = modelToNodeTarget(m.id)
    if (target) add(m.id, [target.nodeType])
    add(m.id, jobNodes(m, catalog, jobs))
  }
  for (const [t2i, i2i] of Object.entries(T2I_TO_I2I_VARIANT)) add(i2i, nodes.get(t2i) ?? [])
  return nodes
}

let derived: Promise<ReadonlyMap<string, ReadonlySet<string>>> | null = null

/**
 * The derived table, built once per process on first use. The node registry
 * and the jobs' resolvers are loaded here, on a restricted deployment's first
 * `list_models`, never on the path a deployment that restricts nothing takes.
 */
export function modelRunNodes(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  if (derived) return derived
  const table = Promise.all([import("../node-registry.js"), import("../job-resolved-model.js")]).then(([{ NODE_REGISTRY }, { RESOLVED_MODEL_OF_JOB }]) =>
    deriveModelRunNodes(NODE_REGISTRY, RESOLVED_MODEL_OF_JOB),
  )
  // A route's node is told by name only once the node universe is known
  // (route-node-gate.ts): before that the table is used, never kept.
  if (nodeUniverseLoaded()) derived = table
  return table
}

/**
 * Whether `list_models` lists the catalog model `id` to a session with this
 * offer: the deployment offers the model, and a node the session is offered
 * runs it (or no rule gives it a node: `NO_DERIVABLE_NODE`). Null where
 * nothing is restricted: every model the catalog filters let through is listed.
 */
export async function modelListedTo(offer: ToolOffer | undefined): Promise<((id: string) => boolean) | null> {
  if (!offer) return null
  const table = await modelRunNodes()
  return (id) => {
    if (!offer.modelOffered(id)) return false
    const types = table.get(id)
    if (!types) return true
    for (const t of types) if (offer.nodeOffered(t)) return true
    return false
  }
}
