/**
 * CALLERS SHARING ONE BUILD STAY APART (`MCP_TOOLS_BUILT_ONCE`).
 *
 * With the flag on, many callers run the SAME tool objects. What keeps them
 * apart is that a tool reads the caller only when it runs, from the request it
 * runs for. These cases run many callers through one shared build at once,
 * their calls interleaved by awaits of random length, and check that each
 * caller sees and causes only its own:
 *  - its own user id and client name (`ping`);
 *  - its own user id where a tool calls a route (the route hears the header),
 *    after the tool has awaited;
 *  - its own `user_request` and `flow_id`, which the conversation wrapper writes
 *    on the session at the start of the call and the flow reads after an await;
 *  - and a caller with fewer scopes, or a user a node is hidden from, never gets
 *    a tool or a description only a wider caller has, however their requests
 *    interleave.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { ALL_SCOPES, type Scope } from "../../scopes.js"

const h = vi.hoisted(() => ({
  admins: new Set<string>(),
  /** What each conversation flow saw, read from the session after an await. */
  flows: [] as Array<{ userId: string; userRequest: string | undefined; flowRequest: string | undefined; tool: string | undefined; store: unknown }>,
  storeOf: null as null | (() => unknown),
}))

const pause = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15)))

vi.mock("../../supabase.js", () => {
  // Nothing is stored, except each profile's role, from the same admins as the
  // stand-in admin check below: forty callers looking up the admin at once
  // reach the real admin check as well as the stand-in.
  const chain = (table: string) => {
    let id = ""
    const c: Record<string, unknown> = {}
    for (const m of ["select", "is", "in", "order", "limit"]) c[m] = () => c
    c.eq = (column: string, value: unknown) => {
      if (column === "id") id = String(value)
      return c
    }
    c.maybeSingle = async () => ({ data: null, error: null })
    c.single = async () =>
      table === "profiles" ? { data: { role: h.admins.has(id) ? "admin" : "user" }, error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
    return c
  }
  return { supabase: { from: (table: string) => chain(table) } }
})
vi.mock("../../admin-check.js", () => ({ checkIsAdmin: async (userId: string) => h.admins.has(userId) }))
// The conversation flow: it reads the call's own fields from the session after an await.
vi.mock("../flows/record.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    prepareFlowNode: async (session: { userId: string; userRequest?: string; flowRequest?: string; currentTool?: string }) => {
      await pause()
      h.flows.push({ userId: session.userId, userRequest: session.userRequest, flowRequest: session.flowRequest, tool: session.currentTool, store: h.storeOf?.() })
      return null
    },
  }
})

const { mcpServerForRequest, __sharedMcpBuildsForTests, __resetSharedMcpBuildsForTests, __callerStoreForTests } = await import("../tools-built-once.js")
const { buildMcpServer } = await import("../server.js")
const { setLlmMeteredSchemaReadyForTesting } = await import("../../llm-metered-schema-gate.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES } = await import(
  "../../availability-override.js"
)

const CALLERS = 60
/** Tens of callers building, listing and calling at once: generous, so a busy runner does not cut them short. */
const CONCURRENT_TIMEOUT_MS = 60_000
const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const userOf = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
const jobOf = (userId: string) => `11111111-1111-4111-8111-${userId.slice(-12)}`

let app: FastifyInstance
/** Every user id a route heard, in arrival order. */
let heard: string[]

async function connect(server: { connect(t: Transport): Promise<void> }): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: "isolation-test", version: "1" })
  await client.connect(clientSide)
  return client
}

/** One request, as `/mcp` serves it with the flag on: its own server, from the shared build. */
async function asCaller<T>(userId: string, clientName: string, scopes: Scope[], run: (client: Client) => Promise<T>): Promise<T> {
  const server = await mcpServerForRequest({ userId, scopes, clientName, fastify: app, conversation: { client: "claude-code", key: `conv-${userId}` } })
  const client = await connect(server)
  try {
    return await run(client)
  } finally {
    await client.close()
  }
}

const textOf = (res: unknown) => ((res as { content: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("\n")

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  h.storeOf = __callerStoreForTests
})

beforeEach(() => {
  setLlmMeteredSchemaReadyForTesting(true)
  __resetAvailabilityOverridesForTests()
  h.admins = new Set([ADMIN])
  h.flows = []
  heard = []
  app = Fastify()
  // The generation route the image verb calls: it answers the job of the user it heard, after a pause.
  app.post("/v1/generate-image", async (req) => {
    const user = String(req.headers["x-internal-user-id"])
    heard.push(user)
    await pause()
    return { jobId: jobOf(user) }
  })
})

afterEach(() => {
  __resetSharedMcpBuildsForTests()
  __resetAvailabilityOverridesForTests()
})

describe("callers sharing one build", () => {
  it("each sees its own identity, whatever runs beside it", async () => {
    const answers = await Promise.all(
      Array.from({ length: CALLERS }, (_, i) =>
        asCaller(userOf(i), `Client ${i}`, [...ALL_SCOPES], async (client) => {
          await pause()
          return textOf(await client.callTool({ name: "ping", arguments: {} }))
        }),
      ),
    )
    expect(answers).toEqual(Array.from({ length: CALLERS }, (_, i) => `pong (userId: ${userOf(i)}, client: Client ${i})`))
    expect(__sharedMcpBuildsForTests(app).built).toBe(1)
  }, CONCURRENT_TIMEOUT_MS)

  it("each call reaches its route as its own user, with its own words and flow, after awaiting", async () => {
    const answers = await Promise.all(
      Array.from({ length: CALLERS }, (_, i) =>
        asCaller(userOf(i), "Claude", [...ALL_SCOPES], async (client) => {
          await pause()
          const flowId = i % 2 === 0 ? "new" : undefined
          const res = await client.callTool({ name: "generate_image", arguments: { prompt: `a picture ${i}`, user_request: `request of caller ${i}`, ...(flowId ? { flow_id: flowId } : {}) } })
          return { i, text: textOf(res) }
        }),
      ),
    )
    for (const { i, text } of answers) expect(text).toContain(jobOf(userOf(i)))
    expect([...heard].sort()).toEqual(Array.from({ length: CALLERS }, (_, i) => userOf(i)).sort())
    expect(h.flows).toHaveLength(CALLERS)
    for (const flow of h.flows) {
      const i = Number(flow.userId.slice(-12))
      expect(flow).toMatchObject({ userRequest: `request of caller ${i}`, flowRequest: i % 2 === 0 ? "new" : undefined, tool: "generate_image" })
    }
    expect(__sharedMcpBuildsForTests(app).built).toBe(1)
  }, CONCURRENT_TIMEOUT_MS)

  it("keeps nothing in a call's context but that call's session", async () => {
    await asCaller(userOf(1), "Claude", [...ALL_SCOPES], (client) => client.callTool({ name: "generate_image", arguments: { prompt: "x" } }))
    const store = h.flows[0]!.store as Record<string, unknown>
    expect(Object.keys(store)).toEqual(["session"])
    expect((store.session as { userId: string }).userId).toBe(userOf(1))
  })
})

describe("a narrower caller never gets a wider caller's tools", () => {
  it("by scope: interleaved read-only and full callers each list exactly their own tools", async () => {
    const READ_ONLY: Scope[] = ["workflows:read", "jobs:read", "assets:read"]
    const own = {
      full: JSON.stringify(await (await connect(await buildMcpServer({ userId: userOf(0), scopes: [...ALL_SCOPES], clientName: "Claude", fastify: app, conversation: { client: "claude-code", key: "x" } }))).listTools()),
      readOnly: JSON.stringify(await (await connect(await buildMcpServer({ userId: userOf(0), scopes: READ_ONLY, clientName: "Claude", fastify: app, conversation: { client: "claude-code", key: "x" } }))).listTools()),
    }
    const answers = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const full = i % 2 === 0
        return asCaller(userOf(i), "Claude", full ? [...ALL_SCOPES] : READ_ONLY, async (client) => {
          await pause()
          const list = JSON.stringify(await client.listTools())
          const called = textOf(await client.callTool({ name: "generate_image", arguments: { prompt: "x" } }).catch((e: Error) => ({ content: [{ text: e.message }] })))
          return { full, list, called }
        })
      }),
    )
    for (const a of answers) {
      expect(a.list).toBe(a.full ? own.full : own.readOnly)
      if (!a.full) expect(a.called).toMatch(/not found|Tool generate_image/i)
    }
    expect(own.full).not.toBe(own.readOnly)
    expect(__sharedMcpBuildsForTests(app).built).toBe(2)
  }, CONCURRENT_TIMEOUT_MS)

  it("by the admin switch: a user the node is hidden from never sees it, beside an admin who keeps it", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => t !== "suno-generate"))) })
    const answers = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const admin = i % 2 === 0
        return asCaller(admin ? ADMIN : userOf(i), "Claude", [...ALL_SCOPES], async (client) => {
          await pause()
          const names = (await client.listTools()).tools.map((t) => t.name)
          const called = textOf(await client.callTool({ name: "suno_generate", arguments: { prompt: "x" } }))
          return { admin, listed: names.includes("suno_generate"), called }
        })
      }),
    )
    for (const a of answers) {
      expect(a.listed).toBe(a.admin)
      if (!a.admin) expect(a.called).toMatch(/node_not_available/)
    }
    expect(__sharedMcpBuildsForTests(app).built).toBe(2)
  }, CONCURRENT_TIMEOUT_MS)
})
