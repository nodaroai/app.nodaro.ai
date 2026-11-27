/**
 * MCP TOOLS BUILT ONCE (`MCP_TOOLS_BUILT_ONCE`, lib/mcp/tools-built-once.ts).
 *
 * With the flag on, `/mcp` builds the tools once per build shape (everything a
 * registration reads that can differ between two requests) and serves each
 * request from that shared build with its own session. These cases hold the
 * cache itself:
 *  - one build per shape, and the list it serves is the one a request would
 *    have built for itself;
 *  - every input that changes what a build contains, at run time or between
 *    deployments, leads to a new build (and switching back reuses the old one);
 *  - the cache is bounded and evicts the least recently used build;
 *  - a build that reads the caller while registering is never shared: the
 *    request is served by a build of its own, and the failure is logged once;
 *  - a shared build answers no session read made outside a request, and can
 *    send nothing on its own.
 * Identical answers across the whole matrix: tools-built-once-equivalence.test.ts.
 * Callers kept apart: tools-built-once-isolation.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { scaledTimeout } from "../../../../../tools/vitest/ci-limits.mjs"
import Fastify, { type FastifyInstance } from "fastify"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { ALL_SCOPES, type Scope } from "../../scopes.js"

const h = vi.hoisted(() => ({
  cloud: true,
  orgs: false,
  admins: new Set<string>(),
  /** A deliberate bad read, run inside the competitor tools' registration. */
  mutation: null as null | ((session: Record<string, unknown>) => void),
  /** What was filed to app_reports. */
  reports: [] as unknown[],
}))

vi.mock("../../app-reports.js", () => ({
  insertAppReport: async (report: unknown) => {
    h.reports.push(report)
    return true
  },
}))

vi.mock("../../supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: { id: "p1" }, error: null })
  return { supabase: { from: () => chain } }
})
vi.mock("../../admin-check.js", () => ({ checkIsAdmin: async (userId: string) => h.admins.has(userId) }))
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.cloud, hasOrganizations: () => h.orgs }
})
vi.mock("../workspace-session.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveSessionWorkspace: async () => "00000000-0000-4000-8000-0000000000aa",
}))
vi.mock("../tools/competitors.js", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("../tools/competitors.js")
  return {
    ...orig,
    registerCompetitorTools: (opts: Parameters<typeof orig.registerCompetitorTools>[0]) => {
      h.mutation?.(opts.session as unknown as Record<string, unknown>)
      return orig.registerCompetitorTools(opts)
    },
  }
})

const { buildMcpServer } = await import("../server.js")
const { mcpServerForRequest, MAX_SHARED_MCP_BUILDS, __sharedMcpBuildsForTests, __resetSharedMcpBuildsForTests, __mcpBuildStatsForTests } = await import("../tools-built-once.js")
const { setLlmMeteredSchemaReadyForTesting } = await import("../../llm-metered-schema-gate.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { setPluginServices } = await import("../../private-plugins/services-registry.js")
const { setPluginEngines } = await import("../../private-plugins/engine-registry.js")
const { noteModelSwitch, __resetModelSwitchForTests } = await import("../../model-switch.js")
const { MODEL_CATALOG } = await import("@nodaro/shared/model-catalog")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES } = await import(
  "../../availability-override.js"
)

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER_USER = "00000000-0000-4000-8000-000000000002"
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const CONVERSATION = { client: "claude-code" as const, key: "k1" }

type Opts = Parameters<typeof buildMcpServer>[0]

let app: FastifyInstance

function opts(over: Partial<Opts> = {}): Opts {
  return { userId: USER, scopes: [...ALL_SCOPES], clientName: "Claude", fastify: app, conversation: CONVERSATION, ...over }
}

async function connect(server: { connect(t: Transport): Promise<void> }): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: "built-once-test", version: "1" })
  await client.connect(clientSide)
  return client
}

/** The tools/list answer, as JSON, of a server built for the request. */
async function listOf(server: { connect(t: Transport): Promise<void> }): Promise<string> {
  const client = await connect(server)
  try {
    return JSON.stringify(await client.listTools())
  } finally {
    await client.close()
  }
}

/** The shared path and a request's own build, asked at the same moment. */
async function bothLists(o: Opts): Promise<{ shared: string; own: string }> {
  return { shared: await listOf(await mcpServerForRequest(o)), own: await listOf(await buildMcpServer(o)) }
}

const built = () => __sharedMcpBuildsForTests(app).built

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

/** An Admin → Availability override leaving `left` off (hidden from users, kept by admins). */
function overrideLeavingOff(...left: string[]): void {
  __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => !left.includes(t)))) })
}

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
})

beforeEach(() => {
  app = Fastify()
  h.cloud = true
  h.orgs = false
  h.admins = new Set([ADMIN])
  h.mutation = null
  h.reports = []
  setLlmMeteredSchemaReadyForTesting(true)
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  setPluginServices({} as never)
  setPluginEngines({} as never)
})

afterEach(() => {
  __resetSharedMcpBuildsForTests()
  __resetModelSwitchForTests()
  vi.restoreAllMocks()
})

// Each case here registers the whole tool list several times over (up to six
// real builds), which takes 2–5 s alone and has passed the default 5 s limit on
// a loaded runner. The limit is for this file only: a build that hangs still
// fails, and no case builds less than it did.
vi.setConfig({ testTimeout: scaledTimeout(20_000) })

describe("one build per build shape", () => {
  it("serves every request of one shape from one build, with the list a request's own build gives", async () => {
    const first = await bothLists(opts())
    expect(first.shared).toBe(first.own)
    await listOf(await mcpServerForRequest(opts({ userId: OTHER_USER, clientName: "Another client" })))
    await listOf(await mcpServerForRequest(opts({ conversation: { client: "claude", key: null } })))
    expect(built()).toBe(1)
  })

  it.each<[string, Scope[]]>([
    ["no scope", []],
    ["read-only", ["workflows:read", "jobs:read", "assets:read", "apps:read", "credits:read"]],
    ["all but execute", ALL_SCOPES.filter((s) => s !== "workflows:execute")],
  ])("builds another for %s, which lists what that grant's own build lists", async (_name, scopes) => {
    await listOf(await mcpServerForRequest(opts()))
    const { shared, own } = await bothLists(opts({ scopes }))
    expect(shared).toBe(own)
    expect(built()).toBe(2)
  })

  it("keys the scopes as a set: the same grant in another order is the same build", async () => {
    await mcpServerForRequest(opts({ scopes: ["jobs:read", "assets:read"] }))
    await mcpServerForRequest(opts({ scopes: ["assets:read", "jobs:read", "jobs:read"] }))
    expect(built()).toBe(1)
  })

  it("keeps one cache per server app: an app's tools never call another app's routes", async () => {
    await mcpServerForRequest(opts())
    const other = Fastify()
    await mcpServerForRequest(opts({ fastify: other }))
    expect(__sharedMcpBuildsForTests(app).built).toBe(1)
    expect(__sharedMcpBuildsForTests(other).built).toBe(1)
  })
})

describe("every input that changes a build makes a new one", () => {
  /**
   * Request, change `flip`, request again: a new build, whose list is the
   * request's own. `back` returns to the first state, which reuses the first
   * build — or, for an input the shape knows by its object (a plugin registry,
   * which is replaced by a new object every time it is set), builds again.
   */
  async function holds(flip: () => void, back: () => void, { backIsNewObject = false } = {}): Promise<void> {
    const before = await bothLists(opts())
    expect(before.shared).toBe(before.own)
    expect(built()).toBe(1)
    flip()
    const after = await bothLists(opts())
    expect(after.shared).toBe(after.own)
    expect(built()).toBe(2)
    back()
    const again = await bothLists(opts())
    expect(again.shared).toBe(before.own)
    expect(built()).toBe(backIsNewObject ? 3 : 2)
  }

  it("an Admin → Availability override saved while the process runs", async () => {
    await holds(
      () => overrideLeavingOff("suno-generate"),
      () => __resetAvailabilityOverridesForTests(),
    )
  })

  it("the caller's admin bit, where the override hides a node from users", async () => {
    overrideLeavingOff("suno-generate", "cast-swap")
    const user = await bothLists(opts())
    const admin = await bothLists(opts({ userId: ADMIN }))
    expect(user.shared).toBe(user.own)
    expect(admin.shared).toBe(admin.own)
    expect(admin.own).not.toBe(user.own)
    expect(built()).toBe(2)
  })

  it("the admin's model switch, where the deployment restricts models (the offer's verdicts)", async () => {
    const suno = Object.values(MODEL_CATALOG).filter((m) => m.family === "Suno").map((m) => m.id)
    expect(suno.length).toBeGreaterThan(0)
    setProfile({ models: { deny: ["no-such-model"] } })
    await holds(
      () => {
        for (const id of suno) noteModelSwitch(id, false)
      },
      () => {
        for (const id of suno) noteModelSwitch(id, true)
      },
    )
  })

  it("the admin's model switch, where the deployment restricts only nodes (the note a description ends with names withheld models)", async () => {
    overrideLeavingOff("suno-generate")
    const { own } = await bothLists(opts())
    // A model some listed tool names (an enum, a default): switching it off adds it to that tool's note.
    const named = Object.keys(MODEL_CATALOG).find((id) => own.includes(`"${id}"`))
    expect(named).toBeDefined()
    await holds(
      () => noteModelSwitch(named!, false),
      () => noteModelSwitch(named!, true),
    )
  })

  it("the metered LLM pricing switch, which turns on once its schema is found", async () => {
    await holds(
      () => setLlmMeteredSchemaReadyForTesting(false),
      () => setLlmMeteredSchemaReadyForTesting(true),
    )
  })

  it("the deployment's surface profile (a deny, a name, a unit)", async () => {
    await holds(
      () => setProfile({ nodes: { deny: ["generate-video", "lip-sync"] }, brand: { productName: "Acme" }, billing: { unitLabel: "points", unitRate: 0.5, unitDecimals: 2 } }),
      () => setProfile(null),
    )
  })

  it("a profile that withdraws Site Capture (the launch-video description names it only where it is offered)", async () => {
    await holds(
      () => setProfile({ nodes: { deny: ["site-capture"] } }),
      () => setProfile(null),
    )
  })

  it("the plugin services", async () => {
    h.orgs = true
    await holds(
      () => setPluginServices({ orgs: {} } as never),
      () => setPluginServices({} as never),
      { backIsNewObject: true },
    )
  })

  it("the plugin engines", async () => {
    const called = (): never => {
      throw new Error("a stand-in engine was called while the tools registered")
    }
    const engine = new Proxy({}, { get: () => called }) as never
    await holds(
      () => setPluginEngines({ scene3d: engine } as never),
      () => setPluginEngines({} as never),
      { backIsNewObject: true },
    )
  })

  it("the edition (credits)", async () => {
    await holds(
      () => {
        h.cloud = false
      },
      () => {
        h.cloud = true
      },
    )
  })

  it("whether the request carries a conversation (a build option, not a session field)", async () => {
    await listOf(await mcpServerForRequest(opts()))
    const { shared, own } = await bothLists(opts({ conversation: undefined }))
    expect(shared).toBe(own)
    expect(built()).toBe(2)
  })

  it("every node the offer answers for, even where no tool's refusal changes (a registration may ask any)", async () => {
    const { buildShapeOf } = await import("../tools-built-once.js")
    const { newSession } = await import("../session.js")
    const offerHiding = (hidden: string | null) => ({ viewer: { admin: false }, refusalOf: () => undefined, nodeOffered: (type: string) => type !== hidden, modelOffered: () => true })
    const shapeWith = (hidden: string | null) =>
      buildShapeOf(newSession({ userId: USER, scopes: [...ALL_SCOPES], clientName: "Claude" }), { fastify: app, conversation: true, offer: offerHiding(hidden) })
    const [first, second] = [...GATEABLE_NODE_TYPES]
    expect(shapeWith(first!)).not.toBe(shapeWith(null))
    expect(shapeWith(first!)).not.toBe(shapeWith(second!))
    expect(shapeWith(null)).toBe(shapeWith(null))
  })

  it("the sizes video_remake names, which follow the admin's settings while the process runs", async () => {
    const { buildShapeOf } = await import("../tools-built-once.js")
    const { newSession } = await import("../session.js")
    type Sizes = import("../video-remake-sizes.js").VideoRemakeSizesHere
    type Size = import("../../video-remake-delivered-resolution.js").VideoRemakeDeliveredSize
    const shapeWith = (videoRemakeSizes: Sizes | undefined) =>
      buildShapeOf(newSession({ userId: USER, scopes: [...ALL_SCOPES], clientName: "Claude" }), { fastify: app, conversation: true, offer: undefined, videoRemakeSizes })
    const prism = (sizes: Size[]): Sizes => ({ kind: "delivered", resolutions: { "nodaro-prism": sizes } })
    expect(shapeWith(prism(["720p", "1080p", "4k"]))).not.toBe(shapeWith(prism(["720p", "1080p"])))
    expect(shapeWith(prism(["720p", "1080p", "4k"]))).not.toBe(shapeWith({ kind: "unread" }))
    expect(shapeWith({ kind: "engine" })).not.toBe(shapeWith(undefined))
    expect(shapeWith(prism(["720p", "1080p", "4k"]))).toBe(shapeWith(prism(["720p", "1080p", "4k"])))
  })

  it("the addresses the request came in on", async () => {
    const base = await bothLists(opts())
    const addresses = { ...(await import("../../mcp-lane-addresses.js")).mcpLaneAddresses(), pagesBase: "https://pages.other.example" }
    const other = await bothLists(opts({ addresses }))
    expect(other.shared).toBe(other.own)
    expect(other.own).not.toBe(base.own)
    expect(built()).toBe(2)
  })
})

describe("the cache is bounded", () => {
  const GRANTS: Scope[][] = ALL_SCOPES.map((s) => [s])

  it("keeps up to twelve builds: a deployment's connected clients held eight distinct grants, and six rebuilt the rarer ones on every use", () => {
    // docs/deployment.md states the same number.
    expect(MAX_SHARED_MCP_BUILDS).toBe(12)
  })

  it(`keeps at most ${"MAX_SHARED_MCP_BUILDS"} builds, dropping the least recently used`, async () => {
    expect(GRANTS.length).toBeGreaterThan(MAX_SHARED_MCP_BUILDS)
    for (const scopes of GRANTS.slice(0, MAX_SHARED_MCP_BUILDS)) await mcpServerForRequest(opts({ scopes }))
    expect(__sharedMcpBuildsForTests(app)).toMatchObject({ built: MAX_SHARED_MCP_BUILDS, cached: MAX_SHARED_MCP_BUILDS })
    // Touch the first, so the second is now the least recently used.
    await mcpServerForRequest(opts({ scopes: GRANTS[0] }))
    await mcpServerForRequest(opts({ scopes: GRANTS[MAX_SHARED_MCP_BUILDS] }))
    expect(__sharedMcpBuildsForTests(app)).toMatchObject({ built: MAX_SHARED_MCP_BUILDS + 1, cached: MAX_SHARED_MCP_BUILDS })
    await mcpServerForRequest(opts({ scopes: GRANTS[0] }))
    expect(built()).toBe(MAX_SHARED_MCP_BUILDS + 1)
    await mcpServerForRequest(opts({ scopes: GRANTS[1] }))
    expect(built()).toBe(MAX_SHARED_MCP_BUILDS + 2)
  })

  it("builds once for concurrent first requests of one shape", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => mcpServerForRequest(opts({ userId: `00000000-0000-4000-8000-00000000000${i}` }))))
    expect(built()).toBe(1)
  })
})

describe("a build that reads the caller is never shared", () => {
  it("serves the request from its own build, and reports the failure once: a warning and an app report, naming no caller", async () => {
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {})
    h.mutation = (s) => void s.userId
    const one = await bothLists(opts())
    const two = await bothLists(opts({ userId: OTHER_USER }))
    expect(one.shared).toBe(one.own)
    expect(two.shared).toBe(two.own)
    expect(__sharedMcpBuildsForTests(app)).toMatchObject({ built: 0, cached: 0 })
    const failures = logged.mock.calls.filter((c) => String(c[0]) === "[mcp-built-once] a shared build failed: its shape is served by a build per request")
    expect(failures).toHaveLength(1)
    expect(JSON.stringify(failures[0])).toMatch(/session\.userId/)
    expect(JSON.stringify(failures[0])).not.toContain(USER)
    expect(h.reports).toHaveLength(1)
    expect(h.reports[0]).toMatchObject({ node: "mcp-tools-built-once", kind: "mcp-shared-build-failed", severity: "error" })
    expect(JSON.stringify(h.reports[0])).toMatch(/session\.userId/)
    expect(JSON.stringify(h.reports)).not.toContain(USER)
    expect(JSON.stringify(h.reports)).not.toContain(OTHER_USER)
  })

  it("counts hits, misses, failures and shapes, and logs them when they change, not on every hit", async () => {
    const counted = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const before = __mcpBuildStatsForTests()
    for (let i = 0; i < 3; i++) await mcpServerForRequest(opts())
    await mcpServerForRequest(opts({ scopes: ["jobs:read"] }))
    h.mutation = (s) => void s.userId
    await mcpServerForRequest(opts({ scopes: ["assets:read"] }))
    await mcpServerForRequest(opts({ scopes: ["assets:read"] }))
    await mcpServerForRequest(opts({ firstParty: true }))
    const after = __mcpBuildStatsForTests()
    expect({
      hits: after.hits - before.hits,
      misses: after.misses - before.misses,
      failures: after.failures - before.failures,
      ownBuilds: after.ownBuilds - before.ownBuilds,
      shapes: after.shapes - before.shapes,
    }).toEqual({ hits: 2, misses: 3, failures: 1, ownBuilds: 3, shapes: 3 })
    const lines = counted.mock.calls.filter((c) => String(c[0]) === "[mcp-built-once] shared builds")
    // Two builds made and one failure: three changes, each logged; the two hits are not.
    expect(lines).toHaveLength(3)
    expect(lines.at(-1)![1]).toMatchObject({ cached: 2 })
  })

  it.each<[string, (s: Record<string, unknown>) => void, RegExp]>([
    ["the caller's admin bit, nested under the offer", (s) => void (s.offer as { viewer?: unknown } | undefined)?.viewer, /session\.offer\.viewer/],
    ["the offer's model verdict, which no registration may ask", (s) => void (s.offer as { modelOffered?: (id: string) => boolean } | undefined)?.modelOffered?.("x"), /session\.offer\.modelOffered/],
    ["an address no registration reads", (s) => void (s.addresses as { mcpUrl?: string }).mcpUrl, /session\.addresses\.mcpUrl/],
  ])("refuses a nested read the census does not list: %s", async (_name, mutation, expected) => {
    // Restricted, so the session carries an offer to read under.
    overrideLeavingOff("suno-generate")
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {})
    h.mutation = mutation
    const { shared, own } = await bothLists(opts())
    expect(shared).toBe(own)
    expect(__sharedMcpBuildsForTests(app)).toMatchObject({ built: 0, cached: 0, failed: 1 })
    const failures = logged.mock.calls.filter((c) => String(c[0]).includes("[mcp-built-once]"))
    expect(failures).toHaveLength(1)
    expect(JSON.stringify(failures[0])).toMatch(expected)
  })

  it.each<[string, Partial<Opts>]>([
    ["a first-party session (the in-app Copilot's)", { firstParty: true }],
    ["a session pinned to a project", { projectScope: { projectId: "p1" } }],
  ])("serves %s from its own build", async (_name, over) => {
    const { shared, own } = await bothLists(opts(over))
    expect(shared).toBe(own)
    expect(built()).toBe(0)
  })
})

describe("a shared build answers nobody outside a request", () => {
  it("throws on a session read made outside any request", async () => {
    await listOf(await mcpServerForRequest(opts()))
    const [server] = __sharedMcpBuildsForTests(app).servers
    const ping = (server as unknown as { _registeredTools: Record<string, { handler: (extra: unknown) => unknown }> })._registeredTools.ping
    expect(() => ping.handler({})).toThrow(/outside a request/)
  })

  it("cannot send a notification of its own", async () => {
    await mcpServerForRequest(opts())
    const [server] = __sharedMcpBuildsForTests(app).servers
    await expect(server.server.notification({ method: "notifications/tools/list_changed" })).rejects.toThrow(/shared MCP build/)
  })
})
