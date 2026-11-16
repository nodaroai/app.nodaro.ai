/**
 * A TOOL READS WHO IS CALLING WHEN IT RUNS, NEVER WHEN IT IS REGISTERED.
 *
 * Today every request builds its own server, so a value read from the session
 * at registration happens to be the caller's. A server whose tools are built
 * once and run for many callers would hand every caller the value of whoever
 * it was built for. Each case below builds the tools for one session and then
 * runs them as another (the session's fields changed after registration, as a
 * shared build would see them), and checks that the run answers for the
 * session that runs it.
 *
 * The general guard over every registration is registration-reads-census.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const h = vi.hoisted(() => ({ admins: new Set<string>(), from: null as unknown as ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>> }))
vi.mock("../../supabase.js", () => {
  h.from = vi.fn<(...args: unknown[]) => unknown>()
  return { supabase: { from: (...args: unknown[]) => h.from(...args) } }
})
vi.mock("../../admin-check.js", () => ({ checkIsAdmin: async (userId: string) => h.admins.has(userId) }))

const { newSession } = await import("../session.js")
const { createMcpInvoker } = await import("../invoke.js")
const { installToolOffer, resolveToolOffer } = await import("../tool-offer.js")
const { registerCompetitorTools } = await import("../tools/competitors.js")
const { registerWorkflows } = await import("../tools/workflows.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES } = await import(
  "../../availability-override.js"
)

type Session = ReturnType<typeof newSession>

/**
 * `session` with every field read made while `recording` is on noted down: the
 * fields a registration reads.
 */
function watched(session: Session): { session: Session; readsDuring: (register: () => void) => string[] } {
  let recording = false
  const reads = new Set<string>()
  const proxy = new Proxy(session, {
    get(target, prop, receiver) {
      if (recording && typeof prop === "string") reads.add(prop)
      return Reflect.get(target, prop, receiver)
    },
  })
  return {
    session: proxy,
    readsDuring(register) {
      recording = true
      try {
        register()
      } finally {
        recording = false
      }
      return [...reads].sort()
    },
  }
}

const textOf = (res: { content: { text?: string }[] }) => res.content.map((c) => c.text ?? "").join("\n")

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
})

afterEach(() => {
  h.admins = new Set()
  __resetAvailabilityOverridesForTests()
})

describe("the competitor tools", () => {
  it("registering them reads no user id", () => {
    const { session, readsDuring } = watched(newSession({ userId: "user-a", scopes: ["assets:read", "assets:write", "workflows:execute"], clientName: "Claude" }))
    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } })
    expect(readsDuring(() => registerCompetitorTools({ server, session, fastify: Fastify() }))).not.toContain("userId")
  })

  // EVIDENCE, not a guard: this held before the change too. The request helper
  // (`mcpInject`) overwrites the user-id header with the running session's, so
  // the id the registration used to keep never reached a route. Kept to show it.
  it("the route hears the user who runs the tool, not the one they were registered for", async () => {
    const app = Fastify()
    const heard: Array<{ url: string; user: unknown }> = []
    for (const url of ["/v1/competitors", "/v1/competitors/cards", "/v1/competitors/:id/lessons", "/v1/competitors/actions"]) {
      app.get(url, async (req, reply) => {
        heard.push({ url: req.url, user: req.headers["x-internal-user-id"] })
        // The route's "not set up here" answer: the tool stops at the status, so no body shape matters.
        return reply.status(503).send({ error: { code: "unavailable", message: "x" } })
      })
    }
    const session = newSession({ userId: "user-a", scopes: ["assets:read", "assets:write", "workflows:execute"], clientName: "Claude" })
    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } })
    registerCompetitorTools({ server, session, fastify: app })

    // Run as another user.
    session.userId = "user-b"
    const mcp = createMcpInvoker(server)
    await mcp.callTool("list_competitors", {})
    await mcp.callTool("competitor_cards", {})
    await mcp.callTool("competitor_lessons", { competitor_id: "00000000-0000-4000-8000-0000000000c1" })
    await mcp.callTool("competitor_tried", {})
    expect(heard.map((r) => r.user)).toEqual(["user-b", "user-b", "user-b", "user-b"])
  })
})

describe("the offer's re-check of a call", () => {
  it("asks about the user who makes the call, not the one the tools were registered for", async () => {
    // The admin switch hides Suno from users; an admin keeps it.
    h.admins = new Set(["admin-a"])
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => t !== "suno-generate"))) })

    const session = newSession({ userId: "admin-a", scopes: ["workflows:execute"], clientName: "Claude" })
    const offer = await resolveToolOffer("admin-a")
    expect(offer?.viewer.admin).toBe(true)
    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } })
    installToolOffer(server, { session, offer })
    // Registered for the admin: the tool is offered to them.
    server.registerTool("suno_generate", { description: "x", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "ran" }] }))
    const mcp = createMcpInvoker(server)

    // Run as a user the switch hides it from: refused, as the run would refuse them.
    session.userId = "user-b"
    expect(textOf(await mcp.callTool("suno_generate", {}))).toMatch(/403 node_not_available\): .*suno-generate/)

    // Run as the admin again: it runs.
    session.userId = "admin-a"
    expect(textOf(await mcp.callTool("suno_generate", {}))).toBe("ran")
  })
})

describe("the workflow tools", () => {
  const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"

  /** The workflow lookup finds nothing: the tool answers "Workflow not found …". */
  function notFound() {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: null, error: null })
    h.from.mockReturnValue(chain)
  }

  it("name the project a run looks in from the session that runs, not the one they were registered for", async () => {
    notFound()
    // Registered for an in-app session pinned to the open workflow's project…
    const { session, readsDuring } = watched(newSession({ userId: "u1", scopes: ["workflows:write"], clientName: "Claude", scopedProjectId: MCP_PROJECT_ID }))
    session.mcpProjectId = MCP_PROJECT_ID
    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } })
    expect(readsDuring(() => registerWorkflows({ server, session, fastify: Fastify() }))).not.toContain("scopedProjectId")
    const mcp = createMcpInvoker(server)
    expect(textOf(await mcp.callTool("delete_workflow", { workflow_id: "00000000-0000-4000-8000-000000000001" }))).toContain("Workflow not found in this project")

    // …run as an outside client's session, which works in the mcp project.
    ;(session as { scopedProjectId?: string }).scopedProjectId = undefined
    expect(textOf(await mcp.callTool("delete_workflow", { workflow_id: "00000000-0000-4000-8000-000000000001" }))).toContain("Workflow not found in mcp project")
  })
})
