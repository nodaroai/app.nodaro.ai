import { describe, it, expect, afterEach } from "vitest"
import { resolveIsPublicOutput, mcpClientForcesPrivate } from "../output-visibility.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("resolveIsPublicOutput — surface outputs.allowPublic switch", () => {
  it("keeps the user's public preference when the surface allows public (default)", () => {
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: false, workflowExecutionId: null, previewRender: false }),
    ).toBe(true)
  })

  it("forces private when the surface disallows public, overriding the user", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ outputs: { allowPublic: false } })
    __resetSurfaceProfileCacheForTests()
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: false, workflowExecutionId: null, previewRender: false }),
    ).toBe(false)
  })

  it("keeps every existing private-forcing condition (force_private / mcp / execution id)", () => {
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: true, mcpClient: false, workflowExecutionId: null, previewRender: false }),
    ).toBe(false)
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: true, workflowExecutionId: null, previewRender: false }),
    ).toBe(false)
    expect(
      resolveIsPublicOutput({ publicOutputs: false, forcePrivate: false, mcpClient: false, workflowExecutionId: null, previewRender: false }),
    ).toBe(false)
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: false, workflowExecutionId: "exec-1", previewRender: false }),
    ).toBe(false)
  })
})

// F1: a preview render (Apply EDL at proxy) is private on every lane, whatever
// the owner's public-outputs preference.
describe("resolveIsPublicOutput — a preview render", () => {
  it("is never public", () => {
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: false, workflowExecutionId: null, previewRender: true }),
    ).toBe(false)
  })

  it("both media workers pass previewRender explicitly (it is a required input)", async () => {
    const { readFileSync } = await import("node:fs")
    const { join, dirname } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const here = dirname(fileURLToPath(import.meta.url))
    for (const file of ["video-worker.ts", "render-worker.ts"]) {
      const src = readFileSync(join(here, "..", file), "utf8")
      const call = src.slice(src.indexOf("resolveIsPublicOutput({"))
      expect(call.slice(0, call.indexOf("})")), file).toMatch(/previewRender:/)
    }
  })
})

// BLOCKER 2 — jobs.mcp_client is a TEXT column holding the client NAME
// ("claude-ai"), never a boolean. Both media workers used `mcp_client === true`,
// which is ALWAYS false for a text value → direct-MCP output leaked to the PUBLIC
// gallery. The worker call sites now map the column through mcpClientForcesPrivate,
// which these cases pin (the pure resolveIsPublicOutput already handled a boolean).
describe("mcpClientForcesPrivate — the worker call-site coercion", () => {
  it("treats any non-empty client name as a private-forcing direct-MCP surface", () => {
    expect(mcpClientForcesPrivate("claude-ai")).toBe(true)
    expect(mcpClientForcesPrivate("cursor")).toBe(true)
  })

  it("leaves null / undefined / empty string public (no MCP client)", () => {
    expect(mcpClientForcesPrivate(null)).toBe(false)
    expect(mcpClientForcesPrivate(undefined)).toBe(false)
    expect(mcpClientForcesPrivate("")).toBe(false)
  })

  it("a row with mcp_client=\"claude-ai\" + default public_outputs resolves is_public=false", () => {
    // The exact leak: default preference is public, but the direct-MCP origin
    // must force it private. This is the row the old `=== true` compare let leak.
    const jobRecord = { mcp_client: "claude-ai" as unknown }
    const isPublic = resolveIsPublicOutput({
      publicOutputs: true,
      forcePrivate: false,
      mcpClient: mcpClientForcesPrivate(jobRecord.mcp_client),
      workflowExecutionId: null,
      previewRender: false,
    })
    expect(isPublic).toBe(false)
  })
})
