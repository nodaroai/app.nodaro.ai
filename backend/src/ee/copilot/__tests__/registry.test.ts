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
  ctx: { userId: "u1", workflowId: "wf1", projectId: "p1", threadId: "t1", turnId: "turn1", fastify: {} as never, emit: vi.fn() },
  invoker: fakeInvoker(),
  addedNodeTypes: new Set<string>(),
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
