import { useSyncExternalStore } from "react"
import {
  isWorldId,
  listsSet,
  listsWithhold,
  nodeListsWithhold,
  orderWorlds,
  worldOffered,
  type WorldId,
} from "@nodaro/shared/runtime-config"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import { runtimeSurfaceProfile } from "./surface-profile"

/**
 * Browser mirror of the backend's three-layer node/model availability funnel
 * (lib/surface-deny.ts): edition/code → surface-profile factory (allow/deny)
 * → admin runtime override. The static profile in /config.js cannot carry the
 * runtime override, so the dashboard fetches GET /v1/surface/availability once
 * (post-auth) and the picker / model-dropdown filters read the fetched
 * EFFECTIVE denied sets through the two helpers below.
 *
 * REACTIVITY IS LOAD-BEARING, not a nicety. These sets arrive AFTER the first
 * render (one authenticated fetch), and the two consumers — the Add Node
 * picker and the model dropdowns — read them through plain functions during
 * render. Without a subscription nothing re-renders when the data lands, so a
 * deployment with a whitelist showed its users the FULL picker and model
 * lists for the rest of the session: the narrowing silently did nothing in the
 * UI. Components that filter must call `useSurfaceAvailability()`.
 *
 * BEFORE THE ANSWER — while it is awaited, after a read of it that failed, and
 * on every page that never asks (a published app, a signed-out visitor) — a
 * deployment that set lists is judged by its OWN lists (`nodes.allow` /
 * `nodes.deny`, `models.allow` / `models.deny`, `worlds`), by the rule the
 * server applies before any admin setting (`nodeListsWithhold`, `listsWithhold`
 * and `worldOffered`, @nodaro/shared/runtime-config). So from the first paint
 * a restricted deployment draws nothing its lists withhold (nothing drawn and
 * then taken away) and hides nothing they offer. What the lists cannot carry
 * is the admin's layer: a node or model an admin switched off may show until
 * the answer arrives, and one an admin released beyond the lists appears when
 * it does; the server refuses at write and run regardless. A deployment that
 * sets no lists withholds nothing before the answer but a house model, exactly
 * as before. This module is the ONE place that rule is read
 * (`__tests__/availability-reads-funnel.test.ts`): every reader asks the
 * helpers below and never the state flags or the profile's lists itself.
 *
 * PER VIEWER. The backend answers for whoever asked: the admin switch hides a
 * node from users, not from admins, so an admin's `denied` omits what the switch
 * withholds and `hiddenFromUsers` names it. The picker needs no admin logic of
 * its own — it shows what is not denied — and `isNodeHiddenFromUsers` only drives
 * the mark that tells an admin "your users cannot see this one". A non-admin
 * always receives an empty list.
 */

let fetched: {
  nodes: ReadonlySet<string>
  models: ReadonlySet<string>
  /** Whether the deployment RESTRICTS models (`models.restricted`): a profile
   *  allow/deny list or a models override that leaves a model off. A model an
   *  admin switched off is in `models` without being a restriction. */
  modelsRestricted: boolean
  /** Modes of an offered model this install cannot run (`models.deniedModes`), as `<model id>:<mode>`. */
  modelModes: ReadonlySet<string>
  hiddenFromUsers: ReadonlySet<string>
  /** Web Scrape SOURCES that follow a withheld node (the Instagram source follows
   *  the Instagram node). The backend sends the result, never the mapping. */
  webScrapeSources: { denied: ReadonlySet<string>; hiddenFromUsers: ReadonlySet<string> }
  /** The worlds offered to this viewer, in the deployment's order; null when
   *  the server sent none (one that predates them). */
  worlds: readonly WorldId[] | null
} | null = null
let inflight: Promise<void> | null = null
/**
 * The viewer's read failed (an error status, the network, a body it could not
 * read) and no answer of theirs stands. Kept until an answer lands or the
 * viewer changes, so a retry does not flip it back to "awaited" in between.
 * Only a reader that treats a failed read unlike one still awaited asks
 * (`surfaceAvailabilityFailed`); every other reader sees both as "not landed".
 */
let failed = false
/** Whose answer `fetched` is. The answer is per viewer, so it is only ever shown
 *  to the viewer it was fetched for (see `loadSurfaceAvailability`). */
let fetchedFor: string | null = null
/** Bumped whenever the viewer changes — a response that started under an older
 *  value belongs to somebody else and is dropped. */
let viewerSeq = 0

// A version counter rather than the set itself: useSyncExternalStore compares
// snapshots by identity, and a number is stable between changes where a freshly
// built Set would not be (an infinite re-render).
let version = 0
const listeners = new Set<() => void>()
function emit(): void {
  version += 1
  for (const l of listeners) l()
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/**
 * Be told, outside React, whenever availability changes (an answer lands, or a
 * sign-out drops it). Returns the unsubscribe. For module-level readers that
 * must act once the answer is in — `useSurfaceAvailability` is the component
 * form of the same subscription.
 */
export function subscribeSurfaceAvailability(listener: () => void): () => void {
  return subscribe(listener)
}
const snapshot = (): number => version

/**
 * Subscribe a filtering component to availability arriving. Returns the
 * version, which callers ignore — the point is the re-render.
 */
export function useSurfaceAvailability(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Drop whatever was fetched — the sign-out path. The static-profile fallback
 *  takes over until the next viewer's answer lands. */
export function resetSurfaceAvailability(): void {
  viewerSeq += 1
  inflight = null
  fetchedFor = null
  if (fetched || failed) {
    fetched = null
    failed = false
    emit()
  }
}

/**
 * Fetch the availability answer for `viewerKey` (the signed-in user's id).
 *
 * The answer is PER VIEWER — an admin's carries nodes their users must not be
 * offered — so a change of account drops the previous viewer's sets BEFORE the
 * new request goes out. Waiting for the response instead would leave an admin's
 * picker (hidden nodes offered, `ADMIN` marks painted) on a user's screen for
 * the round trip, and for the whole session if that request failed. A response
 * that started under a previous viewer is dropped when it lands.
 */
export async function loadSurfaceAvailability(
  getAuthHeaders: () => Promise<Record<string, string>>,
  viewerKey: string,
): Promise<void> {
  if (viewerKey !== fetchedFor) {
    resetSurfaceAvailability()
    fetchedFor = viewerKey
  }
  if (inflight) return inflight
  const request = fetchAnswer(getAuthHeaders, viewerSeq)
  inflight = request
  // Released only by the request that still owns it: a change of viewer has
  // already cleared `inflight`, and may have started a newer request since.
  void request.finally(() => {
    if (inflight === request) inflight = null
  })
  return request
}

/** One fetch of the answer. Never rejects; lands nothing when the viewer it was
 *  started for (`seq`) is no longer the viewer. */
async function fetchAnswer(getAuthHeaders: () => Promise<Record<string, string>>, seq: number): Promise<void> {
  try {
    const headers = await getAuthHeaders()
    const res = await fetch("/v1/surface/availability", { headers })
    if (seq !== viewerSeq) return
    if (!res.ok) {
      readFailed(seq)
      return
    }
    const json = (await res.json()) as {
      nodes?: { denied?: unknown; hiddenFromUsers?: unknown }
      models?: { denied?: unknown; restricted?: unknown; deniedModes?: unknown }
      webScrapeSources?: { denied?: unknown; hiddenFromUsers?: unknown }
      worlds?: unknown
    }
    if (seq !== viewerSeq) return
    const toSet = (v: unknown): ReadonlySet<string> =>
      new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
    fetched = {
      nodes: toSet(json.nodes?.denied),
      models: toSet(json.models?.denied),
      // A server that predates the field restricts nothing as far as we know.
      modelsRestricted: json.models?.restricted === true,
      // A server that predates the field runs every mode as far as we know.
      modelModes: toSet(json.models?.deniedModes),
      hiddenFromUsers: toSet(json.nodes?.hiddenFromUsers),
      webScrapeSources: {
        denied: toSet(json.webScrapeSources?.denied),
        hiddenFromUsers: toSet(json.webScrapeSources?.hiddenFromUsers),
      },
      worlds: answerWorlds(json.worlds),
    }
    failed = false
    emit()
  } catch {
    // Offline / pre-auth — the static-profile fallback stands; the backend
    // is the authority either way.
    readFailed(seq)
  }
}

/** Note that the read started for viewer `seq` failed: only while they are still the viewer and no answer of theirs stands. */
function readFailed(seq: number): void {
  if (seq !== viewerSeq || fetched || failed) return
  failed = true
  emit()
}

/**
 * The enabled worlds of the answer's `worlds`, in its order: an id this app
 * does not know (a newer server's world) or an entry it cannot read is left
 * out. Null when the answer has no list at all.
 */
function answerWorlds(value: unknown): readonly WorldId[] | null {
  if (!Array.isArray(value)) return null
  return value.flatMap((entry: unknown) => {
    const world = entry as { id?: unknown; enabled?: unknown } | null
    return world && isWorldId(world.id) && world.enabled === true ? [world.id] : []
  })
}

/** Test hook. */
export function __resetSurfaceAvailabilityForTests(
  next?: {
    nodes: string[]
    models: string[]
    /** `models.restricted`; defaults to false (a test of the new-node rule opts in). */
    modelsRestricted?: boolean
    /** `models.deniedModes`; defaults to none. */
    modelModes?: string[]
    hiddenFromUsers?: string[]
    webScrapeSources?: { denied?: string[]; hiddenFromUsers?: string[] }
    worlds?: WorldId[]
  } | null,
): void {
  fetched = next
    ? {
        nodes: new Set(next.nodes),
        models: new Set(next.models),
        modelsRestricted: next.modelsRestricted ?? false,
        modelModes: new Set(next.modelModes ?? []),
        hiddenFromUsers: new Set(next.hiddenFromUsers ?? []),
        webScrapeSources: {
          denied: new Set(next.webScrapeSources?.denied ?? []),
          hiddenFromUsers: new Set(next.webScrapeSources?.hiddenFromUsers ?? []),
        },
        worlds: next.worlds ?? null,
      }
    : null
  failed = false
  if (!next) {
    fetchedFor = null
    inflight = null
    viewerSeq += 1
  }
  emit()
}

/** Test hook: the viewer's read failed, and no answer stands. */
export function __failSurfaceAvailabilityForTests(): void {
  fetched = null
  failed = true
  emit()
}

/** True once the viewer's availability answer has landed (false before it,
 *  after sign-out, and for the whole session when the fetch failed). For a
 *  reader that acts when the answer lands (`new-node-models.ts` re-judges the
 *  nodes made before it) or one tied to a run, which goes by the answer alone;
 *  a reader that draws asks the judges below. */
export function surfaceAvailabilityLoaded(): boolean {
  return fetched !== null
}

/**
 * True when the viewer's read failed and no answer of theirs has landed:
 * `surfaceAvailabilityLoaded()` is false both while the read is awaited and
 * after it failed, and this tells the two apart. False while awaited, once an
 * answer lands (a later failed re-read keeps it), and after sign-out or a
 * change of account. Only for a reader tied to a RUN, which must do what the
 * server would do with an availability it cannot read (the cameras settings,
 * `use-case-multicam-viewer.ts`); a reader that draws asks the judges below.
 */
export function surfaceAvailabilityFailed(): boolean {
  return failed
}

// ── The deployment's own lists: what decides before an answer ──────────────

/**
 * The model ids a model whitelist governs: the catalog's and the LLMs' — the
 * server's `GATEABLE_MODEL_IDS` (backend lib/availability-override.ts), built
 * from the same two shared tables. An id outside them is withheld only by
 * `models.deny`.
 */
const ALLOW_LIST_GATED_MODEL_IDS: ReadonlySet<string> = new Set([...Object.keys(MODEL_CATALOG), ...LLM_MODELS.map((m) => m.id)])

/** Whether the deployment set node lists (`nodes.allow` or `nodes.deny`): they then judge node types until the answer arrives. */
function nodeListsSet(): boolean {
  return listsSet(runtimeSurfaceProfile().nodes)
}

/** The node lists' verdict, the server's factory rule (a whitelist never withholds a utility node by leaving it out). */
function nodeWithheldByLists(type: string): boolean {
  return nodeListsWithhold(runtimeSurfaceProfile().nodes, type)
}

/** The model lists' verdict, the server's factory rule over its gateable models. */
function modelWithheldByLists(id: string): boolean {
  return listsWithhold(runtimeSurfaceProfile().models, id, (model) => ALLOW_LIST_GATED_MODEL_IDS.has(model))
}

/**
 * True when this deployment does not offer this node type to the viewer: the
 * answer once it is in; before it (awaited, failed, never asked) the
 * deployment's own node lists — nothing, where it set none. The picker, the
 * sidebar, the edge-drop menu and the quick-add suggestions read it
 * (`getNodeOptions`).
 */
export function isNodeUnavailable(type: string): boolean {
  if (fetched) return fetched.nodes.has(type)
  return nodeWithheldByLists(type)
}

/**
 * The node judge of a reader that must not draw something and then take it
 * away (the white-label header's world menus, the framing source): before the
 * answer it names nothing — null — unless the deployment set node lists, which
 * then decide from the first paint. `isNodeUnavailable` once the answer is in,
 * after a read of it failed, and wherever node lists are set.
 */
export function settledNodeJudge(): ((type: string) => boolean) | null {
  return fetched || failed || nodeListsSet() ? isNodeUnavailable : null
}

/**
 * True when `type` is withheld from a reader that offers it only once it is
 * known to be offered (an input pip that follows a node,
 * `target-handle-availability.ts`): the answer once it is in; before it, the
 * deployment's node lists where it set any; otherwise withheld, also after a
 * failed read.
 */
export function isNodeUnavailableUntilKnown(type: string): boolean {
  return fetched || nodeListsSet() ? isNodeUnavailable(type) : true
}

/**
 * True when the viewer is an admin looking at a node the admin switch hides from
 * users. Never true before the fetch lands, and never true for a non-admin —
 * the backend sends them an empty list.
 */
export function isNodeHiddenFromUsers(type: string): boolean {
  return fetched?.hiddenFromUsers.has(type) ?? false
}

/** True when this Web Scrape source is withdrawn from the viewer (it follows a
 *  node that is withheld). Never true before the fetch lands. */
export function isWebScrapeSourceUnavailable(source: string): boolean {
  return fetched?.webScrapeSources.denied.has(source) ?? false
}

/**
 * True while the viewer's Web Scrape sources cannot be told on a deployment
 * that set node lists: a source can follow a node (the Instagram source the
 * Instagram node), and which one is the server's to say — the browser is sent
 * the result, never that mapping, so the lists cannot say which sources they
 * withhold. Until the answer arrives (for good, after a failed read) the
 * source dropdown offers only the node's current source. Never true where no
 * node lists are set.
 */
export function webScrapeSourcesAwaited(): boolean {
  return !fetched && nodeListsSet()
}

/** True when the viewer is an admin looking at a source their users cannot pick. */
export function isWebScrapeSourceHiddenFromUsers(source: string): boolean {
  return fetched?.webScrapeSources.hiddenFromUsers.has(source) ?? false
}

/**
 * True when this deployment does not offer this model id in dropdowns: the
 * answer once it is in; before it, the deployment's own model lists (nothing,
 * where it set none) and a house model (the catalog's `ownLabel`, offered only
 * where the deployment serves it — the server decides), which is withheld: it
 * is never shown to an install that turns out not to serve it.
 */
export function isModelUnavailable(id: string): boolean {
  if (fetched) return fetched.models.has(id)
  if (Object.hasOwn(MODEL_CATALOG, id) && MODEL_CATALOG[id]!.ownLabel === true) return true
  return modelWithheldByLists(id)
}

/**
 * True when this install cannot run a mode of a model it offers
 * (`models.deniedModes`, keyed `<model id>:<mode>` — Nodaro Video Upscale's
 * Transparent where it cannot run). Never true before the answer lands, after
 * a failed read, or from a server that predates the field: the mode is then
 * taken to run, as it did before the field existed, and the server stays the
 * authority (a node that names no mode runs the mode its run decides).
 */
export function isModelModeUnavailable(modeId: string): boolean {
  return fetched?.modelModes.has(modeId) ?? false
}

/**
 * True when this deployment RESTRICTS models: the server's `models.restricted`
 * once the answer is in, before it the static profile naming `models.allow` or
 * `models.deny` (an admin's models override is known only from the answer). A
 * model an admin switched off is unavailable without being a restriction, so a
 * deployment that restricts nothing answers false here whatever it switched off.
 */
export function modelRestrictionActive(): boolean {
  if (fetched) return fetched.modelsRestricted
  return listsSet(runtimeSurfaceProfile().models)
}

/**
 * The worlds the server's answer offers the viewer (`worlds`), in its order.
 * Null before the answer lands, after sign-out, and when the server sent
 * none. A reader asks `offeredWorlds`, which also answers before then.
 */
export function availableWorlds(): readonly WorldId[] | null {
  return fetched?.worlds ?? null
}

/**
 * The worlds this deployment offers the viewer, in its order: the profile's
 * `worlds.allow` AND every node type each one runs available to them. The
 * server's answer once it is in; before it (or from a server that sends none)
 * the profile's own `worlds` with the node types judged as `isNodeUnavailable`
 * judges them — every world the profile allows, where it set no node lists.
 */
export function offeredWorlds(): readonly WorldId[] {
  const answered = availableWorlds()
  if (answered) return answered
  const { worlds } = runtimeSurfaceProfile()
  return orderWorlds(worlds?.order).filter((id) => worldOffered(worlds, id, isNodeUnavailable))
}
