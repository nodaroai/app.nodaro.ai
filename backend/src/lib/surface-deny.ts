import { runtimeSurfaceProfile } from "./surface-profile.js"
import {
  availabilityOverride,
  GATEABLE_NODE_TYPES,
  GATEABLE_MODEL_IDS,
} from "./availability-override.js"

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
 * THREE LAYERS, resolved here so every chokepoint stays a one-word predicate:
 *
 *   1. code/edition — what the build ships (edition gates are their own layer
 *      and always apply on top: cloud-only-nodes etc.).
 *   2. surface profile (the FACTORY set) — `allow` non-empty ⇒ whitelist over
 *      the gateable universe, minus `deny`. The whitelist is the safer,
 *      recommended shape for a curated deployment: a node the profile never
 *      heard of is unavailable by default instead of available by omission.
 *   3. admin override (availability-override.ts) — a stored enabled-set that
 *      REPLACES layer 2 while present; "reset to factory" deletes it.
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

/** The FACTORY layer alone (profile allow/deny), ignoring any admin override —
 *  what this deployment offers before its admins released or withheld anything. */
export function isNodeFactoryDenied(type: string): boolean {
  const { deny, allow } = runtimeSurfaceProfile().nodes
  if (allow.length && GATEABLE_NODE_TYPES.has(type) && !allow.includes(type)) return true
  return deny.includes(type)
}

/** True when this deployment does not offer this node type to `viewer`. */
export function isNodeDenied(type: string, viewer: AvailabilityViewer): boolean {
  const override = availabilityOverride("nodes")
  if (!override) return isNodeFactoryDenied(type)
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

const GOVERNED_CAPABILITIES: ReadonlyMap<
  string,
  (data: Readonly<Record<string, unknown>>) => { governedBy: string; label: string } | undefined
> = new Map([
  // A competitor scan is Social Search run once per account and per platform:
  // withholding the node withholds the scans (manual and scheduled) too.
  ["competitor-scan", (_data: Readonly<Record<string, unknown>>) => ({ governedBy: "social-search", label: "competitor-scan" })],
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

/** True when this deployment does not offer this model id. */
export function isModelDenied(id: string): boolean {
  const override = availabilityOverride("models")
  if (override) return GATEABLE_MODEL_IDS.has(id) && !override.has(id)
  const { deny, allow } = runtimeSurfaceProfile().models
  if (allow.length && GATEABLE_MODEL_IDS.has(id) && !allow.includes(id)) return true
  return deny.includes(id)
}

/** Shared refusal text for a denied model, parallel to the node message. */
export function deniedModelRejectionMessage(ids: readonly string[]): string {
  return (
    `This workflow uses ${ids.length > 1 ? "models that are" : "a model that is"} not available on this deployment: ` +
    `${ids.join(", ")}. Switch to an available model to run this workflow.`
  )
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
  return [...denied]
}
