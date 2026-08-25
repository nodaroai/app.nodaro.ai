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
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: false, workflowExecutionId: null }),
    ).toBe(true)
  })

  it("forces private when the surface disallows public, overriding the user", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ outputs: { allowPublic: false } })
    __resetSurfaceProfileCacheForTests()
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: false, workflowExecutionId: null }),
    ).toBe(false)
  })

  it("keeps every existing private-forcing condition (force_private / mcp / execution id)", () => {
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: true, mcpClient: false, workflowExecutionId: null }),
    ).toBe(false)
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: true, workflowExecutionId: null }),
    ).toBe(false)
    expect(
      resolveIsPublicOutput({ publicOutputs: false, forcePrivate: false, mcpClient: false, workflowExecutionId: null }),
    ).toBe(false)
    expect(
      resolveIsPublicOutput({ publicOutputs: true, forcePrivate: false, mcpClient: false, workflowExecutionId: "exec-1" }),
    ).toBe(false)
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
    })
    expect(isPublic).toBe(false)
  })
})
