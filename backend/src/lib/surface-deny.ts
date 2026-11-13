import { WORLD_REQUIRED_NODE_TYPES, orderWorlds, worldAllowed, type WorldId } from "@nodaro/shared/runtime-config"
import { runtimeSurfaceProfile } from "./surface-profile.js"
import { parseSiteCaptureEnabled } from "./site-capture-switch.js"
import {
  availabilityOverride,
  gateGeneration,
  nodesOverrideGeneration,
  GATEABLE_NODE_TYPES,
  GATEABLE_MODEL_IDS,
  ONE_OFF_VOICE_CLONE_FEATURE,
} from "./availability-override.js"
import { isModelSwitchedOff, switchedOffModelIds } from "./model-switch.js"
import { houseModelServed, houseRuleWithholdsAModel, isOwnLabelModel } from "./house-models-served.js"

/**
 * Backend-authoritative node/model availability for a deployment (B1 + B5).
 *
 * Mirrors cloud-only-nodes.ts exactly — a predicate + a `find` + a shared
 * message — and is applied at the same chokepoints (`GET /v1/nodes`, the
 * workflow write guards, the MCP write tool) plus the run-time throw in
 * payload-builder that pre-existing rows / imports / templates reach without
 * touching a write guard. A denied node is invisible in discovery, refused at
 * write, and fails honestly at run.
 *
 * FOUR LAYERS, resolved here so every chokepoint stays a one-word predicate:
 *
 *   1. code/edition — what the build ships (edition gates are their own layer
 *      and always apply on top: cloud-only-nodes etc.).
 *   2. surface profile (the FACTORY set) — `allow` non-empty ⇒ whitelist over
 *      the gateable universe, minus `deny`. The whitelist is the safer,
 *      recommended shape for a curated deployment: a node the profile never
 *      heard of is unavailable by default instead of available by omission.
 *   3. admin override (availability-override.ts) — a stored enabled-set that
 *      REPLACES layer 2 while present; "reset to factory" deletes it. It
 *      replaces it only for the gates it was saved knowing: a gate newer than
 *      the stored override (an id that was live before it became gateable, a
 *      route that follows its node only since route gating) is answered by
 *      layer 2 until the next save ("Gating generations" there).
 *   4. the admin's model switch (model-switch.ts, models only) —
 *      `model_pricing.is_enabled` off on the admin models page. It wins over
 *      every layer below it: a model nobody can run is not offered, whatever
 *      the profile or the override lists (2026-10-29: a switched-off model
 *      stayed in every menu and only failed at run).
 *
 * INVERSION SCOPE: allow-lists and overrides say "not listed ⇒ denied", so
 * they only invert over the GATEABLE universes (registry minus utility nodes;
 * catalog + LLM model ids). Workflow-internal pseudo-types and utility nodes
 * (sticky-note, preview) can never be denied by omission — only by an explicit
 * `deny` entry.
 *
 * WHO IS ASKING (nodes only). The admin override is a RELEASE switch: it hides a
 * node from the deployment's users, not from the admins who run the deployment —
 * an admin still sees, saves and runs a node they have not released. The factory
 * profile is different in kind: it says what the deployment OFFERS, so its
 * removals carry NO admin exception — being an admin never hands back a node
 * the profile removed. (That is NOT a hard floor: layer 3 REPLACES layer 2, so
 * an admin who ticks a profile-removed node ON in Admin → Availability releases
 * it to everyone. The exception only ever concerns nodes left OFF.) Hence every
 * node predicate takes a
 * REQUIRED `viewer`: a call site cannot keep (or lose) the admin exception by
 * omission, the compiler makes each one say who is asking. Public, cacheable
 * surfaces (`GET /v1/nodes`) always ask as `USER_VIEWER`. Resolving a user id
 * to a viewer lives in lib/availability-viewer.ts, NOT here — this module's
 * import chain must stay free of supabase (see availability-override.ts).
 * Models carry no viewer: the model lever has no admin exception.
 */

/** Who is asking whether a node is available. */
export interface AvailabilityViewer {
  readonly admin: boolean
}

/** Everyone who is not an admin — and every surface that cannot know (public
 *  discovery, a caller with no user id, a failed admin lookup). Fail-closed. */
export const USER_VIEWER: AvailabilityViewer = Object.freeze({ admin: false })

/** An admin of this deployment, as lib/admin-check.ts defines one. */
export const ADMIN_VIEWER: AvailabilityViewer = Object.freeze({ admin: true })

/**
 * Install switches — part of the code/edition layer: node types this install does
 * not run at all, whatever the profile or an admin says. Site Capture where
 * SITE_CAPTURE_ENABLED is "false" (its route is then not registered).
 */
export function switchedOffNodeTypes(): string[] {
  // The env directly (fixed at boot, the same value config.siteCaptureEnabled() parsed): surface-deny's
  // import chain stays clear of config, which many suites mock.
  return parseSiteCaptureEnabled(process.env.SITE_CAPTURE_ENABLED) ? [] : ["site-capture"]
}

/** The FACTORY layer alone (profile allow/deny), ignoring any admin override —
 *  what this deployment offers before its admins released or withheld anything. */
export function isNodeFactoryDenied(type: string): boolean {
  if (switchedOffNodeTypes().includes(type)) return true
  const { deny, allow } = runtimeSurfaceProfile().nodes
  if (allow.length && GATEABLE_NODE_TYPES.has(type) && !allow.includes(type)) return true
  // A profile that denies the Voice Clone node withholds a one-off clone too (decided 2026-11-13).
  if (type === ONE_OFF_VOICE_CLONE_FEATURE && deny.includes("voice-clone")) return true
  return deny.includes(type)
}

/**
 * True when this deployment does not offer this node type to `viewer`.
 *
 * `gateSince` is the gating generation of the DOOR asking, when that door is
 * newer than the type itself — a route refused under a node only since route
 * gating (lib/route-node-gate.ts). A stored override older than the door, or
 * than the type's own gate (`gateGeneration`), never decided it, so the factory
 * layer answers instead (lib/availability-override.ts, "Gating generations").
 */
export function isNodeDenied(type: string, viewer: AvailabilityViewer, gateSince = 0): boolean {
  // An install switch is no availability setting: no override hands the node back.
  if (switchedOffNodeTypes().includes(type)) return true
  const override = availabilityOverride("nodes")
  if (!override) return isNodeFactoryDenied(type)
  if (Math.max(gateSince, gateGeneration(type)) > nodesOverrideGeneration()) return isNodeFactoryDenied(type)
  const hiddenByOverride = GATEABLE_NODE_TYPES.has(type) && !override.has(type)
  if (!hiddenByOverride) return false
  // Left OFF by the admin switch: hidden from users. An admin keeps it only if
  // the deployment itself offers it — a node the profile removed is not handed
  // back just because an override happens to exist and leaves it off.
  return viewer.admin ? isNodeFactoryDenied(type) : true
}

export function findDeniedNodeTypes(
  nodes: ReadonlyArray<{ type?: unknown }> | undefined,
  viewer: AvailabilityViewer,
): string[] {
  if (!nodes?.length) return []
  const found = new Set<string>()
  for (const n of nodes) if (typeof n?.type === "string" && isNodeDenied(n.type, viewer)) found.add(n.type)
  return [...found]
}

/** Shared refusal text so import / MCP / REST / run explain it the same way. */
export function deniedNodeRejectionMessage(types: readonly string[]): string {
  return (
    `This workflow uses ${types.length > 1 ? "nodes that are" : "a node that is"} not available on this deployment: ` +
    `${types.join(", ")}. Remove ${types.length > 1 ? "them" : "it"} to run this workflow.`
  )
}

// ── Capabilities that live INSIDE another node ───────────────────────────────

/**
 * A capability offered inside one node that is the SAME capability as a
 * dedicated node shares that node's availability. Web Scrape's Instagram source
 * is the Instagram node's scraper behind a different door: withholding that
 * node must withdraw the source too, or the switch closes one door and leaves
 * the other open.
 *
 * ONE registry, keyed by the HOST node type and reading the host's `data` (the
 * direct route's body carries the same keys). Every surface derives from it —
 * the direct-route guard, the orchestrator's door, the publish rule and the
 * list the browser hides options by — so a new governed capability is one entry
 * here, not a fifth place to remember. Maps, not object literals: the keys
 * arrive from request bodies, and `"constructor"` must not resolve.
 */
const WEB_SCRAPE_SOURCE_GOVERNED_BY: ReadonlyMap<string, string> = new Map([["instagram", "instagram-scrape"]])

/**
 * A one-off voice clone inside a speech node (`replica`, Gemini 3.8 Flash) is
 * voice cloning behind another door (decided 2026-11-13): a deployment that
 * withholds the Voice Clone node withholds it too. Any `replica` asked counts,
 * well formed or not, so the refusal comes before anything is read.
 */
const ONE_OFF_CLONE = { governedBy: ONE_OFF_VOICE_CLONE_FEATURE, label: "a one-off voice clone" } as const
const asksClone = (value: unknown): boolean => value !== undefined && value !== null
/** The voices a dialogue's lines speak with: only a clone a line uses is sent, so only it is judged. */
export function dialogueLineVoices(data: Readonly<Record<string, unknown>>): Set<string> {
  const lines = Array.isArray(data.dialogue) ? data.dialogue : Array.isArray(data.script) ? data.script : []
  return new Set(lines.map((l) => (l as { voice?: unknown } | null)?.voice).filter((v): v is string => typeof v === "string"))
}


const GOVERNED_CAPABILITIES: ReadonlyMap<
  string,
  (data: Readonly<Record<string, unknown>>) => { governedBy: string; label: string } | undefined
> = new Map([
  // A competitor scan is Social Search run once per account and per platform:
  // withholding the node withholds the scans (manual and scheduled) too.
  ["competitor-scan", (_data: Readonly<Record<string, unknown>>) => ({ governedBy: "social-search", label: "competitor-scan" })],
  ["text-to-speech", (data) => (asksClone(data.replica) ? ONE_OFF_CLONE : undefined)],
  [
    "text-to-dialogue",
    (data) => {
      if (!Array.isArray(data.speakers)) return undefined
      const spoken = dialogueLineVoices(data)
      return data.speakers.some((s) => {
        const entry = s as { voice?: unknown; replica?: unknown } | null
        return !!entry && typeof entry.voice === "string" && spoken.has(entry.voice) && asksClone(entry.replica)
      })
        ? ONE_OFF_CLONE
        : undefined
    },
  ],
  [
    "web-scrape",
    (data) => {
      const governedBy = typeof data.actor === "string" ? WEB_SCRAPE_SOURCE_GOVERNED_BY.get(data.actor) : undefined
      // The label reuses the credit-id spelling (`web-scrape:instagram`), the one
      // name this capability already has everywhere else.
      return governedBy ? { governedBy, label: `web-scrape:${data.actor as string}` } : undefined
    },
  ],
])

function hostedCapability(hostType: string, data: unknown): { governedBy: string; label: string } | undefined {
  if (!data || typeof data !== "object") return undefined
  return GOVERNED_CAPABILITIES.get(hostType)?.(data as Readonly<Record<string, unknown>>)
}

/** True when `hostType` hosts a capability another node governs — a type the
 *  availability funnel knows even when it is no registry node (competitor-scan). */
export function isCapabilityHost(hostType: string): boolean {
  return GOVERNED_CAPABILITIES.has(hostType)
}

/** The node type whose availability governs the capability `hostType` is
 *  configured to use, if any. */
export function governingNodeType(hostType: string, data: unknown): string | undefined {
  return hostedCapability(hostType, data)?.governedBy
}

/**
 * Every availability question a node raises, in the order a refusal should name
 * them: its own type first, then the capability it hosts. `label` is what the
 * refusal says.
 */
export function availabilityChecksFor(hostType: string, data: unknown): ReadonlyArray<{ governedBy: string; label: string }> {
  const hosted = hostedCapability(hostType, data)
  return hosted ? [{ governedBy: hostType, label: hostType }, hosted] : [{ governedBy: hostType, label: hostType }]
}

/**
 * What in `nodes` is not available to `viewer` — node types AND the capabilities
 * they host. Wider than `findDeniedNodeTypes` on purpose: that one backs the
 * WRITE guards, and a save must not start failing for a user whose existing
 * workflow merely points at a withdrawn source (they have to be able to move off
 * it). Running and publishing are where a withdrawn capability is refused.
 */
export function findUnavailableCapabilities(
  nodes: ReadonlyArray<{ type?: unknown; data?: unknown }> | undefined,
  viewer: AvailabilityViewer,
): string[] {
  if (!nodes?.length) return []
  const found = new Set<string>()
  for (const n of nodes) {
    if (typeof n?.type !== "string") continue
    const denied = availabilityChecksFor(n.type, n.data).find((c) => isNodeDenied(c.governedBy, viewer))
    if (denied) found.add(denied.label)
  }
  return [...found]
}

/** Web Scrape sources withdrawn from `viewer` — what the browser hides in the
 *  source dropdown (GET /v1/surface/availability). */
export function effectiveDeniedWebScrapeSources(viewer: AvailabilityViewer): string[] {
  return [...WEB_SCRAPE_SOURCE_GOVERNED_BY].filter(([, node]) => isNodeDenied(node, viewer)).map(([source]) => source)
}

/** Web Scrape sources an admin can use and a user cannot (the picker marks them). */
export function webScrapeSourcesHiddenFromUsers(): string[] {
  const forAdmins = new Set(effectiveDeniedWebScrapeSources(ADMIN_VIEWER))
  return effectiveDeniedWebScrapeSources(USER_VIEWER).filter((source) => !forAdmins.has(source))
}

/**
 * What in `nodes` the people a PUBLISHED thing is for cannot run.
 *
 * An app, a component or a template is run by its users — an app run executes
 * as its runner, a cloned template belongs to whoever cloned it — so what is
 * published must be runnable by them. Always the USER view, on purpose, even
 * when the publisher is an admin who can run the node themselves: otherwise
 * every run would fail part-way (after the upstream nodes had already billed
 * the runner), and the node would ride the PUBLIC app manifest while discovery
 * still hides it. Covers hosted capabilities too (a Web Scrape node pointed at
 * a withdrawn source).
 */
export function findUnpublishableNodeTypes(nodes: ReadonlyArray<{ type?: unknown; data?: unknown }> | undefined): string[] {
  return findUnavailableCapabilities(nodes, USER_VIEWER)
}

/** Shared refusal text for every publish lane. */
export function unpublishableNodesMessage(types: readonly string[]): string {
  const many = types.length > 1
  return (
    `This workflow uses ${many ? "nodes that are" : "a node that is"} not available to users on this deployment: ` +
    `${types.join(", ")}. What you publish is run by its users, so it cannot include ${many ? "them" : "it"} — ` +
    `remove ${many ? "them" : "it"}, or release ${many ? "them" : "it"} in Admin → Availability first.`
  )
}

/** The coded run-time refusal — one shape for every door that throws it, so a
 *  caller can match on `code` whichever lane refused. */
export function nodeNotAvailableError(types: readonly string[]): Error & { code: "node_not_available" } {
  return Object.assign(new Error(deniedNodeRejectionMessage(types)), { code: "node_not_available" as const })
}

/**
 * The FACTORY layer alone for a model (profile allow/deny), ignoring the admin
 * override and the admin's model switch: what this deployment offers by its own
 * configuration. What a boot-time check judges against — the admin layers change
 * at run time, are loaded only later in boot, and asking them kicks a load.
 */
export function isModelFactoryDenied(id: string): boolean {
  const { deny, allow } = runtimeSurfaceProfile().models
  if (allow.length && GATEABLE_MODEL_IDS.has(id) && !allow.includes(id)) return true
  return deny.includes(id)
}

/**
 * True when `id` is a house model (a catalog entry marked `ownLabel`) this
 * install does not serve: no plugin supplies its upstream here (community,
 * business, a plugin build without it, or before the plugins have loaded).
 * Part of the code/edition layer: no profile, override or admin switch hands
 * it back, and it is false for every other model (lib/house-models.ts).
 */
export function isHouseModelUnserved(id: string): boolean {
  return isOwnLabelModel(id) && !houseModelServed(id)
}

/** True when this deployment does not offer this model id. */
export function isModelDenied(id: string): boolean {
  // A house model this install does not serve is no model here at all.
  if (isHouseModelUnserved(id)) return true
  // Layer 4 first: the admin's switch is not something an override can lift.
  if (isModelSwitchedOff(id)) return true
  const override = availabilityOverride("models")
  if (override) return GATEABLE_MODEL_IDS.has(id) && !override.has(id)
  return isModelFactoryDenied(id)
}

/**
 * The house rule ALONE, for a deployment that does not restrict models
 * (`modelRestrictionConfigured()` false): of the ids `ids()` reads, the house
 * models this install does not serve. Any model that is not own-label is no
 * concern of it and is never judged here, so an admin's switch-off or a
 * profile list keeps exactly the effect it has on an install with no house
 * model. Undefined, without calling `ids`, when there is nothing to ask: the
 * catalog has no house model this process does not know to be served
 * (`houseRuleWithholdsAModel`). `houseModelServed` may throw where the served
 * ids are not known yet (the orchestrator); that is the caller's to handle.
 */
export function unservedHouseModelsOf(ids: () => readonly unknown[]): string[] | undefined {
  if (!houseRuleWithholdsAModel()) return undefined
  return [...new Set(ids())].filter((id): id is string => typeof id === "string" && isHouseModelUnserved(id))
}

/** How deep {@link namesHouseModel} reads a request body: a field, an item of a list, or a field one object down. */
const NAMES_HOUSE_MODEL_MAX_DEPTH = 3

/**
 * True when a request body names a house model anywhere a string can stand
 * (a field, an item of a list, a field of a nested object, up to
 * {@link NAMES_HOUSE_MODEL_MAX_DEPTH} levels). Where an own-label id is
 * POSSIBLE for a request without a model restriction: no default model is a
 * house model (house-models-tables.test.ts holds every default), so a request
 * runs one only by naming it. Never throws.
 */
export function namesHouseModel(body: unknown, depth = 0): boolean {
  try {
    if (typeof body === "string") return isOwnLabelModel(body)
    if (depth >= NAMES_HOUSE_MODEL_MAX_DEPTH || body === null || typeof body !== "object") return false
    const values = Array.isArray(body) ? body : Object.values(body as Record<string, unknown>)
    return values.some((v) => namesHouseModel(v, depth + 1))
  } catch {
    return false
  }
}

/**
 * True when this deployment RESTRICTS models: its profile names `models.allow`
 * or `models.deny`, or an admin's stored models override (Admin →
 * Availability) leaves at least one gateable model off — an override that
 * ticks every model withholds nothing. What gates the credit guard's run-model
 * check (`CreditGuardOpts.runModel`), the workflow's default-model judge, the
 * new-node model moves and `models.restricted`: a deployment with no
 * restriction never asks which model a request runs on, so nothing it answers
 * changes. The admin's per-row model switch is not a restriction in this sense
 * — a run priced on a switched-off row is refused by the credit check, as it
 * always was.
 *
 * A house model this install does not serve is NOT a restriction: it withholds
 * only itself. It is hidden from every listing and refused before any hold
 * wherever it is named (`isModelDenied`), and where a request could run one
 * without naming it the narrow house-only judgment (`unservedHouseModelsOf`)
 * refuses it alone — every other model behaves exactly as on an install with
 * no house model.
 */
export function modelRestrictionConfigured(): boolean {
  const { allow, deny } = runtimeSurfaceProfile().models
  if (allow.length > 0 || deny.length > 0) return true
  const override = availabilityOverride("models")
  return override !== null && overrideWithholdsAModel(override)
}

/** Per loaded override set (each refresh loads a new one): does it leave a gateable model off? */
const overrideWithholds = new WeakMap<ReadonlySet<string>, boolean>()
function overrideWithholdsAModel(override: ReadonlySet<string>): boolean {
  let withholds = overrideWithholds.get(override)
  if (withholds === undefined) {
    withholds = [...GATEABLE_MODEL_IDS].some((id) => !override.has(id))
    overrideWithholds.set(override, withholds)
  }
  return withholds
}

/** Shared refusal text for a denied model, parallel to the node message. */
export function deniedModelRejectionMessage(ids: readonly string[]): string {
  return (
    `This workflow uses ${ids.length > 1 ? "models that are" : "a model that is"} not available on this deployment: ` +
    `${ids.join(", ")}. Switch to an available model to run this workflow.`
  )
}

/** The coded run-time refusal of a denied model — one shape for every door
 *  that throws it (the workflow build's backstops), parallel to the node one. */
export function modelNotAvailableError(ids: readonly string[]): Error & { code: "model_not_available" } {
  return Object.assign(new Error(deniedModelRejectionMessage(ids)), { code: "model_not_available" as const })
}

/**
 * Recommendations ("best for X" picks) as this install can offer them: a house
 * model it does not serve is left out of each, and a recommendation left with
 * no model is dropped. Every other recommendation is returned as it came (the
 * same object), so an install that serves every house model — or a catalog
 * with none — lists exactly what it always did.
 */
export function recommendationsServedHere<T extends { readonly modelIds: readonly string[] }>(recs: readonly T[]): T[] {
  const out: T[] = []
  for (const rec of recs) {
    if (!rec.modelIds.some(isHouseModelUnserved)) {
      out.push(rec)
      continue
    }
    const modelIds = rec.modelIds.filter((id) => !isHouseModelUnserved(id))
    if (modelIds.length > 0) out.push({ ...rec, modelIds })
  }
  return out
}

/** Drop models the deployment does not offer (applied at each read/projection site). */
export function filterDeniedModels<T extends { id: string }>(models: readonly T[]): T[] {
  return models.filter((m) => !isModelDenied(m.id))
}

/**
 * The EFFECTIVE denied sets over the gateable universes — what the browser's
 * picker/dropdown filters mirror (GET /v1/surface/availability). Explicit
 * profile `deny` entries outside the universe are included so the frontend
 * keeps hiding them exactly as it does today.
 */
export function effectiveDeniedNodeTypes(viewer: AvailabilityViewer): string[] {
  const denied = new Set<string>()
  for (const t of GATEABLE_NODE_TYPES) if (isNodeDenied(t, viewer)) denied.add(t)
  for (const t of runtimeSurfaceProfile().nodes.deny) if (isNodeDenied(t, viewer)) denied.add(t)
  for (const t of switchedOffNodeTypes()) denied.add(t)
  return [...denied]
}

/**
 * Node types an admin can use and a user cannot — what the admin switch is
 * currently withholding. The picker marks these for admins, so a workflow built
 * on one is not mistaken for something users can run.
 */
export function nodesHiddenFromUsers(): string[] {
  return effectiveDeniedNodeTypes(USER_VIEWER).filter((t) => !isNodeDenied(t, ADMIN_VIEWER))
}

export function effectiveDeniedModelIds(): string[] {
  const denied = new Set<string>()
  for (const id of GATEABLE_MODEL_IDS) if (isModelDenied(id)) denied.add(id)
  for (const id of runtimeSurfaceProfile().models.deny) if (isModelDenied(id)) denied.add(id)
  // The switch is keyed by pricing identifier, so a switched-off id outside the
  // gateable universe is listed too — the browser hides exactly what runs refuse.
  for (const id of switchedOffModelIds()) if (isModelDenied(id)) denied.add(id)
  return [...denied]
}

// ── Worlds ───────────────────────────────────────────────────────────────────

/**
 * The worlds this deployment offers `viewer` (the shared header's tabs), every
 * one listed, in the profile's display order. A world is enabled when the
 * profile's `worlds.allow` lets it through (when set) AND every node type it
 * runs passes `isNodeDenied` for this viewer, the predicate the write and run
 * guards apply to those node types. Which node types a world runs is shared
 * data (WORLD_REQUIRED_NODE_TYPES).
 *
 * Edition gates (Cloud-only and Nodaro-exclusive nodes) are their own layer
 * and are not folded in here, as everywhere in this module.
 */
export function effectiveWorlds(viewer: AvailabilityViewer): Array<{ id: WorldId; enabled: boolean }> {
  const worlds = runtimeSurfaceProfile().worlds
  return orderWorlds(worlds?.order).map((id) => ({
    id,
    enabled: worldAllowed(worlds, id) && WORLD_REQUIRED_NODE_TYPES[id].every((type) => !isNodeDenied(type, viewer)),
  }))
}
