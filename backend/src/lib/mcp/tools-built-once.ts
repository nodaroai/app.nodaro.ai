/**
 * MCP TOOLS BUILT ONCE (`MCP_TOOLS_BUILT_ONCE`, experimental, default off).
 *
 * Without the flag, every `/mcp` request builds every tool, its schema and its
 * description for itself (`buildMcpServer`), uses one of them, and drops them:
 * tens of MB allocated per request, all of it held for as long as the request
 * is in flight. With the flag on, the tools are built once per BUILD SHAPE and
 * each request gets a small server of its own that runs them for its session.
 *
 * WHAT IS SHARED, AND WHAT IS NOT.
 *  - Shared between the requests of one build shape: the registered tools,
 *    resources and request handlers (made by the same `registerMcpTools` body
 *    `buildMcpServer` runs), the server's capabilities and name, and the
 *    `tools/list` answer, made with the build. None of it holds a caller: a
 *    registration may read only the session fields in `READ_AT_REGISTRATION`,
 *    which the build shape includes, and the census proves no registration
 *    reads any other (`registration-reads-census.test.ts`).
 *  - Per request: the session (resolved by `resolveMcpSession`, exactly as
 *    `buildMcpServer` resolves it), the SDK server and transport, and every
 *    handler call. The tools hold one session object, a VIEW that answers the
 *    session of the request the handler runs for (an AsyncLocalStorage entered
 *    by the request's own server around each call). It never answers anything
 *    outside a request, and it never answers one request with another's.
 *
 * THE BUILD SHAPE (`buildShapeOf`) is everything that decides which tools a
 * request is offered and how they are described, as each request sees it:
 * its scopes (as a set), whether it carries a conversation, its addresses,
 * what the deployment offers it (every tool's refusal and every gateable
 * node's verdict for its viewer), whether Site Capture is offered, the metered
 * LLM pricing switch, the edition switches registration reads, the node
 * universe, and which surface profile and plugin services and engines the
 * process holds. A value that changes while the process runs (an Availability
 * override an admin saves, the admin's model switch, the metered switch when
 * its schema is found) changes the shape, so the next request builds anew; a
 * build no shape asks for any more ages out of the cache.
 *
 * THE CACHE is per Fastify instance (a tool calls its routes on the instance
 * it was built with) and keeps at most `MAX_SHARED_MCP_BUILDS` builds, least
 * recently used out first.
 *
 * WHAT A TOOL MUST NEVER DO. A tool may read its session anywhere in its
 * handler, including after an await, but never inside a callback that runs
 * later for whoever triggers it: an event listener, a callback kept in a queue,
 * a map or a set, a subscription, an interval. The session answers the caller
 * of the async context the code runs in; a listener runs in the context of the
 * code that fires it, so with the tools shared it would read the caller who
 * fired it, not the one who registered it. Read the value before registering
 * the callback and pass it in (`stored-callback-session-guard.test.ts`). The
 * session object itself is never a key or compared by identity either
 * (`session-identity-guard.test.ts`).
 *
 * FAILING CLOSED. A registration that reads any other field of the session,
 * at the top or under `offer` or `addresses`, makes the build fail: that
 * request, and every later one of its shape until the process restarts, is
 * served by a build of its own (as with the flag off). The failure, naming the
 * field and the line, is logged once as a warning
 * (`[mcp-built-once] a shared build failed…`) and filed once to app_reports
 * (kind `mcp-shared-build-failed`). A session read made outside any request
 * throws. A shared build sends nothing on its own (its transport refuses).
 * In-app sessions (first-party, or pinned to a project) are always served by
 * a build of their own. `[mcp-built-once] shared builds` lines count hits,
 * misses, failures, own builds, evictions and distinct shapes.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import type { FastifyInstance } from "fastify"
import { createMcpServer, registerMcpTools, resolveMcpSession, type McpBuildOpts, type McpRegistration } from "./server.js"
import type { McpSession } from "./session.js"
import type { ToolOffer } from "./tool-offer.js"
import { TOOL_NEEDS } from "./tool-needs.js"
import { mcpServerInfo } from "./deployment-name.js"
import { siteCaptureOffered } from "./tools/verbs-site-capture.js"
import { GATEABLE_MODEL_IDS, GATEABLE_NODE_TYPES, nodeUniverseLoaded } from "../availability-override.js"
import { USER_VIEWER, isNodeDenied } from "../surface-deny.js"
import { hasCredits, hasOrganizations, llmMeteredPricing, siteCaptureEnabled } from "../config.js"
import { externalWalletConfigured } from "../external-wallet.js"
import { runtimeSurfaceProfile } from "../surface-profile.js"
import { getPluginServices } from "../private-plugins/services-registry.js"
import { getPluginEngines } from "../private-plugins/engine-registry.js"
import { scene3DProEngineReady } from "../../services/scene3d/scene3d-engine.js"
import { insertAppReport } from "../app-reports.js"

/**
 * Each session path a tool registration may read, and what it varies by. The
 * census (`registration-reads-census.test.ts`) fails on a registration that
 * reads any other, and on an entry no registration reads any more (this list
 * only shrinks); a shared build answers the top-level ones and refuses the
 * rest. A new entry needs its reason, and the build shape must vary by it.
 */
export const READ_AT_REGISTRATION: Readonly<Record<string, string>> = {
  scopes: "Varies per token: the scopes granted decide which tools are listed (each family's scope gate).",
  offer:
    "Its presence varies per deployment state: there is an offer only where the deployment restricts what it offers (a profile, or an Availability override an admin can change while the process runs).",
  "offer.nodeOffered":
    "Varies per deployment state and per the caller's admin bit: which nodes the use-case verbs name in their descriptions.",
  "offer.refusalOf":
    "Varies per deployment state and per the caller's admin bit: whether the Video Director tools' descriptions name capture_site (they name it only where the session is offered it). The build shape holds every tool's refusal.",
  addresses: "Varies per lane and declared host: the object is handed whole to the widget registrar, which reads the fields listed below.",
  "addresses.pagesBase": "Varies per lane and declared host: the archive link in delete_app_run's description.",
  "addresses.uploadPageBase": "Varies per lane and declared host: the upload widget's allowed connection in the widget pages' policy.",
}

/**
 * How many shared builds one server app keeps (each is tens of MB for a full
 * grant). Twelve, because one deployment's connected clients held eight
 * distinct grants: with six, the rarer grants were rebuilt on every use.
 */
export const MAX_SHARED_MCP_BUILDS = 12

/** How many failed build shapes are remembered (each is served by its own builds, and logged once). */
const MAX_REMEMBERED_FAILURES = 32

/** The request a shared build's handler is running for: only its session. */
interface CallerContext {
  readonly session: McpSession
}

const callerContext = new AsyncLocalStorage<CallerContext>()

const TOP_LEVEL_READS: ReadonlySet<string> = new Set(Object.keys(READ_AT_REGISTRATION).filter((path) => !path.includes(".")))

/** For a field read into (`offer`, `addresses`), the fields under it a registration may read. */
const READS_UNDER: ReadonlyMap<string, ReadonlySet<string>> = Object.keys(READ_AT_REGISTRATION)
  .filter((path) => path.includes("."))
  .reduce((under, path) => {
    const [top, field] = path.split(".") as [string, string]
    return new Map(under).set(top, new Set([...(under.get(top) ?? []), field]))
  }, new Map<string, ReadonlySet<string>>())

function refusedAtRegistration(path: string): Error {
  return new Error(
    `an MCP tool registration read session.${path} (${readSite()}), which a shared build may not: ` +
      `read it inside the tool's handler, or add it to READ_AT_REGISTRATION and the build shape`,
  )
}

/** Where in the code a session read came from (the first frame outside this file), for a failure's message. */
function readSite(): string {
  const frame = (new Error().stack ?? "")
    .split("\n")
    .slice(1)
    .find((line) => line.includes("/src/") && !line.includes("tools-built-once"))
  return frame ? (/\/src\/(.+?):(\d+):\d+\)?$/.exec(frame.trim())?.slice(1, 3).join(":") ?? "unknown") : "unknown"
}

/**
 * The one session object every tool of a shared build holds. While the build
 * registers, it answers the paths in `READ_AT_REGISTRATION` from the session
 * the build is made for, the fields under `offer` and `addresses` included,
 * and throws on any other; afterwards it answers the session of the request a
 * handler runs for, and throws outside any request.
 */
function sessionView(): { session: McpSession; registering<T>(representative: McpSession, register: () => T): T } {
  let building: McpSession | null = null
  const caller = (): McpSession => {
    const context = callerContext.getStore()
    if (context) return context.session
    throw new Error("MCP session read outside a request: a shared build's tools read the session only while a request runs")
  }
  const atRegistration = (prop: string | symbol): string => {
    if (typeof prop === "string" && TOP_LEVEL_READS.has(prop)) return prop
    throw refusedAtRegistration(String(prop))
  }
  // A field read into (the offer, the addresses), as registration sees it: only
  // its listed fields while the build registers. A registration may keep the
  // object (the widget registrar keeps the addresses), so once the build is
  // done every field of it reads as it is.
  const views = new WeakMap<object, object>()
  const readInto = (top: string, value: unknown): unknown => {
    const allowed = READS_UNDER.get(top)
    if (!allowed || value === null || typeof value !== "object") return value
    let view = views.get(value)
    if (!view) {
      const check = (prop: string | symbol): void => {
        if (building && !(typeof prop === "string" && allowed.has(prop))) throw refusedAtRegistration(`${top}.${String(prop)}`)
      }
      view = new Proxy(value, {
        get(target, prop, receiver) {
          check(prop)
          return Reflect.get(target, prop, receiver)
        },
        has(target, prop) {
          check(prop)
          return Reflect.has(target, prop)
        },
        getOwnPropertyDescriptor(target, prop) {
          check(prop)
          return Reflect.getOwnPropertyDescriptor(target, prop)
        },
        ownKeys(target) {
          if (building) throw refusedAtRegistration(`${top}.*`)
          return Reflect.ownKeys(target)
        },
        set(target, prop, next) {
          if (building) throw new Error(`an MCP tool registration wrote session.${top}.${String(prop)} (${readSite()})`)
          return Reflect.set(target, prop, next)
        },
      })
      views.set(value, view)
    }
    return view
  }
  const session = new Proxy({} as McpSession, {
    get(_target, prop) {
      if (building) {
        const field = atRegistration(prop)
        return readInto(field, Reflect.get(building, field))
      }
      return Reflect.get(caller(), prop)
    },
    set(_target, prop, value) {
      if (building) throw new Error(`an MCP tool registration wrote session.${String(prop)} (${readSite()})`)
      return Reflect.set(caller(), prop, value)
    },
    has(_target, prop) {
      if (building) return Reflect.has(building, atRegistration(prop))
      return Reflect.has(caller(), prop)
    },
    ownKeys() {
      if (building) throw new Error(`an MCP tool registration listed the session's fields (${readSite()})`)
      return Reflect.ownKeys(caller())
    },
    getOwnPropertyDescriptor(_target, prop) {
      const field = building ? atRegistration(prop) : prop
      const descriptor = Reflect.getOwnPropertyDescriptor(building ?? caller(), field)
      if (!descriptor) return undefined
      // Described as configurable: the view's own target has no such property.
      // While building, a value read this way is held to its listed fields too.
      return building && "value" in descriptor
        ? { ...descriptor, value: readInto(field as string, descriptor.value), configurable: true }
        : { ...descriptor, configurable: true }
    },
    defineProperty(_target, prop, descriptor) {
      if (building) throw new Error(`an MCP tool registration wrote session.${String(prop)} (${readSite()})`)
      return Reflect.defineProperty(caller(), prop, descriptor)
    },
    deleteProperty(_target, prop) {
      if (building) throw new Error(`an MCP tool registration wrote session.${String(prop)} (${readSite()})`)
      return Reflect.deleteProperty(caller(), prop)
    },
  })
  return {
    session,
    registering(representative, register) {
      building = representative
      try {
        return register()
      } finally {
        building = null
      }
    },
  }
}

type Handler = (request: unknown, extra: unknown) => unknown

interface SharedBuild {
  /** The registered tools (kept for their handlers; connected to a transport that sends nothing). */
  readonly server: McpServer
  readonly serverInfo: ReturnType<typeof mcpServerInfo>
  readonly capabilities: Record<string, unknown>
  /** Every request handler the registration installed, as the SDK received it, in order. */
  readonly handlers: ReadonlyArray<{ readonly schema: unknown; readonly handler: Handler }>
  /** The `tools/list` answer, made with the build (no caller in it). */
  readonly toolsList: unknown
}

/** Record every request handler the registration installs, beneath every wrapper installed after this. */
function recordRequestHandlers(server: McpServer): Map<unknown, Handler> {
  const inner = server.server as unknown as { setRequestHandler: (schema: unknown, handler: Handler) => void }
  const set = inner.setRequestHandler.bind(inner)
  const recorded = new Map<unknown, Handler>()
  inner.setRequestHandler = (schema, handler) => {
    recorded.set(schema, handler)
    return set(schema, handler)
  }
  return recorded
}

/** A transport for a shared build: it is never asked to carry anything, and refuses if it is. */
function sendsNothing(): Transport {
  return {
    start: async () => {},
    close: async () => {},
    send: async () => {
      throw new Error("a shared MCP build sends nothing on its own: a request answers through its own server")
    },
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

async function buildShared(representative: McpSession, registration: McpRegistration): Promise<SharedBuild> {
  const view = sessionView()
  const serverInfo = mcpServerInfo()
  const server = createMcpServer()
  const recorded = recordRequestHandlers(server)
  // Outside any request's context, so a registration can read no caller.
  callerContext.exit(() => view.registering(representative, () => registerMcpTools(server, view.session, registration)))
  // What `initialize` answers: the capabilities the SDK settled on while the
  // tools registered (it adds `listChanged` then), not the ones it was created
  // with. `getCapabilities` is a method of the SDK's server that its types mark
  // private; the equivalence test compares `initialize` on both paths.
  const settled = (server.server as unknown as { getCapabilities(): Record<string, unknown> }).getCapabilities()
  const capabilities = deepFreeze(structuredClone(settled))
  // The `tools/list` answer, made here, outside any request (a read of the
  // session throws, and the build fails), as the wire carries it, and frozen:
  // no request's caller is in it, and no request can change another's.
  const list = recorded.get(ListToolsRequestSchema)
  const toolsList = list ? deepFreeze(JSON.parse(JSON.stringify(await callerContext.exit(() => list({ method: "tools/list", params: {} }, {}))))) : undefined
  await server.connect(sendsNothing())
  return { server, serverInfo, capabilities, toolsList, handlers: [...recorded].map(([schema, handler]) => ({ schema, handler })) }
}

/** The server one request is answered by: the shared build's handlers, each run for this request's session. */
function requestServer(shared: SharedBuild, session: McpSession): Server {
  const server = new Server(shared.serverInfo, { capabilities: shared.capabilities })
  const context: CallerContext = { session }
  const install = server.setRequestHandler.bind(server) as (schema: unknown, handler: Handler) => void
  for (const { schema, handler } of shared.handlers) {
    if (schema === ListToolsRequestSchema && shared.toolsList !== undefined) {
      const toolsList = shared.toolsList
      install(schema, async () => toolsList)
      continue
    }
    install(schema, (request, extra) => callerContext.run(context, () => handler(request, extra)))
  }
  return server
}

const objectIds = new WeakMap<object, number>()
let nextObjectId = 0
/** The same number for the same object, a new one for another (which profile, which plugin services). */
function identityOf(value: object): number {
  let id = objectIds.get(value)
  if (id === undefined) objectIds.set(value, (id = ++nextObjectId))
  return id
}

const TOOL_NAMES = Object.keys(TOOL_NEEDS)

/**
 * Everything that decides which tools `session` is offered and how they are
 * described, and nothing about who the caller is: two requests with the same
 * shape get identical tools. Exported for its tests.
 */
export function buildShapeOf(session: McpSession, registration: McpRegistration): string {
  const offer: ToolOffer | undefined = registration.offer
  const withheld = offer
    ? TOOL_NAMES.flatMap((name) => {
        const refusal = offer.refusalOf(name)
        return refusal ? [[name, refusal.code, refusal.message]] : []
      })
    : null
  const nodesNotOffered = [...GATEABLE_NODE_TYPES].filter((type) => (offer ? !offer.nodeOffered(type) : isNodeDenied(type, USER_VIEWER)))
  // Where there is an offer, each listed tool's description ends with a note
  // naming the models it names that are not offered (offer-note.ts), asked of
  // `offer.modelOffered`: the run's model door, which follows the admin's
  // model switch and the house models served, both of which change while the
  // process runs.
  const modelsNotOffered = offer ? [...GATEABLE_MODEL_IDS].filter((id) => !offer.modelOffered(id)) : null
  return JSON.stringify([
    [...new Set(session.scopes)].sort(),
    registration.conversation,
    session.addresses,
    offer ? { admin: offer.viewer.admin, withheld } : null,
    nodesNotOffered,
    modelsNotOffered,
    // The launch-video description names `capture_site` where this is true.
    // Its inputs are already above (`capture_site`'s refusal with an offer,
    // the profile and the install switch without one); kept so the shape
    // follows the function the description asks, whatever it comes to read.
    siteCaptureOffered({ offer }),
    llmMeteredPricing(),
    [hasCredits(), hasOrganizations(), siteCaptureEnabled(), scene3DProEngineReady(), externalWalletConfigured(), nodeUniverseLoaded()],
    [identityOf(runtimeSurfaceProfile()), identityOf(getPluginServices()), identityOf(getPluginEngines())],
  ])
}

interface BuildCache {
  /** Least recently used first. */
  readonly builds: Map<string, { readonly ready: Promise<SharedBuild>; built?: SharedBuild }>
  readonly failed: Map<string, true>
  built: number
}

let caches = new WeakMap<FastifyInstance, BuildCache>()

function cacheOf(fastify: FastifyInstance): BuildCache {
  let cache = caches.get(fastify)
  if (!cache) caches.set(fastify, (cache = { builds: new Map(), failed: new Map(), built: 0 }))
  return cache
}

/** A short name for a build shape in a log line (the shape names no caller, but is long). */
const shapeName = (shape: string) => createHash("sha256").update(shape).digest("hex").slice(0, 12)

/**
 * What this process's shared builds have done, logged as
 * `[mcp-built-once] shared builds` whenever a build is made or fails, and on a
 * hit at most every `STATS_EVERY_MS`:
 *  - hits: a request served from a shape's existing build;
 *  - misses: a shape's build started (a new shape, or one the cache dropped);
 *  - failures: a shape whose build failed (each filed once to app_reports);
 *  - ownBuilds: a request served by a build of its own (an in-app session, or a failed shape);
 *  - evicted: builds the cache dropped to stay within its bound;
 *  - shapes: distinct shapes seen (counted up to `MAX_SHAPES_COUNTED`).
 */
const stats = { hits: 0, misses: 0, failures: 0, ownBuilds: 0, evicted: 0, shapes: 0 }
const shapesSeen = new Set<string>()
const MAX_SHAPES_COUNTED = 1024
const STATS_EVERY_MS = 10 * 60_000
let statsLoggedAt = 0

function logStats(cache: BuildCache, changed: boolean): void {
  const now = Date.now()
  if (!changed && now - statsLoggedAt < STATS_EVERY_MS) return
  statsLoggedAt = now
  console.info("[mcp-built-once] shared builds", { ...stats, cached: cache.builds.size })
}

/** A shape whose build failed: logged and filed once, never retried (a failure is the code's, not the moment's). */
function reportFailure(cache: BuildCache, shape: string, err: unknown): void {
  const detail = { shape: shapeName(shape), error: err instanceof Error ? err.message : String(err) }
  stats.failures++
  console.warn("[mcp-built-once] a shared build failed: its shape is served by a build per request", detail)
  void insertAppReport({
    node: "mcp-tools-built-once",
    kind: "mcp-shared-build-failed",
    severity: "error",
    title: "A shared MCP build failed: its requests are served by a build per request until the process restarts",
    payload: detail,
  })
  logStats(cache, true)
}

async function sharedBuildFor(session: McpSession, registration: McpRegistration): Promise<SharedBuild | undefined> {
  const cache = cacheOf(registration.fastify)
  const shape = buildShapeOf(session, registration)
  if (cache.failed.has(shape)) return undefined
  let entry = cache.builds.get(shape)
  if (entry) {
    cache.builds.delete(shape)
    cache.builds.set(shape, entry)
    stats.hits++
    logStats(cache, false)
  } else {
    stats.misses++
    const name = shapeName(shape)
    if (shapesSeen.size < MAX_SHAPES_COUNTED && !shapesSeen.has(name)) {
      shapesSeen.add(name)
      stats.shapes++
    }
    const ready = buildShared(session, registration)
    const made: { readonly ready: Promise<SharedBuild>; built?: SharedBuild } = { ready }
    entry = made
    ready.then(
      (build) => {
        made.built = build
        cache.built++
        logStats(cache, true)
      },
      () => {},
    )
    cache.builds.set(shape, entry)
    while (cache.builds.size > MAX_SHARED_MCP_BUILDS) {
      cache.builds.delete(cache.builds.keys().next().value as string)
      stats.evicted++
    }
  }
  try {
    return await entry.ready
  } catch (err) {
    if (cache.builds.get(shape) === entry) cache.builds.delete(shape)
    if (!cache.failed.has(shape)) {
      cache.failed.set(shape, true)
      while (cache.failed.size > MAX_REMEMBERED_FAILURES) cache.failed.delete(cache.failed.keys().next().value as string)
      reportFailure(cache, shape, err)
    }
    return undefined
  }
}

/**
 * The server `/mcp` answers one request with when `MCP_TOOLS_BUILT_ONCE` is on:
 * made from the shared build of the request's shape, or built for the request
 * alone (an in-app session, or a shape whose build failed). Its answers are
 * `buildMcpServer`'s (tools-built-once-equivalence.test.ts).
 */
export async function mcpServerForRequest(opts: McpBuildOpts): Promise<McpServer | Server> {
  const { session, offer } = await resolveMcpSession(opts)
  const registration: McpRegistration = { fastify: opts.fastify, conversation: Boolean(opts.conversation), offer }
  const shared = session.firstParty || session.scopedProjectId !== undefined ? undefined : await sharedBuildFor(session, registration)
  if (shared) return requestServer(shared, session)
  stats.ownBuilds++
  const own = createMcpServer()
  registerMcpTools(own, session, registration)
  return own
}

/** Tests only: this process's counts (see `stats`). */
export function __mcpBuildStatsForTests(): Readonly<typeof stats> {
  return { ...stats }
}

/** Tests only: what `fastify`'s cache holds. */
export function __sharedMcpBuildsForTests(fastify: FastifyInstance): { built: number; cached: number; failed: number; servers: McpServer[] } {
  const cache = cacheOf(fastify)
  return {
    built: cache.built,
    cached: cache.builds.size,
    failed: cache.failed.size,
    servers: [...cache.builds.values()].flatMap((entry) => (entry.built ? [entry.built.server] : [])),
  }
}

/** Tests only: forget every shared build. */
export function __resetSharedMcpBuildsForTests(): void {
  caches = new WeakMap()
}

/** Tests only: the context a shared build's handler runs in (undefined outside one). */
export function __callerStoreForTests(): unknown {
  return callerContext.getStore()
}
