import { describe, it, expect } from "vitest"
import {
  renderNodeDataShapeBlock,
  renderMcpCallBlock,
  renderExampleBlock,
  renderWorkflowEditorCatalog,
} from "../../../scripts/lib/gen-skills/render-skill.js"
import type {
  NodeDef,
  InterfaceShape,
} from "../../../scripts/lib/gen-skills/parse-node-definitions.js"
import type { CapturedSchema } from "../../../scripts/lib/gen-skills/capture-mcp-schemas.js"

const SAMPLE_DEF: NodeDef = {
  type: "generate-image",
  label: "Generate Image",
  category: "ai",
  creditCost: 5,
  inputs: ["in"],
  outputs: ["image"],
  defaultData: {
    label: "Generate Image",
    prompt: "",
    provider: "nano-banana-pro",
  },
}

const SAMPLE_SHAPE: InterfaceShape = {
  name: "GenerateImageData",
  fields: [
    { name: "label", type: "string", optional: false },
    { name: "prompt", type: "string", optional: false },
    { name: "provider", type: '"flux" | "nano-banana-pro"', optional: false },
    { name: "executionStatus", type: "string", optional: true },
    { name: "generatedImageUrl", type: "string", optional: true },
  ],
}

const SAMPLE_SCHEMA: CapturedSchema = {
  name: "generate_image",
  inputSchema: { prompt: {}, provider: {}, aspectRatio: {} },
  config: { description: "Generates an image" },
}

describe("renderNodeDataShapeBlock", () => {
  it("includes type, category, credit cost, handles", () => {
    const out = renderNodeDataShapeBlock(SAMPLE_DEF, SAMPLE_SHAPE)
    expect(out).toContain("**Type:** `generate-image`")
    expect(out).toContain("**Category:** ai")
    expect(out).toContain("**Credit cost:** 5")
    expect(out).toContain("Inputs")
    expect(out).toContain("in")
    expect(out).toContain("Outputs")
    expect(out).toContain("image")
  })

  it("lists required fields with their types and optional fields separately", () => {
    const out = renderNodeDataShapeBlock(SAMPLE_DEF, SAMPLE_SHAPE)
    expect(out).toContain("prompt: string")
    expect(out).toContain('provider: "flux" | "nano-banana-pro"')
    expect(out).toContain("executionStatus")
    expect(out).toContain("generatedImageUrl")
  })

  it("renders default data as JSON", () => {
    const out = renderNodeDataShapeBlock(SAMPLE_DEF, SAMPLE_SHAPE)
    expect(out).toContain("Default data")
    expect(out).toContain('"label": "Generate Image"')
    expect(out).toContain('"provider": "nano-banana-pro"')
  })

  it("omits empty defaultData gracefully", () => {
    const def: NodeDef = { ...SAMPLE_DEF, defaultData: {} }
    const out = renderNodeDataShapeBlock(def, SAMPLE_SHAPE)
    expect(out).toContain("Default data")
    expect(out).toContain("{}")
  })

  it("handles undefined InterfaceShape without throwing", () => {
    const out = renderNodeDataShapeBlock(SAMPLE_DEF, undefined)
    expect(out).toContain("**Type:** `generate-image`")
  })
})

describe("renderMcpCallBlock", () => {
  it("emits a description line referencing the MCP tool name", () => {
    const out = renderMcpCallBlock("generate_image", SAMPLE_SCHEMA)
    expect(out).toContain("MCP tool")
    expect(out).toContain("generate_image")
  })

  it("lists schema field names", () => {
    const out = renderMcpCallBlock("generate_image", SAMPLE_SCHEMA)
    expect(out).toContain("prompt")
    expect(out).toContain("provider")
    expect(out).toContain("aspectRatio")
  })

  it("returns empty string when no MCP tool matches", () => {
    const out = renderMcpCallBlock("nonexistent_tool", undefined)
    expect(out).toBe("")
  })
})

describe("renderExampleBlock", () => {
  it("produces a JSON example with the defaults merged in", () => {
    const out = renderExampleBlock(SAMPLE_DEF)
    expect(out).toContain('"type": "generate-image"')
    expect(out).toContain('"position"')
    expect(out).toContain('"data"')
    expect(out).toContain('"prompt"')
  })
})

describe("renderWorkflowEditorCatalog", () => {
  it("renders one line per node type sorted alphabetically", () => {
    const defs: NodeDef[] = [
      { ...SAMPLE_DEF, type: "loop", label: "Table" },
      { ...SAMPLE_DEF, type: "generate-image", label: "Generate Image" },
      { ...SAMPLE_DEF, type: "text-prompt", label: "Text Prompt" },
    ]
    const out = renderWorkflowEditorCatalog(defs)
    const lines = out.split("\n").filter((l) => l.startsWith("- `"))
    expect(lines[0]).toContain("generate-image")
    expect(lines[1]).toContain("loop")
    expect(lines[2]).toContain("text-prompt")
  })
})
