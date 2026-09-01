import { MODEL_CATALOG, LLM_MODELS } from "@nodaro/shared"

/**
 * Admin availability overrides (B5) — the RUNTIME layer of the three-layer
 * node/model availability funnel that lib/surface-deny.ts resolves:
 *
 *   1. code/edition   — what this build ships (edition gates stay their own
 *                       layer: cloud-only-nodes etc. apply regardless).
 *   2. surface profile — the deployment's FACTORY set: `nodes.allow` /
 *                       `models.allow` (non-empty ⇒ whitelist) minus
 *                       `nodes.deny` / `models.deny`.
 *   3. admin override  — a DB-stored enabled-set per kind that REPLACES layer
 *                       2 while present. "Reset to factory" deletes the row.
 *
 * The override is stored in `availability_overrides` (migration 361, service
 * -role only) and cached in-process: reads are SYNC (isNodeDenied sits on hot
 * paths), refreshed lazily on a 60s TTL (app-settings pattern) and updated
 * immediately on an in-process admin save. Boot calls
 * loadAvailabilityOverrides() once so the first request already sees the
 * stored state; a load failure degrades to the FACTORY set, loudly — the
 * profile whitelist is the deployment's safe baseline, so degrading to it
 * narrows rather than widens.
 *
 * GATEABLE UNIVERSES. Allow-lists and overrides INVERT membership ("not in
 * the set ⇒ denied"), so they are scoped to the ids an operator can actually
 * see and toggle — otherwise a whitelist would silently deny workflow-internal
 * types it never listed. Utility nodes (sticky-note, preview, …) are exempt
 * from inversion entirely: they cost nothing, dispatch nothing, and a
 * whitelist that forgot "sticky-note" must not break canvas annotations.
 * Explicit `deny` entries still apply to anything, utility included.
 */

export type AvailabilityKind = "nodes" | "models"

/**
 * Node types an allow-list / override can gate (registry minus utility).
 *
 * Filled LAZILY via dynamic import: node-registry.ts statically imports
 * `ee/billing/credits.js`, and a static import here drags that chain into
 * every module that reaches surface-deny — which breaks tests that vi.mock
 * the credits module (mock-factory hoisting sees the real module first) and
 * would also tighten the core→ee coupling. The set is the SAME object
 * forever (filled in place), exported ReadonlySet; it is complete before the
 * first request because loadAvailabilityOverrides (awaited at boot) awaits
 * the fill. Until filled, allow-inversion is inert — which only ever
 * over-shows, never over-denies, and only inside boot.
 */
const gateableNodeTypes = new Set<string>()
export const GATEABLE_NODE_TYPES: ReadonlySet<string> = gateableNodeTypes

const nodeUniverseReady: Promise<void> = import("./node-registry.js")
  .then((m) => {
    for (const n of m.NODE_REGISTRY) if (n.category !== "utility") gateableNodeTypes.add(n.type)
  })
  .catch((err) => {
    console.error("[availability-override] node universe load failed — allow-inversion stays inert:", (err as Error).message)
  })

/** Test hook: await the lazy universe fill before asserting on GATEABLE sets. */
export function __availabilityUniverseReadyForTests(): Promise<void> {
  return nodeUniverseReady
}

/** supabase.js pulls the full config at module scope — deferred for the same
 *  reason as node-registry: keep the surface-deny import chain featherweight
 *  so route/middleware unit tests can mock config/credits without dragging
 *  this module's dependencies in first. */
async function db() {
  const { supabase } = await import("./supabase.js")
  return supabase
}

/** Model ids an allow-list / override can gate (generation catalog + LLMs). */
export const GATEABLE_MODEL_IDS: ReadonlySet<string> = new Set([
  ...Object.keys(MODEL_CATALOG),
  ...LLM_MODELS.map((m) => m.id),
])

const CACHE_TTL_MS = 60_000

interface OverrideCache {
  nodes: ReadonlySet<string> | null
  models: ReadonlySet<string> | null
}

let cache: OverrideCache = { nodes: null, models: null }
let cacheLoadedAt = 0
let everLoaded = false
let inflight: Promise<void> | null = null

async function refresh(): Promise<void> {
  const { data, error } = await (await db()).from("availability_overrides").select("kind, enabled")
  if (error) {
    // Degrade to what we have (or factory when never loaded) — and say so.
    console.error("[availability-override] load failed — serving factory/stale sets:", error.message)
    return
  }
  const next: OverrideCache = { nodes: null, models: null }
  for (const row of data ?? []) {
    if ((row.kind === "nodes" || row.kind === "models") && Array.isArray(row.enabled)) {
      next[row.kind as AvailabilityKind] = new Set(row.enabled.filter((x: unknown): x is string => typeof x === "string"))
    }
  }
  cache = next
  cacheLoadedAt = Date.now()
  everLoaded = true
}

/**
 * Boot / explicit load. Awaits the (local, fast) universe fill, then KICKS
 * the DB read without blocking on it: a dead or slow settings DB must never
 * hang boot (nor a test harness with stub credentials). Until the read lands,
 * requests serve the surface profile's FACTORY set — the same guarantee class
 * as the 60s TTL drift between sibling instances, and the factory set is the
 * deployment's safe baseline. The background TTL refresh keeps retrying.
 */
export async function loadAvailabilityOverrides(): Promise<void> {
  await nodeUniverseReady
  if (inflight) return
  inflight = refresh().finally(() => {
    inflight = null
  })
}

/** Test hook: await the in-flight DB read (tests that need loaded state). */
export function __awaitAvailabilityRefreshForTests(): Promise<void> {
  return inflight ?? Promise.resolve()
}

/**
 * SYNC read of the override for a kind (null = no override → factory). A
 * stale cache triggers a background refresh; the sync answer never blocks.
 */
export function availabilityOverride(kind: AvailabilityKind): ReadonlySet<string> | null {
  if (everLoaded && Date.now() - cacheLoadedAt > CACHE_TTL_MS && !inflight) {
    void loadAvailabilityOverrides()
  }
  return cache[kind]
}

/** Test hook: with args, inject an override cache; with none, restore the
 *  pristine never-loaded state (no background refresh fires). */
export function __resetAvailabilityOverridesForTests(next?: Partial<OverrideCache>): void {
  cache = { nodes: null, models: null, ...next }
  cacheLoadedAt = Date.now()
  everLoaded = next !== undefined
}

/**
 * Persist an override (admin PUT). `enabled: null` deletes the row — reset to
 * factory. Ids outside the gateable universe are dropped (a typo must not
 * linger invisibly in the stored set). Updates the in-process cache
 * immediately; sibling instances converge on the 60s TTL.
 */
export async function saveAvailabilityOverride(kind: AvailabilityKind, enabled: readonly string[] | null): Promise<void> {
  if (enabled === null) {
    const { error } = await (await db()).from("availability_overrides").delete().eq("kind", kind)
    if (error) throw new Error(`availability override reset failed: ${error.message}`)
    cache = { ...cache, [kind]: null }
    return
  }
  const universe = kind === "nodes" ? GATEABLE_NODE_TYPES : GATEABLE_MODEL_IDS
  const cleaned = [...new Set(enabled.filter((id) => universe.has(id)))]
  const { error } = await (await db())
    .from("availability_overrides")
    .upsert({ kind, enabled: cleaned, updated_at: new Date().toISOString() }, { onConflict: "kind" })
  if (error) throw new Error(`availability override save failed: ${error.message}`)
  cache = { ...cache, [kind]: new Set(cleaned) }
}
