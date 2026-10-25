import { describe, expect, it } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { conversationIdentityFromHeaders } from "../conversation-key.js"
import { conversationName, monthKey } from "../conversation-store.js"
import { flowNodeId, jobIdOfMediaUrl, outputHandleOf, placeFlowNode, relinkImported, workflowIdOfFlowNode } from "../flow-graph.js"
import { hydratedNodeData } from "../hydrate.js"
import { attachUserRequest } from "../user-request.js"
import { flowNodeFor } from "../node-mappers.js"
import { newSession } from "../../session.js"
import { createMcpInvoker } from "../../invoke.js"

/** The tool each test route is called by. */
const TOOL: Record<string, string> = {
  "/v1/generate-image": "generate_image",
  "/v1/image-to-image": "modify_image",
  "/v1/generate-video": "animate_image",
  "/v1/text-to-video": "generate_video",
  "/v1/image-collage": "image_collage",
}
const nodeFor = (route: string, body: unknown) => flowNodeFor(route, body, TOOL[route] ?? "generate_image")


describe("conversationIdentityFromHeaders (what the 2026-10-24 measurement found)", () => {
  it("ChatGPT: x-openai-session is the chat", () => {
    expect(conversationIdentityFromHeaders({ "user-agent": "openai-mcp/1.0.0", "x-openai-session": "v1/abc" }, "ChatGPT"))
      .toEqual({ client: "chatgpt", key: "v1/abc" })
  })

  it("Claude Code: the echoed mcp-session-id is the chat", () => {
    expect(conversationIdentityFromHeaders({ "user-agent": "Claude-User", "x-anthropic-client": "ClaudeCode", "mcp-session-id": "s-1" }, "Claude Code"))
      .toEqual({ client: "claude-code", key: "s-1" })
    expect(conversationIdentityFromHeaders({ "user-agent": "claude-code/2.1.309 (cli)", "mcp-session-id": "s-2" }, "x"))
      .toEqual({ client: "claude-code", key: "s-2" })
  })

  it("Claude.ai: its mcp-session-id spans chats, so there is no key (time gap)", () => {
    expect(conversationIdentityFromHeaders({ "user-agent": "Claude-User", "x-anthropic-client": "ClaudeAI", "mcp-session-id": "same-for-all" }, "Claude"))
      .toEqual({ client: "claude", key: null })
  })

  it("anything else has no key", () => {
    expect(conversationIdentityFromHeaders({ "user-agent": "Cursor/1.0", "mcp-session-id": "c" }, "Cursor")).toEqual({ client: "other", key: null })
  })
})

describe("conversation naming", () => {
  it("takes the user's first request, shortened", () => {
    expect(conversationName("make an image of two dolphins", undefined)).toBe("make an image of two dolphins")
    const long = "x".repeat(80)
    const name = conversationName(long, undefined)
    expect(name.length).toBe(50)
    expect(name.endsWith("…")).toBe(true)
  })

  it("falls back to the assistant's prompt, then a plain name", () => {
    expect(conversationName(undefined, "a lighthouse")).toBe("a lighthouse")
    expect(conversationName(undefined, undefined)).toBe("MCP conversation")
  })

  it("months are UTC", () => {
    expect(monthKey(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10")
  })
})

const IMG = "https://media.nodaro.ai/images/11111111-2222-3333-4444-555555555555.png"

describe("placeFlowNode", () => {
  it("wires an input an earlier node produced, from that node", () => {
    const earlier = {
      id: "a", type: "generate-image", position: { x: 520, y: 80 },
      data: { generatedResults: [{ url: IMG, jobId: "11111111-2222-3333-4444-555555555555" }] },
    }
    const spec = nodeFor("/v1/generate-video", { imageUrl: IMG, prompt: "jump", provider: "grok-i2v" })!
    const placed = placeFlowNode([earlier], "b", spec, spec.data as Record<string, unknown>)
    expect(placed.upsertNodes.map((n) => n.id)).toEqual(["b"])
    expect(placed.upsertEdges).toEqual([
      { id: "e-a-image-b-startFrame", source: "a", sourceHandle: "image", target: "b", targetHandle: "startFrame" },
    ])
    expect(placed.upsertNodes[0].position).toEqual({ x: 960, y: 80 })
  })

  it("wires a take the node does not send from its own node, so two takes are two wires", () => {
    const IMG2 = "https://media.nodaro.ai/images/99999999-2222-3333-4444-555555555555.png"
    const earlier = {
      id: "a", type: "generate-image", position: { x: 520, y: 80 },
      data: { activeResultIndex: 1, generatedResults: [{ url: IMG, jobId: "11111111-2222-3333-4444-555555555555" }, { url: IMG2, jobId: "99999999-2222-3333-4444-555555555555" }] },
    }
    const spec = nodeFor("/v1/image-collage", { imageUrls: [IMG, IMG2] })!
    const placed = placeFlowNode([earlier], "b", spec, spec.data as Record<string, unknown>)
    // The selected take comes from the node; the other one gets its own upload node.
    const sources = placed.upsertEdges.map((e) => e.source)
    expect(new Set(sources).size).toBe(placed.upsertEdges.length)
    expect(sources).toContain("a")
    const upload = placed.upsertNodes.find((n) => n.type === "upload-image")!
    expect(upload.data).toMatchObject({ url: IMG })
  })

  it("reads a node with no selected index as sending its newest take (the first)", () => {
    const IMG2 = "https://media.nodaro.ai/images/99999999-2222-3333-4444-555555555555.png"
    const earlier = {
      id: "a", type: "generate-image", position: { x: 520, y: 80 },
      data: { generatedResults: [{ url: IMG2 }, { url: IMG }] },
    }
    const newest = nodeFor("/v1/generate-video", { imageUrl: IMG2, prompt: "jump", provider: "grok-i2v" })!
    expect(placeFlowNode([earlier], "b", newest, newest.data as Record<string, unknown>).upsertEdges[0].source).toBe("a")
    const oldest = nodeFor("/v1/generate-video", { imageUrl: IMG, prompt: "jump", provider: "grok-i2v" })!
    expect(placeFlowNode([earlier], "c", oldest, oldest.data as Record<string, unknown>).upsertEdges[0].source).not.toBe("a")
  })

  it("points an upload node still showing an outside link at its stored copy, and leaves a changed one", () => {
    const outside = "https://example.com/cat.png"
    const spec = nodeFor("/v1/image-to-image", { imageUrl: outside, prompt: "night", provider: "nano-banana-edit" })!
    const { upsertNodes } = placeFlowNode([], "m1", spec, spec.data as Record<string, unknown>)
    const stored = new Map([[outside, { url: "https://media.nodaro.ai/uploads/cat.png", assetId: "asset-1", thumbnailUrl: null }]])
    const relinked = relinkImported(upsertNodes, stored)
    expect(relinked).toHaveLength(1)
    expect(relinked[0].data).toMatchObject({ url: "https://media.nodaro.ai/uploads/cat.png", r2Url: "https://media.nodaro.ai/uploads/cat.png", externalUrl: outside, assetId: "asset-1" })
    const changed = upsertNodes.map((n) => (n.type === "upload-image" ? { ...n, data: { ...n.data, url: "https://media.nodaro.ai/uploads/dog.png" } } : n))
    expect(relinkImported(changed, stored)).toEqual([])
  })

  it("makes an upload node for an input the flow does not hold, and reuses it", () => {
    const spec = nodeFor("/v1/image-to-image", { imageUrl: IMG, prompt: "night", provider: "nano-banana-edit" })!
    const first = placeFlowNode([], "m1", spec, spec.data as Record<string, unknown>)
    const upload = first.upsertNodes.find((n) => n.type === "upload-image")!
    expect(upload.data).toMatchObject({ url: IMG })
    // A job id is not an asset id: an upload node of a Nodaro result carries its URL only.
    expect(upload.data).not.toHaveProperty("assetId")
    const second = placeFlowNode(first.upsertNodes, "m2", spec, spec.data as Record<string, unknown>)
    expect(second.upsertNodes.map((n) => n.id)).toEqual(["m2"])
    expect(second.upsertEdges[0].source).toBe(upload.id)
  })

  it("never overwrites a node the user changed: a taken id gets a fresh one", () => {
    const spec = nodeFor("/v1/image-to-image", { imageUrl: IMG, prompt: "night", provider: "nano-banana-edit" })!
    const first = placeFlowNode([], "m1", spec, spec.data as Record<string, unknown>)
    const upload = first.upsertNodes.find((n) => n.type === "upload-image")!
    const edited = { ...upload, data: { ...upload.data, url: "https://media.nodaro.ai/uploads/other.png", r2Url: "x", generatedResults: [] } }
    const second = placeFlowNode([edited], "m2", spec, spec.data as Record<string, unknown>)
    const fresh = second.upsertNodes.find((n) => n.type === "upload-image")!
    expect(fresh.id).toBe(`${upload.id}-2`)
    expect(second.upsertNodes.map((n) => n.id)).not.toContain(upload.id)
  })

  it("names the conversation in the node id, and reads it back", () => {
    const wf = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    expect(workflowIdOfFlowNode(flowNodeId(wf, "abc123def456"))).toBe(wf)
    expect(workflowIdOfFlowNode("node_123")).toBeNull()
    expect(workflowIdOfFlowNode(null)).toBeNull()
  })

  it("wires a node with several outputs from the one for the media kind", () => {
    expect(outputHandleOf("pitch-tempo", "video")).toBe("video-out")
    expect(outputHandleOf("voice-changer", "video")).toBe("video")
    expect(outputHandleOf("voice-changer", "audio")).toBe("audio")
    expect(outputHandleOf("generate-image", "image")).toBe("image")
  })

  it("reads the job id out of a Nodaro media URL", () => {
    expect(jobIdOfMediaUrl(IMG)).toBe("11111111-2222-3333-4444-555555555555")
    expect(jobIdOfMediaUrl("https://example.com/cat.png")).toBeNull()
    expect(jobIdOfMediaUrl("not a url")).toBeNull()
  })
})

describe("hydratedNodeData", () => {
  const job = {
    id: "j1", user_id: "u", workflow_id: "w", node_id: "n", source: "mcp",
    status: "completed", output_data: { imageUrl: IMG }, error_message: null, completed_at: "2026-10-25T00:00:00Z",
  }
  const node = { id: "n", type: "generate-image", data: { prompt: "x", executionStatus: "running", currentJobId: "j1" } }

  it("lands the result the way the editor does", () => {
    expect(hydratedNodeData(node, job)).toEqual({
      prompt: "x",
      executionStatus: "completed",
      generatedImageUrl: IMG,
      generatedResults: [{ url: IMG, timestamp: "2026-10-25T00:00:00Z", jobId: "j1" }],
      activeResultIndex: 0,
    })
  })

  it("marks a failure", () => {
    expect(hydratedNodeData(node, { ...job, status: "failed", error_message: "blocked" })).toMatchObject({ executionStatus: "failed", errorMessage: "blocked" })
    expect(hydratedNodeData(node, { ...job, status: "cancelled" })).toMatchObject({ executionStatus: "failed" })
  })

  it("ends the run of a job that finished with no media", () => {
    expect(hydratedNodeData(node, { ...job, output_data: {} })).toEqual({ prompt: "x", executionStatus: "completed" })
  })

  it("touches nothing for another job, or one still running", () => {
    expect(hydratedNodeData({ ...node, data: { ...node.data, currentJobId: "other" } }, job)).toBeNull()
    expect(hydratedNodeData(node, { ...job, status: "processing" })).toBeNull()
  })
})

describe("attachUserRequest", () => {
  async function call(tool: string, args: Record<string, unknown>) {
    const session = newSession({ userId: "u", scopes: [], clientName: "Claude" })
    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } })
    attachUserRequest(server, session, new Set(["mapped"]))
    let seen: unknown
    server.registerTool("mapped", { description: "m", inputSchema: { prompt: z.string() } }, async (a) => {
      seen = a
      return { content: [{ type: "text", text: "ok" }] }
    })
    server.registerTool("other", { description: "o", inputSchema: { prompt: z.string() } }, async (a) => {
      seen = a
      return { content: [{ type: "text", text: "ok" }] }
    })
    const invoker = createMcpInvoker(server)
    const tools = await invoker.listTools()
    await invoker.callTool(tool, args)
    return { session, seen, tools }
  }

  it("adds the argument to the listed tools only", async () => {
    const { tools } = await call("mapped", { prompt: "p" })
    const schemaOf = (name: string) => JSON.stringify(tools.find((t) => t.name === name)?.inputSchema)
    expect(schemaOf("mapped")).toContain("user_request")
    expect(schemaOf("other")).not.toContain("user_request")
  })

  it("keeps the words on the session and hides them from the tool", async () => {
    const { session, seen } = await call("mapped", { prompt: "p", user_request: "  make me a dolphin  " })
    expect(session.userRequest).toBe("make me a dolphin")
    expect(session.currentTool).toBe("mapped")
    expect(seen).toEqual({ prompt: "p" })
  })

  it("names the tool on every call", async () => {
    const { session } = await call("other", { prompt: "p" })
    expect(session.currentTool).toBe("other")
    expect(session.userRequest).toBeUndefined()
  })
})
