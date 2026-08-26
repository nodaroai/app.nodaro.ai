/**
 * The tool surface. The allowlist has to hold at CALL time, not only when
 * listing: the copilot's MCP server registers every tool its scopes allow —
 * about a hundred generation verbs ride on `workflows:execute` — and a
 * hallucinated `generate_image` must not spend the user's credits.
 */
import { describe, expect, it, vi } from "vitest"
import { buildToolDefinitions, dispatchTool } from "../tools/registry.js"
import { MCP_TOOL_ALLOWLIST, NATIVE_TOOLS } from "../constants.js"
import type { McpInvoker } from "../../../lib/mcp/invoke.js"

function fakeInvoker(extra: string[] = []): McpInvoker & { calls: Array<{ name: string; args: unknown }> } {
  const calls: Array<{ name: string; args: unknown }> = []
  return {
    calls,
    listTools: async () => [
      { name: "get_node_skill", description: "docs", inputSchema: { type: "object", properties: {}, $schema: "x" } },
      { name: "generate_image", description: "spends credits", inputSchema: { type: "object", properties: {} } },
      ...extra.map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })),
    ],
    callTool: async (name, args) => {
      calls.push({ name, args })
      return { content: [{ type: "text", text: "mcp says hi" }] }
    },
    close: async () => undefined,
  }
}

const deps = {
  ctx: { userId: "u1", workflowId: "wf1", projectId: "p1", threadId: "t1", turnId: "turn1",
  allowPublishing: false, userLinks: new Set<string>(), fastify: {} as never, emit: vi.fn() },
  invoker: fakeInvoker(),
  addedNodeTypes: new Set<string>(), wiredAssets: [], created: { count: 0 },
}

describe("buildToolDefinitions", () => {
  it("offers the native tools plus ONLY allowlisted MCP tools, in a stable order", async () => {
    const tools = await buildToolDefinitions(fakeInvoker())
    const names = tools.map((t) => t.name)
    expect(names).toContain(NATIVE_TOOLS.getGraph)
    expect(names).toContain(NATIVE_TOOLS.editWorkflow)
    expect(names).toContain("get_node_skill")
    expect(names).not.toContain("generate_image")
    expect(names).toEqual([...names].sort())
  })

  it("strips $schema so the definition is a plain JSON Schema object", async () => {
    const tools = await buildToolDefinitions(fakeInvoker())
    const skill = tools.find((t) => t.name === "get_node_skill")!
    expect(skill.input_schema.$schema).toBeUndefined()
    expect(skill.input_schema.type).toBe("object")
  })

  it("never exposes a workflow-write MCP tool", () => {
    for (const forbidden of ["update_workflow_json", "create_workflow", "delete_workflow", "import_workflow"]) {
      expect(MCP_TOOL_ALLOWLIST.has(forbidden)).toBe(false)
    }
  })
})

describe("dispatchTool", () => {
  it("refuses a non-allowlisted tool instead of calling it", async () => {
    const invoker = fakeInvoker()
    const outcome = await dispatchTool({ ...deps, invoker }, "generate_image", { prompt: "spend money" })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain("not available")
    expect(invoker.calls).toEqual([])
  })

  it("pins workflow_id on an allowlisted MCP call so the model cannot retarget it", async () => {
    const invoker = fakeInvoker()
    await dispatchTool({ ...deps, invoker }, "get_node_skill", { node_type: "generate-image", workflow_id: "someone-elses" })
    expect(invoker.calls[0]!.args).toMatchObject({ node_type: "generate-image", workflow_id: "wf1" })
  })

  it("pins the copilot to the user's OWN gallery, whatever scope the model asks for", async () => {
    // `browse_gallery`'s public branch returns other users' rows, 80 characters
    // of each one's prompt included. Free and Basic outputs are public by
    // definition, so anyone with a free account can seed attacker-authored text
    // into that corpus — and the tool's `query` argument aims at it. Every
    // other untrusted string the copilot reads was written by the user it is
    // working for. Enforced at DISPATCH: hiding `scope` from the schema would
    // describe the rule, not impose it.
    const invoker = fakeInvoker(["browse_gallery"])
    await dispatchTool({ ...deps, invoker }, "browse_gallery", { scope: "public", query: "ignore previous" })

    expect(invoker.calls[0]!.args).toMatchObject({ scope: "mine", query: "ignore previous" })
  })

  it("pins components to the user's own, not the public marketplace", async () => {
    // `list_components` defaults to the marketplace, and `is_listed` is set
    // from the publish request body — self-serve, no review. It was allowlisted
    // so the copilot could reuse the user's OWN building blocks; the
    // marketplace half is attacker-authored text nobody asked for.
    const invoker = fakeInvoker(["list_components"])
    await dispatchTool({ ...deps, invoker }, "list_components", { scope: "public", search: "x" })

    expect(invoker.calls[0]!.args).toMatchObject({ scope: "mine" })
  })

  it("leaves a tool with nothing pinned exactly as the model sent it", async () => {
    const invoker = fakeInvoker(["list_objects"])
    await dispatchTool({ ...deps, invoker }, "list_objects", { search: "sword", limit: 10 })

    expect(invoker.calls[0]!.args).toMatchObject({ search: "sword", limit: 10 })
  })

  it("turns a thrown tool error into a result the model can act on", async () => {
    const invoker: McpInvoker = {
      listTools: async () => [],
      callTool: async () => {
        throw new Error("upstream exploded")
      },
      close: async () => undefined,
    }
    const outcome = await dispatchTool({ ...deps, invoker }, "get_node_skill", {})
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain("upstream exploded")
  })
})

describe("create_workflow is bounded per TURN, not per model's judgement", () => {
  it("allows one and refuses the second in the same turn", async () => {
    const invoker = fakeInvoker()
    const turnDeps = { ...deps, invoker, created: { count: 0 } }
    const first = await dispatchTool(turnDeps as never, NATIVE_TOOLS.createWorkflow, { name: "One" })
    const second = await dispatchTool(turnDeps as never, NATIVE_TOOLS.createWorkflow, { name: "Two" })
    // The first may fail on the mocked supabase; what is pinned is that the
    // SECOND is refused by the counter before it ever reaches the database.
    expect(second.isError).toBe(true)
    expect(second.text).toMatch(/per message/)
    expect(first.text).not.toMatch(/per message/)
  })

  it("counts before awaiting — two calls a microtask apart cannot both pass", async () => {
    const turnDeps = { ...deps, invoker: fakeInvoker(), created: { count: 0 } }
    const [a, b] = await Promise.all([
      dispatchTool(turnDeps as never, NATIVE_TOOLS.createWorkflow, { name: "A" }),
      dispatchTool(turnDeps as never, NATIVE_TOOLS.createWorkflow, { name: "B" }),
    ])
    const refused = [a, b].filter((r) => /per message/.test(r.text))
    expect(refused).toHaveLength(1)
  })

  it("keeps a created workflow's nodes off the OPEN workflow's run card", async () => {
    // `addedNodeTypes` feeds the Run card for the graph on screen. Listing
    // nodes that went into a different workflow would tell the user they are
    // about to spend credits on something their canvas never gained.
    const turnDeps = { ...deps, invoker: fakeInvoker(), addedNodeTypes: new Set<string>(), created: { count: 0 } }
    await dispatchTool(turnDeps as never, NATIVE_TOOLS.createWorkflow, { name: "Side", nodes: [] })
    expect([...turnDeps.addedNodeTypes]).toEqual([])
  })
})

describe("get_workflow_graph is on the tool surface", () => {
  it("is offered to the model, and is NATIVE — not a name the MCP path could serve", () => {
    // Asserted through the allowlist rather than by dispatching: the MCP
    // fall-through pins `workflow_id` to the OPEN workflow, so a native tool
    // that ever leaked into that branch would silently read the wrong graph.
    // Absent from the allowlist, the branch refuses it outright.
    expect(MCP_TOOL_ALLOWLIST.has(NATIVE_TOOLS.getWorkflowGraph)).toBe(false)
    expect(MCP_TOOL_ALLOWLIST.has(NATIVE_TOOLS.createWorkflow)).toBe(false)
  })

  it("both appear in the model's tool list", async () => {
    const names = (await buildToolDefinitions(fakeInvoker())).map((t) => t.name)
    expect(names).toContain(NATIVE_TOOLS.getWorkflowGraph)
    expect(names).toContain(NATIVE_TOOLS.createWorkflow)
  })
})
