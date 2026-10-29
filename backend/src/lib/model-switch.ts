/**
 * The admin's model switch — the FOURTH layer of the node/model availability
 * funnel lib/surface-deny.ts resolves (after code/edition, the surface
 * profile and the admin availability override).
 *
 * A model's pricing row carries `model_pricing.is_enabled`, flipped on the
 * admin models page. The credit check already refuses a run of a switched-off
 * model; this module makes the switch also HIDE the model — from
 * `GET /v1/models`, MCP `list_models`, the editor's model menus (through
 * `GET /v1/surface/availability`) and every other chokepoint `isModelDenied`
 * guards — because a model nobody can run has no business in a menu.
 *
 * The shape mirrors availability-override.ts, for the same reasons:
 * `isModelDenied` is SYNC and sits on hot paths (the credit-guard door, the
 * orchestrator's payload builder), so the set is an in-process cache: loaded
 * at boot (kicked, never awaited — a slow settings DB must not hang boot),
 * refreshed on a 60s TTL, updated at once by every in-process writer of the
 * switch (`noteModelSwitch`), with sibling instances converging on the TTL. A
 * process that never booted the app (the standalone orchestrator) kicks its
 * own load on the first ask. Until a load lands nothing is switched off —
 * the same posture as the override's factory fallback, and the credit check
 * still refuses the run.
 *
 * EXACT identifiers. A switched-off `flux-flex:2K` row hides nothing: the
 * model is its base-id row, and a composite row's switch keeps refusing at
 * run through the credit check's own code (`model_disabled`).
 *
 * Import chain: like availability-override.ts, nothing from `ee/`, no
 * `lib/config.js`, and supabase only through a deferred import — many route
 * suites mock those and reach surface-deny first.
 */

const CACHE_TTL_MS = 60_000

let switchedOff: ReadonlySet<string> = new Set()
let loadedAt = 0
let everLoaded = false
let inflight: Promise<void> | null = null
/** When the last background load was KICKED — the retry throttle for a load
 *  that keeps failing or has never succeeded. */
let lastKickAt = 0
/** Bumped by every in-process write (`noteModelSwitch`): a refresh that was
 *  already reading when an admin flipped a switch must not land its older
 *  rows over the flip — it would undo the switch for a whole TTL. */
let generation = 0

async function db() {
  const { supabase } = await import("./supabase.js")
  return supabase
}

async function refresh(): Promise<void> {
  const readAt = generation
  let rows: Array<{ model_identifier?: unknown }> | null
  try {
    const { data, error } = await (await db()).from("model_pricing").select("model_identifier").eq("is_enabled", false)
    if (error) throw new Error(error.message)
    rows = data
  } catch (err) {
    // Degrade to what we have (nothing switched off when never loaded) — and
    // say so. A throw (the client failing to build, a network error) lands
    // here too: a kicked, never-awaited load must never become an unhandled
    // rejection.
    console.error(
      "[model-switch] load failed — serving the last known switches:",
      err instanceof Error ? err.message : String(err),
    )
    return
  }
  if (generation !== readAt) {
    // A switch was flipped here while the rows were in flight: the flip is
    // newer than what was read. Keep it; the next TTL refresh reads the row.
    loadedAt = Date.now()
    everLoaded = true
    return
  }
  switchedOff = new Set(
    (rows ?? [])
      .map((row) => row.model_identifier)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
  )
  loadedAt = Date.now()
  everLoaded = true
}

/**
 * Boot / explicit load: KICKS the DB read without blocking on it. Until the
 * read lands no model reads as switched off; the background TTL refresh keeps
 * retrying.
 */
export async function loadSwitchedOffModels(): Promise<void> {
  if (inflight) return
  inflight = refresh().finally(() => {
    inflight = null
  })
}

/** Test hook: await the in-flight DB read. */
export function __awaitModelSwitchRefreshForTests(): Promise<void> {
  return inflight ?? Promise.resolve()
}

/**
 * SYNC: is this exact identifier switched off on its pricing row? A stale
 * cache (or a process that never loaded one) kicks a background refresh,
 * throttled to one per TTL; the sync answer never blocks. Skipped under
 * Vitest, where the pristine never-loaded state must not reach for a database.
 */
export function isModelSwitchedOff(id: string): boolean {
  const now = Date.now()
  const due = everLoaded ? now - loadedAt > CACHE_TTL_MS : !process.env.VITEST
  if (due && !inflight && now - lastKickAt > CACHE_TTL_MS) {
    lastKickAt = now
    void loadSwitchedOffModels()
  }
  return switchedOff.has(id)
}

/** Every identifier currently switched off (for the effective-deny listing). */
export function switchedOffModelIds(): string[] {
  return [...switchedOff]
}

/**
 * An in-process writer of the switch (the admin pricing routes) reports the
 * new state so this process answers correctly at once; sibling instances
 * converge on the TTL. Called after the row was written, never before.
 */
export function noteModelSwitch(id: string, enabled: boolean): void {
  if (!id) return
  generation += 1
  const next = new Set(switchedOff)
  if (enabled) next.delete(id)
  else next.add(id)
  switchedOff = next
}

/** Test hook: with ids, inject the loaded set; with none, restore the
 *  pristine never-loaded state (no background refresh fires under Vitest). */
export function __resetModelSwitchForTests(ids?: readonly string[]): void {
  switchedOff = new Set(ids ?? [])
  loadedAt = Date.now()
  everLoaded = ids !== undefined
  lastKickAt = 0
}
