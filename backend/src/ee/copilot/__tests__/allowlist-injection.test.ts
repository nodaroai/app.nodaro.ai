/**
 * Every allowlisted tool is called with arguments it never declared.
 *
 * `dispatchTool` appends `workflow_id` — and, for some tools, a pinned `scope`
 * — to EVERY allowlisted MCP call, after the model's own args, so the model
 * cannot retarget the workflow or reach the public gallery. That injection is
 * only safe because the tools tolerate a key they did not ask for.
 *
 * A tool whose schema refuses unknown properties would therefore fail on every
 * single call, and fail in the least visible way there is: allowlisted,
 * offered to the model, described in the prompt, and erroring every time it is
 * used. This sweeps the whole allowlist against the REAL registered schemas
 * rather than trusting that Zod's default happens to strip.
 */
import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import { COPILOT_SCOPES, FORCED_MCP_ARGS, MCP_TOOL_ALLOWLIST } from "../constants.js"
import { buildMcpServer } from "../../../lib/mcp/server.js"
import { createMcpInvoker } from "../../../lib/mcp/invoke.js"

/** Keys `dispatchTool` adds to a call the model did not put them in. */
const INJECTED = ["workflow_id", ...new Set(Object.values(FORCED_MCP_ARGS).flatMap((a) => Object.keys(a)))]

interface JsonSchema {
  properties?: Record<string, { type?: unknown; enum?: unknown }>
  additionalProperties?: unknown
  required?: string[]
}

const tools = await (async () => {
  const server = await buildMcpServer({
    userId: "u1",
    scopes: [...COPILOT_SCOPES],
    clientName: "nodaro-copilot",
    fastify: Fastify(),
  })
  const listed = await createMcpInvoker(server).listTools()
  return new Map(listed.map((t) => [t.name, (t.inputSchema ?? {}) as JsonSchema]))
})()

const allowlisted = [...MCP_TOOL_ALLOWLIST].filter((name) => tools.has(name))

describe("injected arguments reach every allowlisted tool", () => {
  it("the sweep found the allowlist on the real server", () => {
    // A lookup that matched nothing would make every case below vacuous.
    expect(allowlisted.length).toBe(MCP_TOOL_ALLOWLIST.size)
  })

  it.each(allowlisted)("%s accepts a key it never declared", (name) => {
    const schema = tools.get(name)!
    // `additionalProperties: false` is the shape that would reject the
    // injection. Anything else — absent, true, a schema — accepts or strips it.
    expect(schema.additionalProperties, `${name} refuses unknown properties`).not.toBe(false)
  })

  it.each(allowlisted)("%s does not declare an injected key as something else", (name) => {
    const schema = tools.get(name)!
    for (const key of INJECTED) {
      const declared = schema.properties?.[key]
      if (!declared) continue
      // A tool that declares `workflow_id` itself is fine — the injected value
      // overwrites the model's, which is the point. It must be a string, or the
      // pinned value fails that tool's own validation on every call.
      expect(declared.type, `${name} declares ${key} as ${String(declared.type)}`).toBe("string")
    }
  })

  it.each(Object.keys(FORCED_MCP_ARGS))("%s accepts the value pinned for it", (name) => {
    // A pinned value that is not in the tool's own enum would fail validation
    // every call — the pin has to be a value the tool actually takes.
    const schema = tools.get(name)
    expect(schema, `${name} is pinned but not registered`).toBeDefined()
    for (const [key, value] of Object.entries(FORCED_MCP_ARGS[name]!)) {
      const declared = schema!.properties?.[key]
      if (!Array.isArray(declared?.enum)) continue
      expect(declared.enum, `${name}.${key} cannot be ${String(value)}`).toContain(value)
    }
  })
})
