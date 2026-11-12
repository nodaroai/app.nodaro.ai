/**
 * Which house models this deployment serves — the LEAF half of
 * `lib/house-models.ts` (docs/design/house-models.md).
 *
 * A house model is a catalog entry marked `ownLabel: true`: a model the
 * deployment offers under its own label, whose upstream a private plugin
 * supplies through `PluginServices.houseModels`. The set of house-model ids is
 * exactly the catalog's own-label ids; the plugin's `ids()` can only NARROW it
 * (what this deployment serves), never widen it. A plugin leaves out of `ids()`
 * what it cannot run, a model whose upstream key this process lacks included.
 *
 * `houseModelServed` answers in EVERY process:
 *   - A process that loaded the plugins (the API server, the video worker, the
 *     pipeline worker): the plugin's `ids()`, read directly.
 *   - The standalone orchestrator loads no plugin. At boot it registers a
 *     source (`setHouseModelsServedSource`) that asks this container's own API
 *     (`GET /v1/house-models/internal/served`, internal only). The answer is
 *     reused for `HOUSE_MODELS_SERVED_TTL_MS`, and kept through failed asks
 *     (stale-while-error) for up to `HOUSE_MODELS_SERVED_STALE_LIMIT_MS` from
 *     when it was fetched. "The API said not served" and "the API could not
 *     be asked" are different answers: with no answer at all, or one older
 *     than that limit, the state is UNKNOWN, and `houseModelServed` throws
 *     `HouseModelsServedUnknownError` for a house model — a `DrainAbortError`,
 *     so the orchestrator hands the run back to its queue with nothing held,
 *     instead of refusing the node for good. That hand-back is bounded: once
 *     this process has been without a usable answer for
 *     `HOUSE_MODELS_UNKNOWN_HAND_BACK_MS`, it fails the node instead
 *     (`HouseModelsTemporarilyUnavailableError`, `model_temporarily_unavailable`:
 *     nothing held, the run can be started again). The next ask is not sooner
 *     than `HOUSE_MODELS_SERVED_FAILURE_TTL_MS`. The
 *     predicate is synchronous, so the workflow engine awaits
 *     `refreshHouseModelsServed()` before the payload build of a node that
 *     names a house model (`buildPayloadWithSourceSize`); a node that names
 *     none never asks. A drain during the ask rejects the refresh with the
 *     drain's own `DrainAbortError`.
 *   - With no source registered (a process that neither loaded the plugins nor
 *     registered one): "not served".
 *
 * Kept apart from house-models.ts (which re-exports it) because
 * `lib/surface-deny.ts` asks it on every model read, and that module's import
 * chain must stay free of supabase and config: this file reads only the
 * catalog and the plugin services registry (itself a leaf).
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { getPluginServices, pluginServicesLoaded } from "./private-plugins/services-registry.js"
import { DrainAbortError, isDrainAbortError } from "./worker-drain.js"
import { redactProviderDetail } from "./provider-error-detail.js"

/** The one name every house-model job counts against in the provider ceilings. (`jobs.provider` records the house-model id itself.) */
export const HOUSE_MODELS_PROVIDER = "house-models"

/** The reconcile kind a house-model job's task is saved under (`jobs.provider_kind`). */
export const HOUSE_MODEL_PROVIDER_KIND = "house-model"

/** How long the orchestrator reuses its API's answer. */
export const HOUSE_MODELS_SERVED_TTL_MS = 60_000

/** How long the orchestrator waits before asking its API again after an ask failed. */
export const HOUSE_MODELS_SERVED_FAILURE_TTL_MS = 4_000

/**
 * How long the orchestrator keeps using its API's last answer while asks
 * fail, counted from when that answer was fetched. Which house models a
 * deployment serves changes with a deploy or a key, not minute to minute, so
 * an API restart (seconds to a couple of minutes) is ridden out on the last
 * answer with no hand-back at all; past this, the answer is too old to trust.
 */
export const HOUSE_MODELS_SERVED_STALE_LIMIT_MS = 10 * 60_000

/**
 * How long this process hands a run on a house model back while it has no
 * usable answer, before it fails the node instead. An API that is restarting
 * answers within this (its boot and the plugin load take a minute or two); a
 * longer outage is not one a hand-back rides out, and every hand-back resumes
 * the whole execution (its siblings not yet at a provider are re-dispatched).
 * At the orchestrator's 5-second requeue delay this is at most about 36
 * hand-backs. Counted per process from when it first had no usable answer, so
 * it holds across executions and replicas without any shared state.
 */
export const HOUSE_MODELS_UNKNOWN_HAND_BACK_MS = 3 * 60_000

/**
 * The orchestrator could not ask its API which house models it serves (and
 * holds no answer from it): not "not served". A `DrainAbortError`, so the run
 * that needed the answer is handed back to the queue with nothing held, and
 * read again once the API answers.
 */
export class HouseModelsServedUnknownError extends DrainAbortError {
  constructor() {
    super("the API could not be asked which house models this deployment serves; the run is handed back")
    this.name = "HouseModelsServedUnknownError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * The orchestrator has had no usable answer from its API for longer than it
 * hands runs back (`HOUSE_MODELS_UNKNOWN_HAND_BACK_MS`): the node fails, with
 * nothing held, and the run can be started again once the API answers. Not a
 * drain, and not "not served".
 */
export class HouseModelsTemporarilyUnavailableError extends Error {
  readonly code = "model_temporarily_unavailable" as const

  constructor(id: string) {
    super(`${MODEL_CATALOG[id]?.label ?? "This model"} is temporarily unavailable. Try again in a few minutes.`)
    this.name = "HouseModelsTemporarilyUnavailableError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

let ownLabelIds: ReadonlySet<string> | undefined
/** Whether a throwing `ids()` was already logged: once per process, never per model read. */
let idsFailureLogged = false

/** The orchestrator's way to learn the served ids (registered once at boot). */
let source: (() => Promise<readonly string[]>) | null = null
/** Its last answer from the API: when it was fetched, and until when it is fresh. */
let answer: { ids: ReadonlySet<string>; fetchedAt: number; until: number } | null = null
/** Since when this process has had no usable answer (continuously); null while it has one. */
let unknownSince: number | null = null
/** When the hand-back was last logged: at most one line every 30 seconds. */
let handBackLoggedAt = Number.NEGATIVE_INFINITY
/** Set while the latest ask failed: until when no new ask is made. Cleared by an answer. */
let askFailedUntil: number | null = null
let inflight: Promise<void> | null = null
let now: () => number = () => Date.now()

/** The catalog ids marked `ownLabel` — every house model there can be. Empty when the catalog marks none. */
export function ownLabelModelIds(): ReadonlySet<string> {
  ownLabelIds ??= new Set(Object.values(MODEL_CATALOG).filter((m) => m.ownLabel === true).map((m) => m.id))
  return ownLabelIds
}

/** True when the catalog marks `id` as offered under the deployment's own label. */
export function isOwnLabelModel(id: unknown): id is string {
  return typeof id === "string" && ownLabelModelIds().has(id)
}

/** The served ids as the loaded plugin answers them — only in a process that loaded the plugins. */
function servedByLoadedPlugin(id: string): boolean {
  const service = getPluginServices().houseModels
  if (!service) return false
  try {
    const ids = service.ids()
    return Array.isArray(ids) && ids.includes(id)
  } catch (err) {
    if (!idsFailureLogged) {
      idsFailureLogged = true
      console.warn(`[house-models] ids() failed; every house model reads as not served: ${redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? "(no words)"}`)
    }
    return false
  }
}

/** The API's last answer while it is usable: fetched no longer than the stale limit ago. */
function usableAnswer(): { ids: ReadonlySet<string> } | null {
  return answer && now() - answer.fetchedAt <= HOUSE_MODELS_SERVED_STALE_LIMIT_MS ? answer : null
}

/**
 * Whether this process knows `id` is served: `served` / `unserved`, or
 * `unknown` — only in the orchestrator, while it holds no usable answer from
 * its API (none yet, or one older than the stale limit). A held answer is used
 * through failed asks. Never throws; kicks a refresh when the answer has
 * expired.
 */
export function houseModelServedState(id: string): "served" | "unserved" | "unknown" {
  if (!isOwnLabelModel(id)) return "unserved"
  if (pluginServicesLoaded()) return servedByLoadedPlugin(id) ? "served" : "unserved"
  if (!source) return "unserved"
  if (!answer || now() >= answer.until) void refreshHouseModelsServed().catch(() => {})
  const held = usableAnswer()
  if (!held) {
    unknownSince ??= now()
    return "unknown"
  }
  return held.ids.has(id) ? "served" : "unserved"
}

/**
 * True when the catalog marks `id` as own-label AND this deployment serves it
 * (see the module doc for how each process knows). False without a plugin
 * (community, business, a plugin build without the service, a deployment with
 * no upstream key), before the plugins have loaded, and when the plugin's
 * `ids()` throws. In the orchestrator, while its API could not be asked, it
 * THROWS `HouseModelsServedUnknownError` for a house model (the run is handed
 * back) rather than answer "not served".
 *
 * Valid in every process.
 */
export function houseModelServed(id: string): boolean {
  const state = houseModelServedState(id)
  if (state !== "unknown") return state === "served"
  const unknownFor = now() - (unknownSince ?? now())
  if (unknownFor >= HOUSE_MODELS_UNKNOWN_HAND_BACK_MS) {
    console.error(
      `[house-models] the API has not said which house models it serves for ${Math.round(unknownFor / 1000)}s; ` +
        `a run on ${id} fails as temporarily unavailable (nothing held; it can be started again) instead of being handed back`,
    )
    throw new HouseModelsTemporarilyUnavailableError(id)
  }
  if (now() - handBackLoggedAt >= 30_000) {
    handBackLoggedAt = now()
    console.warn(
      `[house-models] the API has not said which house models it serves (for ${Math.round(unknownFor / 1000)}s); ` +
        `a run on ${id} is handed back to the queue, not a drain — it fails as temporarily unavailable after ${HOUSE_MODELS_UNKNOWN_HAND_BACK_MS / 1000}s`,
    )
  }
  throw new HouseModelsServedUnknownError()
}

/** The own-label ids this process serves (`houseModelServed`), in catalog order. */
export function servedHouseModelIds(): string[] {
  return [...ownLabelModelIds()].filter((id) => houseModelServedState(id) === "served")
}

/**
 * True when the house rule withholds a model here: the catalog has an
 * own-label model this process does not know to be served (unserved, or —
 * in the orchestrator — not known yet). Never throws.
 */
export function houseRuleWithholdsAModel(): boolean {
  for (const id of ownLabelModelIds()) if (houseModelServedState(id) !== "served") return true
  return false
}

/**
 * True when this process already KNOWS every house model is served here (or
 * the catalog has none): the loaded plugin serves each, or — in the
 * orchestrator — its held answer lists each. Unlike `houseRuleWithholdsAModel`
 * it never asks and never starts an ask, so a per-request check reads it
 * first and, on an install that serves every house model, skips everything
 * else. Never throws.
 */
export function servesEveryHouseModel(): boolean {
  const ids = ownLabelModelIds()
  if (ids.size === 0) return true
  if (pluginServicesLoaded()) {
    for (const id of ids) if (!servedByLoadedPlugin(id)) return false
    return true
  }
  const held = source ? usableAnswer() : null
  if (!held) return false
  for (const id of ids) if (!held.ids.has(id)) return false
  return true
}

/** The orchestrator's source of the served ids: a function that asks this container's API (`null` clears it). */
export function setHouseModelsServedSource(fn: (() => Promise<readonly string[]>) | null): void {
  source = fn
  answer = null
  askFailedUntil = null
  unknownSince = null
  inflight = null
}

/**
 * In a process that loaded no plugin and registered a source: make the served
 * ids current, asking the API when the last answer has expired (one request at
 * a time). Resolves once the answer is current, or once the ask failed (the
 * state is then UNKNOWN, and `houseModelServed` throws for a house model);
 * rejects only with a `DrainAbortError` (the process is draining — the run is
 * handed back). A no-op where the plugins are loaded, with no source, and when
 * the catalog marks no model own-label.
 */
export function refreshHouseModelsServed(): Promise<void> {
  // Nothing to ask about: a catalog with no own-label model never calls the API.
  if (ownLabelModelIds().size === 0 || pluginServicesLoaded() || !source) return Promise.resolve()
  if (askFailedUntil === null && answer && now() < answer.until) return Promise.resolve()
  if (askFailedUntil !== null && now() < askFailedUntil) return Promise.resolve()
  const ask = source
  inflight ??= ask()
    .then((ids) => {
      const served = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
      answer = { ids: new Set(served), fetchedAt: now(), until: now() + HOUSE_MODELS_SERVED_TTL_MS }
      askFailedUntil = null
      unknownSince = null
    })
    .catch((err: unknown) => {
      askFailedUntil = now() + HOUSE_MODELS_SERVED_FAILURE_TTL_MS
      if (!usableAnswer()) unknownSince ??= now()
      if (isDrainAbortError(err)) throw err
      console.warn(
        `[house-models] the API could not be asked which house models it serves; ` +
          `${usableAnswer() ? "its last answer is used meanwhile" : "a run on one is handed back until it answers"}: ` +
          `${redactProviderDetail(err instanceof Error ? err.message : String(err)) ?? "(no words)"}`,
      )
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Test seam: forget the cached own-label set and the orchestrator's answer; optionally fix the clock. */
export function resetOwnLabelModelIdsForTests(clock?: () => number): void {
  ownLabelIds = undefined
  idsFailureLogged = false
  source = null
  answer = null
  askFailedUntil = null
  unknownSince = null
  handBackLoggedAt = Number.NEGATIVE_INFINITY
  inflight = null
  now = clock ?? (() => Date.now())
}
