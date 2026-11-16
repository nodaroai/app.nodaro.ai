/**
 * THE SAME ANSWERS WITH THE FLAG ON AND OFF (`MCP_TOOLS_BUILT_ONCE`).
 *
 * Every case sends the same requests twice, over a real socket, through the real adapter
 * (`handleMcpRequest`): once to a server the request builds for itself
 * (`buildMcpServer`, the flag off) and once to a server made from the shared
 * build (`mcpServerForRequest`, the flag on), and requires the same status,
 * headers and body. The one header left out is `mcp-session-id`, a random id
 * the adapter mints on every `initialize` (and `date`, the clock).
 *
 * What the build shape decides (the handshake, every list, `ping`, and a call
 * of a tool the deployment may withhold) is compared across the whole matrix:
 * every build the registration census covers (Nodaro Cloud, a self-hosted
 * Community install, Cloud with every plugin service and engine) × what the
 * deployment offers (nothing restricted; an Availability override hiding nodes
 * from users, seen by a user and by an admin) × the grant (every scope, all but
 * execute, read-only, none) × the surface profile (none; a deny, a name and a
 * unit) × the metered LLM pricing switch. Every other request (every widget
 * page, the task list, an unknown tool, bad arguments, `get_recipe`,
 * `check_balance`, DELETE and GET on the endpoint) is compared for every
 * build, every offer and both profiles, with every scope.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import http from "node:http"
import { ALL_SCOPES, type Scope } from "../../scopes.js"

const h = vi.hoisted(() => ({ cloud: true, orgs: false, admins: new Set<string>() }))

vi.mock("../../supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "in", "order", "limit", "gte", "lte", "lt", "gt", "range", "not", "or"]) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.single = async () => ({ data: null, error: null })
  chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko)
  return { supabase: { from: () => chain, rpc: () => chain } }
})
vi.mock("../../admin-check.js", () => ({ checkIsAdmin: async (userId: string) => h.admins.has(userId) }))
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.cloud, hasOrganizations: () => h.orgs }
})
// A session in a workspace (as the registration census builds it).
vi.mock("../workspace-session.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveSessionWorkspace: async () => "00000000-0000-4000-8000-0000000000aa",
}))

const { buildMcpServer } = await import("../server.js")
const { mcpServerForRequest, __resetSharedMcpBuildsForTests } = await import("../tools-built-once.js")
const { handleMcpRequest } = await import("../fastify-adapter.js")
const { config } = await import("../../config.js")
const { setLlmMeteredSchemaReadyForTesting } = await import("../../llm-metered-schema-gate.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { setPluginServices } = await import("../../private-plugins/services-registry.js")
const { setPluginEngines } = await import("../../private-plugins/engine-registry.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES } = await import(
  "../../availability-override.js"
)

type Build = "cloud" | "community" | "cloud with every plugin service and engine"
type Offer = "no restriction" | "restricted, seen by a user" | "restricted, seen by an admin"
type Grant = "every scope" | "all but execute" | "read-only" | "none"
type Profile = "no profile" | "deny, name and unit"

const USER = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"

const GRANTS: Record<Grant, Scope[]> = {
  "every scope": [...ALL_SCOPES],
  "all but execute": ALL_SCOPES.filter((s) => s !== "workflows:execute"),
  "read-only": ALL_SCOPES.filter((s) => s.endsWith(":read")),
  none: [],
}
const PROFILES: Record<Profile, object | null> = {
  "no profile": null,
  "deny, name and unit": {
    nodes: { deny: ["generate-video", "lip-sync"] },
    brand: { productName: "Acme" },
    billing: { unitLabel: "points", unitRate: 0.5, unitDecimals: 2 },
  },
}

/** What the next request is built for, and which way. */
let current: { userId: string; scopes: Scope[]; shared: boolean }
let app: FastifyInstance

function useBuild(build: Build): void {
  const extras = build === "cloud with every plugin service and engine"
  h.cloud = build !== "community"
  h.orgs = extras
  ;(config as unknown as { SCENE3D_ADVANCED_ENABLED: boolean }).SCENE3D_ADVANCED_ENABLED = extras
  if (extras) {
    const called = (): never => {
      throw new Error("a stand-in plugin member was called")
    }
    const engine = new Proxy({}, { get: () => called }) as never
    setPluginServices({ publicWorkflow: {}, orgs: {}, billing: {}, ugc: {}, policy: {}, collab: {}, signupGate: {}, houseModels: {} } as never)
    setPluginEngines({ scene3d: engine, surround: engine, smartCut: engine } as never)
  } else {
    setPluginServices({} as never)
    setPluginEngines({} as never)
  }
}

function useOffer(offer: Offer): string {
  h.admins = new Set([ADMIN])
  if (offer === "no restriction") {
    __resetAvailabilityOverridesForTests()
    return USER
  }
  __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => t !== "suno-generate" && t !== "cast-swap"))) })
  return offer === "restricted, seen by an admin" ? ADMIN : USER
}

function useProfile(profile: Profile): void {
  const p = PROFILES[profile]
  if (p === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(p)
  __resetSurfaceProfileCacheForTests()
}

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" }
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "equivalence", version: "0" } } }
const rpc = (id: number, method: string, params: object = {}) => ({ jsonrpc: "2.0", id, method, params })
const call = (id: number, name: string, args: object) => rpc(id, "tools/call", { name, arguments: args })

interface Answer {
  status: number
  headers: Record<string, unknown>
  body: string
}

let port: number
/** One kept-alive connection for every request, as a client holds one. */
let agent: http.Agent

/** One request over a real socket (the SDK's HTTP layer needs one: an injected request has no `destroySoon`). */
function ask(method: "POST" | "DELETE" | "GET", payload: object | undefined, shared: boolean, accept = HEADERS.accept): Promise<Answer> {
  current = { ...current, shared }
  const body = payload ? JSON.stringify(payload) : undefined
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method,
        agent,
        headers: { ...HEADERS, accept, ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }) },
      },
      (res) => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => (text += chunk))
        res.on("end", () => {
          const { "mcp-session-id": _id, date: _date, ...headers } = res.headers
          resolve({ status: res.statusCode ?? 0, headers, body: text })
        })
        res.on("error", reject)
      },
    )
    req.on("error", reject)
    req.end(body)
  })
}

/** The same request through both paths: the answers, flag off then on. */
async function both(method: "POST" | "DELETE" | "GET", payload?: object, accept?: string): Promise<[Answer, Answer]> {
  return [await ask(method, payload, false, accept), await ask(method, payload, true, accept)]
}

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  app = Fastify()
  app.all("/mcp", async (req, reply) => {
    const opts = { userId: current.userId, scopes: current.scopes, clientName: "Claude", fastify: app, conversation: { client: "claude-code" as const, key: "k1" } }
    const server = current.shared ? await mcpServerForRequest(opts) : await buildMcpServer(opts)
    await handleMcpRequest(server, req, reply)
  })
  await app.listen({ port: 0, host: "127.0.0.1" })
  port = (app.server.address() as { port: number }).port
  agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
})

afterAll(async () => {
  agent.destroy()
  __resetSharedMcpBuildsForTests()
  __resetAvailabilityOverridesForTests()
  useBuild("cloud")
  useProfile("no profile")
  setLlmMeteredSchemaReadyForTesting(undefined)
  await app.close()
})

/** Compares one request on both paths; returns the answer. */
async function same(label: string, method: "POST" | "DELETE" | "GET", payload?: object, accept?: string): Promise<Answer> {
  const [off, on] = await both(method, payload, accept)
  expect(on, label).toEqual(off)
  return off
}

const namesIn = (answer: Answer, key: "tools" | "resources", field: "name" | "uri") =>
  ((JSON.parse(answer.body) as { result?: Record<string, Array<Record<string, string>>> }).result?.[key] ?? []).map((entry) => entry[field])

/** What the build shape decides: the handshake, every list, and a call of a tool that may be withheld. */
async function compareLists(): Promise<void> {
  await same("initialize", "POST", INIT)
  await same("tools/list", "POST", rpc(2, "tools/list"))
  await same("resources/list", "POST", rpc(3, "resources/list"))
  await same("resources/templates/list", "POST", rpc(4, "resources/templates/list"))
  await same("ping", "POST", call(6, "ping", {}))
  await same("a withheld (or failing) tool", "POST", call(9, "suno_generate", { prompt: "x" }))
}

/** Every other request: each widget page, the task list, failures, two real tools, and the other methods. */
async function compareCalls(): Promise<number> {
  let compared = 0
  const count = async (...args: Parameters<typeof same>) => {
    compared++
    return same(...args)
  }
  await count("notifications/initialized", "POST", { jsonrpc: "2.0", method: "notifications/initialized" })
  const tools = new Set(namesIn(await count("tools/list", "POST", rpc(2, "tools/list")), "tools", "name"))
  for (const [i, uri] of namesIn(await count("resources/list", "POST", rpc(3, "resources/list")), "resources", "uri").entries()) {
    await count(`resources/read ${uri}`, "POST", rpc(100 + i, "resources/read", { uri }))
  }
  await count("tasks/list", "POST", rpc(5, "tasks/list"))
  await count("an unknown tool", "POST", call(7, "no_such_tool", {}))
  if (tools.has("wait_for_job")) await count("bad arguments", "POST", call(8, "wait_for_job", { job_id: 42 }))
  if (tools.has("get_recipe")) await count("get_recipe", "POST", call(10, "get_recipe", {}))
  if (tools.has("check_balance")) await count("check_balance", "POST", call(11, "check_balance", {}))
  await count("DELETE", "DELETE")
  await count("GET without an event-stream accept", "GET", undefined, "application/json")
  return compared
}

const BUILDS: Build[] = ["cloud", "community", "cloud with every plugin service and engine"]
const OFFERS: Offer[] = ["no restriction", "restricted, seen by a user", "restricted, seen by an admin"]
const CASES: Array<[Grant, Profile, boolean]> = (Object.keys(GRANTS) as Grant[]).flatMap((grant) =>
  (Object.keys(PROFILES) as Profile[]).flatMap((profile) => [true, false].map((metered): [Grant, Profile, boolean] => [grant, profile, metered])),
)

function use(build: Build, offer: Offer, grant: Grant, profile: Profile, metered: boolean): void {
  useBuild(build)
  const userId = useOffer(offer)
  useProfile(profile)
  setLlmMeteredSchemaReadyForTesting(metered)
  current = { userId, scopes: GRANTS[grant], shared: false }
}

describe.each(BUILDS)("%s", (build) => {
  describe.each(OFFERS)("%s", (offer) => {
    it.each(CASES)("grant %s, %s, metered pricing %s: the same handshake, lists and refusals", async (grant, profile, metered) => {
      use(build, offer, grant, profile, metered)
      await compareLists()
    }, 60_000)
  })
})

/** Every build, every offer and both profiles at least once (each case makes ~20 requests both ways). */
const CALL_CASES: Array<[Build, Offer, Profile]> = [
  ["cloud", "no restriction", "no profile"],
  ["cloud", "restricted, seen by an admin", "deny, name and unit"],
  ["community", "no restriction", "no profile"],
  ["community", "restricted, seen by a user", "deny, name and unit"],
  ["cloud with every plugin service and engine", "restricted, seen by a user", "deny, name and unit"],
]

describe("every other request", () => {
  it.each(CALL_CASES)("%s, %s, %s, every scope: the same answers", async (build, offer, profile) => {
    use(build, offer, "every scope", profile, true)
    expect(await compareCalls()).toBeGreaterThan(10)
  }, 60_000)
})

// The /mcp route answers a GET itself, before any server is built either way
// (lib/mcp/get-stream.ts); this compares the adapter's answer on both kinds of
// server, which this file's own route still hands it.
describe("GET on the endpoint (an event stream nothing writes to)", () => {
  it("opens the same stream, with the same headers", async () => {
    useBuild("cloud")
    useOffer("no restriction")
    useProfile("no profile")
    const head = (shared: boolean) =>
      new Promise<{ status: number; headers: Record<string, unknown> }>((resolve, reject) => {
        current = { userId: USER, scopes: [...ALL_SCOPES], shared }
        const req = http.get({ host: "127.0.0.1", port, path: "/mcp", headers: { accept: "text/event-stream" } }, (res) => {
          const { date: _date, ...headers } = res.headers
          resolve({ status: res.statusCode ?? 0, headers })
          req.destroy()
        })
        req.on("error", (err) => (err.message.includes("socket hang up") ? undefined : reject(err)))
      })
    const off = await head(false)
    const on = await head(true)
    expect(on).toEqual(off)
  })
})
