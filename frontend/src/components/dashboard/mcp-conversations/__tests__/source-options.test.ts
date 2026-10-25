import { describe, expect, it } from "vitest"
import { sourceOptions } from "../source-filter"
import { mcpClientLabel } from "@/lib/mcp-client-label"

describe("sourceOptions", () => {
  it("always offers the known clients, greyed out at zero, then any other the month has", () => {
    const options = sourceOptions([
      { client: "claude-code", label: "Claude Code", conversations: 3, connections: [{ clientName: "Claude Code (nodaro)", conversations: 3 }] },
      { client: "goose", label: "Goose", conversations: 1, connections: [] },
    ])
    expect(options.map((o) => [o.client, o.conversations])).toEqual([
      ["claude", 0],
      ["claude-code", 3],
      ["chatgpt", 0],
      ["codex", 0],
      ["cursor", 0],
      ["goose", 1],
    ])
  })
})

describe("mcpClientLabel", () => {
  it("shows the product, never the connection's own name", () => {
    expect(mcpClientLabel("claude-code", "Claude Code (nodaro)")).toBe("Claude Code")
    expect(mcpClientLabel("other", "Cursor (work)")).toBe("Cursor")
    expect(mcpClientLabel(undefined, undefined)).toBe("MCP")
  })
})
