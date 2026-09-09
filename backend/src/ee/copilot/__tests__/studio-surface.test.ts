/**
 * The studio surface's bundle, as a set of sets.
 *
 * The copilot is ONE agent with two surfaces. Everything that differs between
 * them is resolved once per turn from this bundle, so the tests that matter are
 * about the sets themselves: what the model may see, what the server is built
 * with, and which id is pinned on every call.
 *
 * The allowlist is DERIVED from the studio tool family's own name list — a
 * nineteenth tool joins the surface without an edit here, and the partition
 * test in `studio-tool-surface.test.ts` is what refuses to let it arrive
 * unclassified.
 */
import { describe, expect, it } from "vitest"
import { STUDIO_PRODUCTION_TOOL_NAMES } from "../../../lib/mcp/tools/_studio-helpers.js"
import { COPILOT_SCOPES, MCP_TOOL_ALLOWLIST, NATIVE_TOOLS } from "../constants.js"
import {
  copilotSurface,
  STUDIO_CLIENT_NAME,
  STUDIO_COMPUTED_ARGS,
  STUDIO_EDIT_TOOL,
  STUDIO_FORCED_MCP_ARGS,
  STUDIO_MCP_TOOL_ALLOWLIST,
  STUDIO_NATIVE_TOOLS,
  STUDIO_PROPOSE_WITHOUT_MARK,
  STUDIO_READ_TOOLS,
  STUDIO_TOOL_SURFACE,
} from "../surfaces.js"

const PRODUCTION_LEVEL = ["create_studio_production", "list_studio_productions"]
const KEPT_CANVAS_READS = ["list_models", "list_voices", "get_job", "check_balance"]

describe("the studio allowlist is the family, minus two, plus four", () => {
  it("is exactly that expression — not a hand-typed list", () => {
    const expected = new Set([
      ...STUDIO_PRODUCTION_TOOL_NAMES.filter((name) => !PRODUCTION_LEVEL.includes(name)),
      ...KEPT_CANVAS_READS,
    ])
    expect([...STUDIO_MCP_TOOL_ALLOWLIST].sort()).toEqual([...expected].sort())
  })

  it("carries every tool of the family that is not production-level", () => {
    for (const name of STUDIO_PRODUCTION_TOOL_NAMES) {
      expect(STUDIO_MCP_TOOL_ALLOWLIST.has(name)).toBe(PRODUCTION_LEVEL.includes(name) === false)
    }
  })

  it("keeps no canvas tool beyond the four reads", () => {
    for (const name of MCP_TOOL_ALLOWLIST) {
      if (KEPT_CANVAS_READS.includes(name)) continue
      expect(STUDIO_MCP_TOOL_ALLOWLIST.has(name)).toBe(false)
    }
  })
})

describe("the natives", () => {
  it("are the memory tool and the export wrapper, and nothing else", () => {
    expect([...Object.values(STUDIO_NATIVE_TOOLS)].sort()).toEqual(
      ["export_studio_production", NATIVE_TOOLS.remember].sort(),
    )
  })

  it("include no canvas native — the canvas ones are about nodes and runs", () => {
    const studio = copilotSurface("studio")
    for (const native of Object.values(NATIVE_TOOLS)) {
      if (native === NATIVE_TOOLS.remember) continue
      expect(studio.nativeTools.has(native)).toBe(false)
      expect(studio.toolSurface.has(native)).toBe(false)
    }
  })
})

describe("the model-visible surface", () => {
  it("is the allowlist union the natives", () => {
    const expected = new Set([...STUDIO_MCP_TOOL_ALLOWLIST, ...Object.values(STUDIO_NATIVE_TOOLS)])
    expect([...STUDIO_TOOL_SURFACE].sort()).toEqual([...expected].sort())
    expect([...copilotSurface("studio").toolSurface].sort()).toEqual([...expected].sort())
  })

  it("names every classification set inside itself", () => {
    for (const name of [...STUDIO_READ_TOOLS, ...STUDIO_PROPOSE_WITHOUT_MARK, STUDIO_EDIT_TOOL]) {
      expect(STUDIO_TOOL_SURFACE.has(name)).toBe(true)
    }
  })
})

describe("the scopes", () => {
  it("add the write scope the studio routes need, and keep the canvas ones", () => {
    const studio = copilotSurface("studio")
    for (const scope of COPILOT_SCOPES) expect(studio.scopes).toContain(scope)
    expect(studio.scopes).toContain("workflows:write")
  })

  it("leave the canvas surface exactly as it was — no write scope there", () => {
    const canvas = copilotSurface("workflow")
    expect([...canvas.scopes]).toEqual([...COPILOT_SCOPES])
    expect(canvas.scopes).not.toContain("workflows:write")
  })
})

describe("the client name", () => {
  it("says which surface made the request", () => {
    expect(copilotSurface("workflow").clientName).toBe("copilot")
    expect(copilotSurface("studio").clientName).toBe(STUDIO_CLIENT_NAME)
    expect(STUDIO_CLIENT_NAME).toBe("studio-copilot")
  })
})

describe("the pinned id", () => {
  it("is the production on the studio surface and the workflow on the canvas", () => {
    expect(copilotSurface("studio").forcedIdArg("prod-1")).toEqual({ production_id: "prod-1" })
    expect(copilotSurface("workflow").forcedIdArg("wf-1")).toEqual({ workflow_id: "wf-1" })
  })

  it("pins ONE id key per surface — the studio never also sends the canvas one", () => {
    expect(Object.keys(copilotSurface("studio").forcedIdArg("prod-1"))).toEqual(["production_id"])
  })
})

describe("the pinned and computed arguments", () => {
  it("pins the read that must not land finished work", () => {
    expect(STUDIO_FORCED_MCP_ARGS.get_studio_production).toEqual({ reconcile: false })
    expect(copilotSurface("studio").forcedArgs.get_studio_production).toEqual({ reconcile: false })
  })

  it("computes the arguments the model must never choose", () => {
    expect(STUDIO_COMPUTED_ARGS.edit_studio_production).toEqual(
      expect.arrayContaining(["dry_run", "expected_version", "strict"]),
    )
    expect(STUDIO_COMPUTED_ARGS.get_studio_production).toEqual(["reconcile"])
    expect(STUDIO_COMPUTED_ARGS.describe_studio_production).toEqual(["mode"])
    expect(STUDIO_COMPUTED_ARGS.score_studio_production).toEqual(["model"])
  })

  it("leaves the canvas surface's pinned arguments alone", () => {
    const canvas = copilotSurface("workflow")
    expect(canvas.forcedArgs.browse_gallery).toEqual({ scope: "mine" })
    expect(canvas.computedArgs).toEqual({})
  })
})
