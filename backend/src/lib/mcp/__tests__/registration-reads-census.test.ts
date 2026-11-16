/**
 * NO MCP TOOL REGISTRATION READS THE CALLER.
 *
 * A tool reads who is calling (the user, the workspace, the client, the
 * conversation, the call's own state) when it RUNS. When it is REGISTERED it may
 * read only what decides which tools a session is offered and how they are
 * described: `ALLOWED_AT_REGISTRATION` below, each entry saying what it varies
 * by. A value read at registration and kept by a handler is the caller's only
 * while every request builds its own server, as today; a server built once and
 * run for many callers would hand all of them the first caller's value, and
 * would have to be built once per combination of the allowed entries.
 *
 * The census builds the whole server (`buildMcpServer`, the one registration
 * body) with a session that records every field read or written while the
 * tools register (a property read, a write, `in`, a property descriptor such as
 * `Object.hasOwn`, a listing of the keys), and fails naming the field and the
 * file and line. Under `offer` and `addresses` it records by path what is read
 * inside them (`offer.nodeOffered`, `addresses.pagesBase`), since the offer
 * carries the caller's admin bit. It covers, all combined:
 *  - builds: Nodaro Cloud, a self-hosted Community install, and Cloud with every
 *    plugin service and engine present (stand-ins, as the gen:skills capture
 *    uses), organizations and 3D Render Pro on;
 *  - offers: a deployment that restricts nothing (no offer), and one whose
 *    Availability override hides nodes from users, seen by a user and by an
 *    admin (who keeps them);
 *  - sessions, all with every scope: a public `/mcp` client's (a
 *    conversation), an in-process one, a first-party one, one pinned to a
 *    project.
 *
 * What it does not see:
 *  - the private plugin itself. It is not in this repository; it contributes
 *    routes, services, engines and recipes and registers no MCP tool, so every
 *    tool registration is here.
 *  - a registration behind a flag or a deployment setting none of these builds
 *    turns on, or a scope set other than "every scope" (a gate's other branch
 *    is not run).
 *  - a value read below the first level under `offer` or `addresses`
 *    (`offer.viewer` is recorded, `offer.viewer.admin` is not: reading the
 *    viewer at all is already a finding), and any field nested under `scopes`
 *    (an array, read whole by the scope gates).
 *  - a read deferred past the build (a `setTimeout`, a promise the registration
 *    does not await): recording stops when `buildMcpServer` returns.
 *  - a per-request value that reaches a registration without riding the
 *    session: the server's own build options, among them the offer the offer
 *    funnel decides the list with (`installToolOffer(server, { session, offer })`
 *    in server.ts), and run-time state (an admin switch) read through something
 *    other than the session. The shared build's shape includes each of these
 *    explicitly (`buildShapeOf` in tools-built-once.ts), one test per input in
 *    tools-built-once.test.ts.
 *
 * The allowed list only shrinks: an entry no registration reads any more fails
 * this test until it is removed. A new entry needs its reason.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { ALL_SCOPES } from "../../scopes.js"

/**
 * Each path a registration may read, and what it varies by. Declared beside the
 * shared build (`MCP_TOOLS_BUILT_ONCE`), which answers these at registration,
 * refuses every other, and varies its build shape by each of them.
 */
const { READ_AT_REGISTRATION: ALLOWED_AT_REGISTRATION } = await import("../tools-built-once.js")

const h = vi.hoisted(() => {
  /** Fields whose value is looked into while building: what is read inside them is recorded by path. */
  const NESTED = new Set(["offer", "addresses"])
  type Kind = "read" | "write" | "in" | "descriptor" | "keys"
  const state = {
    cloud: true,
    orgs: false,
    admins: new Set<string>(),
    building: false,
    /** A deliberate bad read run inside registerCompetitorTools (the census's own tests). */
    mutation: null as null | ((session: Record<string, unknown>) => void),
    /** "path [kind] @ file:line" → how many times. */
    reads: new Map<string, number>(),
    /** Every path read at registration (any build). */
    fieldsRead: new Set<string>(),
    watch<T extends object>(session: T): T {
      return recording(session, "") as T
    },
  }
  function where(): string {
    const frame = (new Error().stack ?? "")
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .find((l) => l.includes("/backend/src/") && !l.includes("/lib/mcp/session.") && !l.includes("registration-reads-census"))
    return frame ? (/\/backend\/src\/(.+?):(\d+):\d+\)?$/.exec(frame)?.slice(1, 3).join(":") ?? frame) : "(unknown)"
  }
  function note(kind: Kind, path: string): void {
    if (!state.building) return
    state.fieldsRead.add(path)
    const key = `${kind === "write" ? "writes " : ""}${path}${kind === "in" || kind === "descriptor" || kind === "keys" ? ` [${kind}]` : ""} @ ${where()}`
    state.reads.set(key, (state.reads.get(key) ?? 0) + 1)
  }
  const nested = new WeakMap<object, object>()
  function recording(target: object, prefix: string): object {
    const at = (prop: string): string => (prefix ? `${prefix}.${prop}` : prop)
    return new Proxy(target, {
      get(t, prop, receiver) {
        const value = Reflect.get(t, prop, receiver)
        if (typeof prop !== "string") return value
        note("read", at(prop))
        if (state.building && prefix === "" && NESTED.has(prop) && value !== null && typeof value === "object") {
          let inner = nested.get(value)
          if (!inner) nested.set(value, (inner = recording(value, prop)))
          return inner
        }
        return value
      },
      set(t, prop, value, receiver) {
        if (typeof prop === "string") note("write", at(prop))
        return Reflect.set(t, prop, value, receiver)
      },
      has(t, prop) {
        if (typeof prop === "string") note("in", at(prop))
        return Reflect.has(t, prop)
      },
      getOwnPropertyDescriptor(t, prop) {
        if (typeof prop === "string") note("descriptor", at(prop))
        return Reflect.getOwnPropertyDescriptor(t, prop)
      },
      ownKeys(t) {
        note("keys", at("*"))
        return Reflect.ownKeys(t)
      },
    })
  }
  return state
})

vi.mock("../session.js", async (importOriginal) => {
  const orig = (await importOriginal()) as { newSession: (o: unknown) => object }
  return { ...orig, newSession: (opts: unknown) => h.watch(orig.newSession(opts)) }
})
// The census's own tests plant a bad read in a real registration; with none planted it is the original.
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
vi.mock("../../supabase.js", () => {
  // A pinned project belongs to its user (buildMcpServer checks before it pins).
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
// A session in a workspace, so a registration that read it would show.
vi.mock("../workspace-session.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveSessionWorkspace: async () => "00000000-0000-4000-8000-0000000000aa",
}))

const { buildMcpServer } = await import("../server.js")
const { resolveToolOffer } = await import("../tool-offer.js")
const { config } = await import("../../config.js")
const { setPluginEngines } = await import("../../private-plugins/engine-registry.js")
const { setPluginServices } = await import("../../private-plugins/services-registry.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES } = await import(
  "../../availability-override.js"
)

type Build = "cloud" | "community" | "cloud with every plugin service and engine"
type Offer = "no restriction" | "restricted, seen by a user" | "restricted, seen by an admin"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const ADMIN_ID = "00000000-0000-4000-8000-0000000000ad"

/** Every plugin service and engine present; none may be CALLED while registering. */
function standInPlugin(): void {
  const called = (): never => {
    throw new Error("a stand-in plugin member was called while the MCP tools registered")
  }
  const engine = new Proxy({}, { get: () => called }) as never
  setPluginServices({ publicWorkflow: {}, orgs: {}, billing: {}, ugc: {}, policy: {}, collab: {}, signupGate: {}, houseModels: {} } as never)
  setPluginEngines({ scene3d: engine, surround: engine, smartCut: engine } as never)
}

function useBuild(build: Build): void {
  const extras = build === "cloud with every plugin service and engine"
  h.cloud = build !== "community"
  h.orgs = extras
  ;(config as unknown as { SCENE3D_ADVANCED_ENABLED: boolean }).SCENE3D_ADVANCED_ENABLED = extras
  if (extras) standInPlugin()
  else {
    setPluginServices({} as never)
    setPluginEngines({} as never)
  }
}

/** The deployment's offer for this build, and the user it is built for. */
function useOffer(offer: Offer): string {
  h.admins = new Set([ADMIN_ID])
  if (offer === "no restriction") {
    __resetAvailabilityOverridesForTests()
    return USER_ID
  }
  // Admin → Availability hides two nodes from users; an admin keeps them.
  __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => t !== "suno-generate" && t !== "cast-swap"))) })
  return offer === "restricted, seen by an admin" ? ADMIN_ID : USER_ID
}

const SHAPES: Array<[string, Partial<Parameters<typeof buildMcpServer>[0]>]> = [
  ["the public /mcp door (a conversation)", { conversation: { client: "claude-code", key: "k1" } }],
  ["in-process (no conversation)", {}],
  ["first-party", { firstParty: true }],
  ["pinned to a project", { projectScope: { projectId: "p1" } }],
]

const BUILDS: Build[] = ["cloud", "community", "cloud with every plugin service and engine"]
const OFFERS: Offer[] = ["no restriction", "restricted, seen by a user", "restricted, seen by an admin"]

/** Where the census's own tests plant their bad reads: Cloud (the competitor tools register there), the public door, every offer. */
const MUTATION_BUILDS: Build[] = ["cloud"]
const MUTATION_SHAPES = SHAPES.slice(0, 1)

interface Census {
  built: number
  /** Per offer, what `buildMcpServer` resolved for the user it built for: none, or the viewer's admin bit. */
  offersSeen: Set<string>
  reads: Map<string, number>
  fieldsRead: Set<string>
}

/** Build the server once per build × offer × shape, recording what each registration reads. */
async function runCensus(builds: readonly Build[] = BUILDS, shapes = SHAPES, offers: readonly Offer[] = OFFERS): Promise<Census> {
  h.reads = new Map()
  h.fieldsRead = new Set()
  const offersSeen = new Set<string>()
  let built = 0
  try {
    for (const build of builds) {
      useBuild(build)
      for (const offer of offers) {
        const userId = useOffer(offer)
        const resolved = await resolveToolOffer(userId)
        offersSeen.add(resolved ? `admin=${resolved.viewer.admin}` : "none")
        for (const [, shape] of shapes) {
          h.building = true
          try {
            await buildMcpServer({ userId, scopes: [...ALL_SCOPES], clientName: "Claude", fastify: Fastify(), ...shape })
          } finally {
            h.building = false
          }
          built++
        }
      }
    }
  } finally {
    __resetAvailabilityOverridesForTests()
  }
  return { built, offersSeen, reads: h.reads, fieldsRead: h.fieldsRead }
}

/** The path a recorded key names ("userId @ lib/…:12", "conversation [in] @ …", "writes x @ …" → the path). */
const pathOf = (key: string): string => key.split(" @ ")[0]!.replace(/^writes /, "").replace(/ \[[a-z]+\]$/, "")

/** The recorded reads that are not allowed at registration. */
const outsideOf = (census: Census): string[] => [...census.reads.keys()].filter((k) => !Object.hasOwn(ALLOWED_AT_REGISTRATION, pathOf(k))).sort()

let main: Census
beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  main = await runCensus()
}, 120_000)

afterAll(() => {
  h.mutation = null
  useBuild("cloud")
})

describe("MCP tool registration reads no field of the caller's session", () => {
  it("builds every edition, offer and session shape", () => {
    expect(main.built).toBe(BUILDS.length * OFFERS.length * SHAPES.length)
    // A deployment with no restriction (no offer), and a restricted one seen by a user and by an admin.
    expect([...main.offersSeen].sort()).toEqual(["admin=false", "admin=true", "none"])
    // The census saw the registrations: every build reads the scopes.
    expect(main.fieldsRead.has("scopes")).toBe(true)
  })

  it("reads, at registration, only the paths that decide what is offered", () => {
    expect(
      outsideOf(main),
      "A registration reads (or writes) a field of the caller's session. Read it inside the tool's handler, when the tool runs; " +
        "a path that decides what a session is offered goes in ALLOWED_AT_REGISTRATION with what it varies by.",
    ).toEqual([])
  })

  it("lists no allowed path that no registration reads any more (the list only shrinks)", () => {
    const stale = Object.keys(ALLOWED_AT_REGISTRATION).filter((f) => !main.fieldsRead.has(f))
    expect(stale, "remove these from ALLOWED_AT_REGISTRATION").toEqual([])
  })
})

describe("the census catches a registration that reads the caller", () => {
  // Each plants one bad read inside the competitor tools' registration and runs the census again.
  it.each<[string, (s: Record<string, unknown>) => void, RegExp]>([
    ["the user id, read only where the deployment restricts its offer", (s) => {
      if (s.offer) void s.userId
    }, /^userId$/],
    ["a field through its property descriptor", (s) => void Object.getOwnPropertyDescriptor(s, "userId")?.value, /^userId$/],
    ["a field's presence through `in`", (s) => void ("conversation" in s), /^conversation$/],
    ["a field's presence through Object.hasOwn", (s) => void Object.hasOwn(s, "conversation"), /^conversation$/],
    ["every field, by listing the keys", (s) => void Object.keys(s), /^\*$|^\(every field/],
    ["the caller's admin bit, nested under the offer", (s) => void (s.offer as { viewer?: { admin?: boolean } } | undefined)?.viewer?.admin, /^offer\.viewer/],
    ["an address the registrations do not read, nested under the addresses", (s) => void (s.addresses as { mcpUrl?: string }).mcpUrl, /^addresses\.mcpUrl$/],
  ])("%s", async (_name, mutation, expected) => {
    h.mutation = mutation
    try {
      const census = await runCensus(MUTATION_BUILDS, MUTATION_SHAPES)
      expect(outsideOf(census).map(pathOf)).toEqual(expect.arrayContaining([expect.stringMatching(expected)]))
    } finally {
      h.mutation = null
    }
  })
})
