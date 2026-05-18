import { describe, it, expect } from "vitest"
import { captureMcpToolSchemas } from "../../../scripts/lib/gen-skills/capture-mcp-schemas.js"

describe("captureMcpToolSchemas", () => {
  it("captures generate_image schema with prompt field", async () => {
    const schemas = await captureMcpToolSchemas()
    const gi = schemas.find((s) => s.name === "generate_image")
    expect(gi).toBeDefined()
    expect(gi!.inputSchema).toBeDefined()
    const fieldNames = Object.keys(gi!.inputSchema)
    expect(fieldNames).toContain("prompt")
  })

  it("captures animate_image and generate_music tools", async () => {
    const schemas = await captureMcpToolSchemas()
    expect(schemas.find((s) => s.name === "animate_image")).toBeDefined()
    expect(schemas.find((s) => s.name === "generate_music")).toBeDefined()
  })

  it("captures get_node_skill and start_workflow_editor (Phase A tools)", async () => {
    const schemas = await captureMcpToolSchemas()
    expect(schemas.find((s) => s.name === "get_node_skill")).toBeDefined()
    expect(schemas.find((s) => s.name === "start_workflow_editor")).toBeDefined()
  })

  it("returns at least 30 tools (the full registered set)", async () => {
    const schemas = await captureMcpToolSchemas()
    expect(schemas.length).toBeGreaterThanOrEqual(30)
  })
})
