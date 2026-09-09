/**
 * What the dispatcher does with a name on the studio surface.
 *
 * The allowlist is enforced where the call happens, not where the list is
 * built — and on this surface there is a second gate behind it: a tool that
 * changes the document or spends credits is never called by the plain
 * dispatch path at all. It is proposed, and a person presses Apply. Until the
 * studio interception is wired, that gate is the whole of it; after, it is the
 * belt beneath it. Either way the test is the same: the invoker is never
 * reached.
 */
import { describe, expect, it, vi } from "vitest"
import type { McpInvoker } from "../../../lib/mcp/invoke.js"
import { NATIVE_TOOLS } from "../constants.js"
import { copilotSurface } from "../surfaces.js"
import { dispatchTool } from "../tools/registry.js"

function fakeInvoker(): McpInvoker & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    listTools: async () => [],
    callTool: async (name, args) => {
      calls.push({ name, args: args as Record<string, unknown> })
      return { content: [{ type: "text", text: "ok" }] }
    },
    close: async () => undefined,
  }
}

function deps(surface: "workflow" | "studio", invoker: McpInvoker) {
  return {
    ctx: {
      userId: "u1",
      workflowId: "prod-1",
      projectId: "p1",
      threadId: "t1",
      turnId: "turn1",
      allowPublishing: false,
      userLinks: new Set<string>(),
      fastify: {} as never,
      emit: vi.fn(),
    },
    invoker,
    addedNodeTypes: new Set<string>(),
    wiredAssets: [],
    created: { count: 0 },
    surface: copilotSurface(surface),
  }
}

describe("a canvas native on the studio surface", () => {
  it.each([
    NATIVE_TOOLS.getGraph,
    NATIVE_TOOLS.editWorkflow,
    NATIVE_TOOLS.createWorkflow,
    NATIVE_TOOLS.runWorkflow,
    NATIVE_TOOLS.getExecution,
    NATIVE_TOOLS.getWorkflowGraph,
  ])("%s is refused, and nothing is called", async (name) => {
    const invoker = fakeInvoker()
    const outcome = await dispatchTool(deps("studio", invoker), name, { note: "hi" })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain("not available in this conversation")
    expect(invoker.calls).toEqual([])
  })

})

describe("nothing writes or spends without a person", () => {
  it.each([
    "edit_studio_production",
    "generate_studio_still",
    "generate_studio_clip",
    "generate_studio_keyframe",
    "new_studio_shot_from_frame",
    "voice_studio_shot",
    "revoice_studio_clip",
    "score_studio_production",
    "describe_studio_production",
    "share_studio_production",
    "import_studio_production",
    "clone_studio_production",
  ])("%s is never called through the plain path", async (name) => {
    const invoker = fakeInvoker()
    const outcome = await dispatchTool(deps("studio", invoker), name, { shot_id: "s1" })
    expect(outcome.isError).toBe(true)
    expect(invoker.calls).toEqual([])
  })

  it("refuses a tool that is not on the surface at all", async () => {
    const invoker = fakeInvoker()
    const outcome = await dispatchTool(deps("studio", invoker), "generate_image", { prompt: "x" })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain("not available in this conversation")
    expect(invoker.calls).toEqual([])
  })

  it("lets a free read through", async () => {
    const invoker = fakeInvoker()
    const outcome = await dispatchTool(deps("studio", invoker), "get_studio_production", { detail: "summary" })
    expect(outcome.isError).toBe(false)
    expect(invoker.calls).toHaveLength(1)
  })
})

describe("the pinned id", () => {
  it("is the production on the studio surface", async () => {
    const invoker = fakeInvoker()
    await dispatchTool(deps("studio", invoker), "get_studio_production", { detail: "summary" })
    expect(invoker.calls[0].args).toMatchObject({ production_id: "prod-1", detail: "summary" })
    expect(invoker.calls[0].args.workflow_id).toBeUndefined()
  })

  it("is the workflow on the canvas", async () => {
    const invoker = fakeInvoker()
    await dispatchTool(deps("workflow", invoker), "get_node_skill", { node_type: "generate-image" })
    expect(invoker.calls[0].args).toMatchObject({ workflow_id: "prod-1", node_type: "generate-image" })
    expect(invoker.calls[0].args.production_id).toBeUndefined()
  })

  it("wins over a model-supplied one on BOTH surfaces", async () => {
    const studioInvoker = fakeInvoker()
    await dispatchTool(deps("studio", studioInvoker), "get_studio_production", {
      production_id: "somebody-elses-film",
      workflow_id: "somebody-elses-film",
    })
    expect(studioInvoker.calls[0].args.production_id).toBe("prod-1")

    const canvasInvoker = fakeInvoker()
    await dispatchTool(deps("workflow", canvasInvoker), "get_node_skill", { workflow_id: "somebody-elses-flow" })
    expect(canvasInvoker.calls[0].args.workflow_id).toBe("prod-1")
  })
})

describe("the pinned read argument", () => {
  it("keeps the read from landing finished work, whatever the model asks", async () => {
    const invoker = fakeInvoker()
    await dispatchTool(deps("studio", invoker), "get_studio_production", { reconcile: true })
    expect(invoker.calls[0].args.reconcile).toBe(false)
  })
})

/**
 * The interception is REACHED from the shared dispatcher, not only importable.
 *
 * Every property the studio branch holds — one card per message, a preview
 * before a write, a price asked for rather than assumed — is worth nothing if
 * the loop's own dispatcher never calls it. These two cases are that wire: a
 * proposing tool comes back as a proposal instead of a refusal, and the export
 * native, which exists on no MCP allowlist, reaches its branch rather than
 * falling through to "not available".
 */
describe("the studio branch is wired into the shared dispatcher", () => {
  function studioDeps(invoker: McpInvoker) {
    return {
      ...deps("studio", invoker),
      studio: {
        tools: { confirmClasses: new Map<string, "$" | "P">([["share_studio_production", "P"]]), quotable: new Set<string>() },
        proposed: false,
        previewUnavailable: false,
      },
    }
  }

  it("turns a publish into a proposal and calls nothing", async () => {
    const invoker = fakeInvoker()
    const outcome = await dispatchTool(studioDeps(invoker), "share_studio_production", { shared: true })
    expect(outcome.isError).toBe(false)
    expect(outcome.proposal).toMatchObject({ kind: "publish", tool: "share_studio_production" })
    expect(invoker.calls).toEqual([])
  })

  it("refuses a second proposal in the same message, and calls nothing for it", async () => {
    const invoker = fakeInvoker()
    const shared = studioDeps(invoker)
    await dispatchTool(shared, "share_studio_production", { shared: true })
    const second = await dispatchTool(shared, "share_studio_production", { shared: false })
    expect(second.isError).toBe(true)
    expect(second.proposal).toBeUndefined()
    expect(invoker.calls).toEqual([])
  })

  it("reaches the export native, which is on no MCP allowlist", async () => {
    const invoker = fakeInvoker()
    const outcome = await dispatchTool(studioDeps(invoker), "export_studio_production", {})
    // Whatever the plan answers, the name must NOT come back as "not available":
    // it is this surface's own tool, and the branch that owns it was entered.
    expect(outcome.text).not.toContain("not available in this conversation")
    expect(invoker.calls.map((call) => call.name)).toEqual(["plan_studio_export"])
  })
})
