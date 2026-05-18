import { describe, it, expect } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import {
  registerSkillLoaders,
  WORKFLOW_EDITOR_TOOL_DESCRIPTION,
  GET_NODE_SKILL_TOOL_DESCRIPTION,
} from "../skill-loaders.js"

function emptySession() {
  return newSession({
    userId: "u-skill",
    scopes: [] as Scope[],
    clientName: "Claude",
  })
}

describe("skill-loaders MCP tools", () => {
  it("registers start_workflow_editor regardless of scope", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("start_workflow_editor")
  })

  it("registers get_node_skill regardless of scope", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("get_node_skill")
  })

  it("start_workflow_editor description mentions workflow editing key phrases", () => {
    const triggers = ["workflow", "edit", "JSON", "update_workflow_json", "node"]
    for (const phrase of triggers) {
      expect(
        WORKFLOW_EDITOR_TOOL_DESCRIPTION.toLowerCase(),
        `description must mention "${phrase}" for activation`,
      ).toContain(phrase.toLowerCase())
    }
  })

  it("get_node_skill description mentions per-node schema", () => {
    const triggers = ["node_type", "schema", "data shape"]
    for (const phrase of triggers) {
      expect(
        GET_NODE_SKILL_TOOL_DESCRIPTION.toLowerCase(),
        `description must mention "${phrase}"`,
      ).toContain(phrase.toLowerCase())
    }
  })

  it("start_workflow_editor returns workflow-editor.md content", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const result = await callTool(server, "start_workflow_editor", {})
    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("Nodaro Workflow Editor")
    expect(text).toContain("Workflow JSON shape")
    expect(text).toContain("update_workflow_json")
    expect(text.length).toBeGreaterThan(1000)
  })

  it("get_node_skill returns generate-image.md content for type=generate-image", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const result = await callTool(server, "get_node_skill", {
      node_type: "generate-image",
    })
    expect(result.isError).toBeUndefined()
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("generate-image")
    expect(text).toContain("generatedImageUrl")
    expect(text).toContain("executionStatus")
  })

  it("get_node_skill returns isError with a valid-types list for unknown type", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const result = await callTool(server, "get_node_skill", {
      node_type: "totally-fake-node-type",
    })
    expect(result.isError).toBe(true)
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("totally-fake-node-type")
    // Error message must enumerate valid types so Claude can self-correct
    expect(text).toContain("generate-image")
    expect(text).toContain("loop")
  })

  it("get_node_skill is idempotent across repeated invocations", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const r1 = await callTool(server, "get_node_skill", { node_type: "loop" })
    const r2 = await callTool(server, "get_node_skill", { node_type: "loop" })
    expect(r1.content[0]?.text).toBe(r2.content[0]?.text)
  })

  it("start_workflow_editor input schema is empty (no arguments)", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const tools = await listTools(server)
    const tool = tools.find((t) => t.name === "start_workflow_editor")
    expect(tool).toBeDefined()
    const schema = (tool as unknown as { inputSchema?: { required?: string[] } }).inputSchema
    if (schema?.required) {
      expect(schema.required).toEqual([])
    }
  })

  it("get_node_skill input schema requires node_type", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    const tools = await listTools(server)
    const tool = tools.find((t) => t.name === "get_node_skill")
    expect(tool).toBeDefined()
    const schema = (tool as unknown as {
      inputSchema?: { required?: string[]; properties?: Record<string, unknown> }
    }).inputSchema
    expect(schema?.properties).toHaveProperty("node_type")
    expect(schema?.required).toContain("node_type")
  })

  it("WORKFLOW_EDITOR_FALLBACK_CONTENT exists and is non-trivially-empty", async () => {
    const { WORKFLOW_EDITOR_FALLBACK_CONTENT } = await import("../skill-loaders.js")
    expect(WORKFLOW_EDITOR_FALLBACK_CONTENT.length).toBeGreaterThan(200)
    expect(WORKFLOW_EDITOR_FALLBACK_CONTENT).toContain("Nodaro Workflow Editor")
    expect(WORKFLOW_EDITOR_FALLBACK_CONTENT).toContain("get_node_skill")
  })

  it("get_node_skill rejects directory-traversal node_type", async () => {
    const server = buildServer()
    registerSkillLoaders(server, emptySession())
    // Zod regex blocks this at the schema layer — the tool returns an error
    const result = await callTool(server, "get_node_skill", {
      node_type: "../../CLAUDE",
    })
    expect(result.isError).toBe(true)
    const text = result.content[0]?.text ?? ""
    // The exact error format may be "Invalid arguments" from the SDK or
    // our own "No skill file found" message — either way, the response
    // MUST NOT contain content from outside backend/skills/.
    expect(text).not.toContain("Nodaro.ai")  // a string commonly in repo CLAUDE.md files
    expect(text).not.toContain("# Backend — Claude Code Reference")  // backend/CLAUDE.md
  })
})
