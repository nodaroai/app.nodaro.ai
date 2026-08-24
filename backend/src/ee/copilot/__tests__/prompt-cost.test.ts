/**
 * What the tool surface costs, per turn, forever.
 *
 * Tool definitions sit in the cached prompt prefix ahead of the system block,
 * so every allowlisted tool is paid for on EVERY turn of every thread — cheaply
 * on a cache read, but paid. Twelve arrived at once in this PR and nobody had
 * measured them, so this pins the size and fails loudly if the surface doubles
 * again without a decision.
 *
 * The number is a budget, not a fact about today: it exists so the next person
 * adding a tool family sees the cost rather than discovering it in a bill.
 */
import { describe, expect, it, vi } from "vitest"
import { buildToolDefinitions } from "../tools/registry.js"
import { MCP_TOOL_ALLOWLIST } from "../constants.js"
import type { McpInvoker, McpToolDef } from "../../../lib/mcp/invoke.js"

/**
 * A schema the size of a real one. The allowlisted tools are list/get/browse
 * shapes with two or three scalar arguments and a described enum or two.
 */
function realisticTool(name: string): McpToolDef {
  return {
    name,
    description:
      `List the ${name} the caller has saved — returns a summary per row with the name, ` +
      `description, main image and how many variant assets it has, newest first. Use search ` +
      `when the user named one; call the detail tool for its individual asset URLs.`,
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description:
            "Case-insensitive substring of the name. Use this when the user named one — do not page through the list hoping to find it.",
        },
        limit: { type: "number", description: "Max to return (default 50, max 100)." },
      },
      additionalProperties: false,
    },
  }
}

function invokerFor(names: string[]): McpInvoker {
  return {
    listTools: async () => names.map(realisticTool),
    callTool: vi.fn(),
    close: async () => undefined,
  }
}

const bytes = async (names: string[]) =>
  JSON.stringify(await buildToolDefinitions(invokerFor(names))).length

describe("the tool surface's prompt cost", () => {
  it("stays inside the per-turn budget", async () => {
    const size = await bytes([...MCP_TOOL_ALLOWLIST])

    // ~4 chars/token: this is roughly 4k tokens of prefix, read from cache on
    // every turn after the first. Raise it deliberately, with a note saying
    // what was added and why it earns its place — do not nudge it to green.
    expect(size).toBeLessThan(24_000)
  })

  it("is dominated by the ALLOWLIST, not the four native tools", async () => {
    // Measured, because the opposite was the intuitive guess and it is wrong:
    // the four hand-written native schemas are ~3.6KB, the allowlisted MCP
    // tools ~15KB. So the lever on prompt cost is which tools are allowlisted,
    // not how verbose `edit_workflow`'s schema is — worth knowing before
    // someone optimises the wrong half.
    const nativeOnly = await bytes([])
    const full = await bytes([...MCP_TOOL_ALLOWLIST])
    expect(full - nativeOnly).toBeGreaterThan(nativeOnly * 2)
  })

  it("keeps the tool count in a range a model can actually choose from", async () => {
    // The cost that is not measured in tokens: selection quality. A model
    // picking from 25 tools picks worse than one picking from 14, and this
    // PR moved it a long way in one go. If this needs raising again, the
    // answer is probably a second thread mode with a narrower surface — not
    // a bigger number here.
    expect(MCP_TOOL_ALLOWLIST.size).toBeLessThanOrEqual(28)
  })

  it("orders tools by name, so the cached prefix is byte-stable", async () => {
    // The prefix is only cacheable if it is identical run to run and replica to
    // replica. `listTools` order is not guaranteed; the sort is what makes it
    // deterministic, and a cache miss on every turn is a real bill.
    const forward = await buildToolDefinitions(invokerFor([...MCP_TOOL_ALLOWLIST]))
    const reversed = await buildToolDefinitions(invokerFor([...MCP_TOOL_ALLOWLIST].reverse()))
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
  })
})
