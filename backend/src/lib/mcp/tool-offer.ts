import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import type { WorldId } from "@nodaro/shared/runtime-config"
import { GATEABLE_NODE_TYPES, ROUTE_GATES_GENERATION, availabilityOverride } from "../availability-override.js"
import { deniedCapabilityForViewer, deniedRouteCapabilityForViewer, viewerForUser } from "../availability-viewer.js"
import { LINK_IMPORTS_DISABLED_MESSAGE } from "../link-imports.js"
import { refusesUnclassifiedRoutes, routeNodeGate, unclassifiedRouteMessage } from "../route-node-gate.js"
import {
  USER_VIEWER,
  deniedModelRejectionMessage,
  deniedNodeRejectionMessage,
  effectiveWorlds,
  isModelDenied,
  isNodeDenied,
  modelRestrictionConfigured,
  nodesHiddenFromUsers,
  type AvailabilityViewer,
} from "../surface-deny.js"
import { runtimeSurfaceProfile, surfaceAllowsLinkImports } from "../surface-profile.js"
import { withToolDescriptionNotes } from "./offer-note.js"
import type { McpSession } from "./session.js"
import { outsideAddressRefusal } from "./tool-addresses.js"
import { TOOL_NEEDS, type RouteNeed, type ToolNeed } from "./tool-needs.js"
import { errorResult } from "./tools/_verb-helpers.js"

/**
 * The MCP tool list follows what the deployment offers (decided 2026-11-11).
 *
 * On a deployment that restricts what it offers — a surface profile's
 * `nodes.allow` / `nodes.deny`, an Admin → Availability override that leaves a
 * node off, a model restriction, a `worlds.allow`, link imports off — a session
 * is offered a tool only when everything the tool needs (`tool-needs.ts`) is
 * offered to THIS viewer, judged by the functions a run is judged by: the
 * route's node through `lib/route-node-gate.ts` and the viewer-aware node gate
 * (`lib/availability-viewer.ts`), the world gate (`effectiveWorlds`), the
 * link-import switch, and — where models are restricted — the model door
 * (`isModelDenied`).
 *
 * A withheld tool is never registered, so `tools/list` does not name it and
 * no schema is built for it. A call to it answers the coded refusal the run
 * would give (`node_not_available`, `model_not_available`,
 * `link_imports_disabled`; `world_not_available` for a world, which no run
 * door has), before anything is read, created or reserved: a client that
 * listed the tools before the deployment changed its answer (clients cache the
 * list for days) learns why, as the REST route tells it, instead of hearing
 * that the tool does not exist.
 *
 * WHEN IT REFRESHES. The server is built per request, so each `tools/list`
 * and each call is judged against the deployment's answer at that moment —
 * the Availability override's own ~60 s cache is the only lag, the same one
 * the run's refusal has. A server kept across calls (the in-app Copilot's, per
 * turn) re-judges each call, so a tool withheld mid-turn is refused at its
 * next call. There is no `tools/list_changed` push: the HTTP transport is
 * stateless JSON with no stream to send one on.
 *
 * THE ADDRESSES A CALL CARRIES. Where link imports are off, a call to a tool
 * that IS offered is still refused, with `link_imports_disabled`, when one of
 * its arguments is a link outside this deployment's storage
 * (`tool-addresses.ts`): judged here, before the tool runs, whatever route,
 * plugin or service the tool would reach.
 *
 * WHAT THE LISTED TOOLS SAY. A listed tool's description, or an argument's,
 * can name a sibling tool the session is not listed or a model the deployment
 * withholds (a model enum, a "one of …" list, a default). Its schema is left
 * as registered — a model enum cannot be narrowed through one funnel without
 * emptying the enum of a tool that stays listed (a deployment that offers no
 * language model still lists `generate_text`, whose node it offers) — and the
 * description ends with a generated note naming what is not offered here
 * (`offer-note.ts`, decided 2026-11-16). A call naming a withheld model is
 * refused by the run's model door, as before.
 *
 * NOTHING RESTRICTED, NOTHING CHANGES. Where the deployment restricts nothing
 * no tool is judged, every registration goes through untouched, and every
 * call reaches its tool as before (`tool-list-wire.test.ts` records the whole
 * list).
 */

export type ToolRefusalCode = "node_not_available" | "model_not_available" | "link_imports_disabled" | "world_not_available"

export interface ToolRefusal {
  readonly code: ToolRefusalCode
  readonly message: string
}

/** What one session is offered. */
export interface ToolOffer {
  /** Who is asking: an admin keeps a node the admin switch hides from users (lib/surface-deny.ts). */
  readonly viewer: AvailabilityViewer
  /** Why `tool` is withheld from this viewer, or undefined when everything it needs is offered (or it is undeclared). */
  refusalOf(tool: string): ToolRefusal | undefined
  /** Whether this viewer is offered the node type `type` (a family's own subsets: the use-case verbs). */
  nodeOffered(type: string): boolean
  /** Whether this deployment offers the model `id`: the run's own model door (`isModelDenied`). */
  modelOffered(id: string): boolean
}

/**
 * True when this deployment restricts what it offers — the one condition under
 * which a tool is judged at all. A house model this install does not serve,
 * an install switch (`SITE_CAPTURE_ENABLED`) and the admin's per-row model
 * switch are not restrictions here, as they are not for the model door: the
 * tools they concern keep the inline switches they always had.
 */
export function offerRestricted(): boolean {
  const profile = runtimeSurfaceProfile()
  if (profile.nodes.allow.length > 0 || profile.nodes.deny.length > 0) return true
  if (availabilityOverride("nodes") !== null && [...GATEABLE_NODE_TYPES].some((t) => isNodeDenied(t, USER_VIEWER))) return true
  if (modelRestrictionConfigured()) return true
  if (profile.worlds?.allow !== undefined) return true
  return !surfaceAllowsLinkImports()
}

/** The models of a catalog family, in catalog order. */
function familyModelIds(family: string): string[] {
  return Object.values(MODEL_CATALOG)
    .filter((m) => m.family === family)
    .map((m) => m.id)
}

function nodeRefusal(label: string): ToolRefusal {
  return { code: "node_not_available", message: deniedNodeRejectionMessage([label]) }
}

function worldRefusal(world: WorldId): ToolRefusal {
  return { code: "world_not_available", message: `The "${world}" world is not offered on this deployment.` }
}

/** The run door of one declared route, for this viewer: the route's own node gate, as the credit guard asks it. */
function routeRefusal(need: RouteNeed, viewer: AvailabilityViewer): ToolRefusal | undefined {
  const { route, body } = typeof need === "string" ? { route: need, body: {} } : need
  const gate = routeNodeGate(route, body)
  if (gate.kind === "node") {
    const denied = deniedRouteCapabilityForViewer(gate.types, body, viewer, gate.since)
    return denied === undefined ? undefined : nodeRefusal(denied)
  }
  // A route no node accounts for is refused under a whitelist by the run too
  // (the census keeps the table free of them).
  if (gate.kind === "unclassified" && refusesUnclassifiedRoutes()) return { code: "node_not_available", message: unclassifiedRouteMessage(route) }
  return undefined
}

/** Why `need` is not offered to `viewer`, or undefined. The order a refusal names them in: nodes, world, links, models. */
export function needRefusal(need: ToolNeed, viewer: AvailabilityViewer): ToolRefusal | undefined {
  if (need.none !== undefined) return undefined
  if (need.routes && need.routes.length > 0) {
    let first: ToolRefusal | undefined
    for (const route of need.routes) {
      const refused = routeRefusal(route, viewer)
      if (refused === undefined) {
        first = undefined
        break
      }
      first ??= refused
    }
    if (first) return first
  }
  for (const step of need.steps ?? []) {
    const refused = routeRefusal(step, viewer)
    if (refused) return refused
  }
  for (const node of need.nodes ?? []) {
    // A door with no route of its own, asked as route gating's doors are
    // (`requireNodeAvailable`): an override stored before them never decided it.
    const denied = deniedCapabilityForViewer(node, {}, viewer, ROUTE_GATES_GENERATION)
    if (denied !== undefined) return nodeRefusal(denied)
  }
  if (need.world && !effectiveWorlds(viewer).some((w) => w.id === need.world && w.enabled)) return worldRefusal(need.world)
  if (need.linkImports && !surfaceAllowsLinkImports()) return { code: "link_imports_disabled", message: LINK_IMPORTS_DISABLED_MESSAGE }
  // Judged only where models are restricted, as the credit guard's run-model door is.
  if (need.modelFamily && modelRestrictionConfigured()) {
    const ids = familyModelIds(need.modelFamily)
    if (!ids.some((id) => !isModelDenied(id))) return { code: "model_not_available", message: deniedModelRejectionMessage(ids) }
  }
  return undefined
}

/**
 * What this deployment offers `userId`'s session, or undefined when it
 * restricts nothing (no tool is judged). The viewer is looked up only where
 * the admin switch hides a node from users that an admin keeps — on every
 * other deployment everyone is asked as a user and nothing touches the
 * database (lib/availability-viewer.ts, "no lookup on the common path").
 */
export async function resolveToolOffer(userId: string): Promise<ToolOffer | undefined> {
  if (!offerRestricted()) return undefined
  const viewer = nodesHiddenFromUsers().length > 0 ? await viewerForUser(userId) : USER_VIEWER
  const verdicts = new Map<string, ToolRefusal | undefined>()
  return {
    viewer,
    refusalOf(tool) {
      if (verdicts.has(tool)) return verdicts.get(tool)
      const need = Object.hasOwn(TOOL_NEEDS, tool) ? TOOL_NEEDS[tool] : undefined
      const verdict = need ? needRefusal(need, viewer) : undefined
      verdicts.set(tool, verdict)
      return verdict
    },
    nodeOffered: (type) => !isNodeDenied(type, viewer),
    modelOffered: (id) => !isModelDenied(id),
  }
}

/**
 * Whether `session` is offered the node type `type` — for a family whose own
 * text or subsets follow the offer (which use-case verbs `continue_use_case`
 * names). A session built where nothing is restricted carries no offer, and is
 * asked as a user, as before.
 */
export function nodeOfferedTo(session: Pick<McpSession, "offer">, type: string): boolean {
  return session.offer ? session.offer.nodeOffered(type) : !isNodeDenied(type, USER_VIEWER)
}

/**
 * The refusal of a NODE TYPE named in a call (a node's skill), where the
 * deployment restricts what it offers and withholds it from this viewer; else
 * undefined. A session with no offer is never refused here.
 */
export function nodeWithheldRefusal(session: Pick<McpSession, "offer">, type: string): ToolRefusal | undefined {
  return session.offer && !session.offer.nodeOffered(type) ? nodeRefusal(type) : undefined
}

/** The answer to a call of a withheld tool: the route's 403 as a verb tool renders it. */
export function refusalResult(refusal: ToolRefusal) {
  return errorResult(403, JSON.stringify({ error: { code: refusal.code, message: refusal.message } }))
}

const reportedUndeclared = new Set<string>()

/**
 * A tool registered with no entry in `TOOL_NEEDS` keeps today's behaviour —
 * listed, never judged — and is named once per process so it gets one. Under
 * Vitest it is a failure instead: every test that builds the server is part
 * of the totality guard.
 */
function reportUndeclared(name: string): void {
  if (process.env.VITEST) throw new Error(`MCP tool "${name}" has no entry in TOOL_NEEDS (lib/mcp/tool-needs.ts): declare what it needs, or why it needs nothing.`)
  if (reportedUndeclared.has(name)) return
  reportedUndeclared.add(name)
  console.error(`[mcp-tool-offer] MCP tool "${name}" declares no need in lib/mcp/tool-needs.ts — it is listed on every deployment.`)
}

type ToolCallback = (...args: unknown[]) => unknown
type CallHandler = (request: { params: { name: string; arguments?: unknown } }, extra: unknown) => unknown

/**
 * Put the offer between the server and its tools, BEFORE any tool registers:
 * a tool `offer` withholds is not registered, and the server's `tools/call`
 * answers a call naming it with its refusal. Every other call is judged again
 * when it is made (a server kept across calls), and reaches its tool when
 * nothing is withheld. With no offer (nothing restricted) every registration
 * passes through untouched.
 *
 * Where link imports are off, a call is also refused when its arguments carry
 * an address outside this deployment's storage (`tool-addresses.ts`, decided
 * 2026-11-11), with the same refusal, before the tool runs. With link imports
 * on the call reaches its tool exactly as it was sent: nothing is read.
 *
 * WHOSE OFFER. The list and `withheld` are decided once, when the tools
 * register, from `opts.offer`: the offer for the viewer this server was built
 * for. A tool withheld then is refused for every later call on this server,
 * whoever makes it, and `tools/list` is that viewer's list. That is exact while
 * each request builds its own server (one caller per server). It is as exact
 * for tools built once and used by many callers (`tools-built-once.ts`): such
 * a build is shared only by callers whose offer decides the same list and the
 * same `withheld` (its build shape includes every tool's refusal).
 * What IS read per call: a tool that registered is judged again for the user
 * making the call (`session.userId`, read when the call arrives), which is how
 * an override saved since the build is honoured.
 */
export function installToolOffer(server: McpServer, opts: { session: Pick<McpSession, "userId">; offer: ToolOffer | undefined }): void {
  const withheld = new Map<string, ToolRefusal>()
  // Each tool's schema as it registered it, for the addresses a call carries.
  const schemas = new Map<string, unknown>()
  const register = server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, cb: ToolCallback) => unknown
  const patchedRegister = (name: string, config: Record<string, unknown>, cb: ToolCallback): unknown => {
    if (!Object.hasOwn(TOOL_NEEDS, name)) reportUndeclared(name)
    const refusal = opts.offer?.refusalOf(name)
    if (refusal) {
      withheld.set(name, refusal)
      return undefined
    }
    schemas.set(name, config?.inputSchema)
    return register(name, config, cb)
  }
  ;(server as unknown as { registerTool: typeof patchedRegister }).registerTool = patchedRegister

  // The SDK installs its `tools/call` handler on the first registration,
  // through the protocol's public `setRequestHandler`: the offer wraps it there.
  const inner = server.server as unknown as { setRequestHandler: (schema: unknown, handler: CallHandler) => void }
  const setRequestHandler = inner.setRequestHandler.bind(inner)
  inner.setRequestHandler = (schema, handler) => {
    // The descriptions of the tools it lists say what they name that is not
    // offered here (offer-note.ts); with no offer the list leaves as it came.
    const offer = opts.offer
    if (schema === ListToolsRequestSchema && offer) {
      return setRequestHandler(schema, async (request, extra) => withToolDescriptionNotes(await handler(request, extra), offer))
    }
    if (schema !== CallToolRequestSchema) return setRequestHandler(schema, handler)
    return setRequestHandler(schema, async (request, extra) => {
      const name = request?.params?.name
      const refusal =
        typeof name !== "string"
          ? undefined
          : (withheld.get(name) ?? (Object.hasOwn(TOOL_NEEDS, name) ? (await resolveToolOffer(opts.session.userId))?.refusalOf(name) : undefined))
      if (refusal) return refusalResult(refusal)
      if (!surfaceAllowsLinkImports() && typeof name === "string") {
        const outside = outsideAddressRefusal(name, request.params.arguments, schemas.get(name))
        if (outside) return refusalResult(outside)
      }
      return handler(request, extra)
    })
  }
}
