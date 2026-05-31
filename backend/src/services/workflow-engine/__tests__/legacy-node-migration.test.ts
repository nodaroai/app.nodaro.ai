import { describe, it, expect } from "vitest"
import { migrateLegacyNodeType } from "../execution-graph.js"
import type { SimpleNode } from "../types.js"

/**
 * Guard for the shared legacy node-type migration used by BOTH the orchestrator
 * (top-level runs) and the sub-workflow handler (nested runs). Before this
 * helper existed the logic was copy-pasted in both places and could drift.
 */
const makeNode = (
  type: string,
  data: Record<string, unknown> = {},
  extra: Partial<SimpleNode> = {},
): SimpleNode => ({ id: "n1", type, data, ...extra }) as unknown as SimpleNode

describe("migrateLegacyNodeType", () => {
  it("maps edit-image + nano-banana-edit -> modify-image", () => {
    expect(migrateLegacyNodeType(makeNode("edit-image", { provider: "nano-banana-edit" })).type).toBe("modify-image")
  })

  it("maps edit-image + recraft-remove-bg -> remove-background", () => {
    expect(migrateLegacyNodeType(makeNode("edit-image", { provider: "recraft-remove-bg" })).type).toBe("remove-background")
  })

  it("maps edit-image with any other / no provider -> upscale-image", () => {
    expect(migrateLegacyNodeType(makeNode("edit-image", { provider: "topaz" })).type).toBe("upscale-image")
    expect(migrateLegacyNodeType(makeNode("edit-image")).type).toBe("upscale-image")
  })

  it("maps image-to-image -> modify-image", () => {
    expect(migrateLegacyNodeType(makeNode("image-to-image")).type).toBe("modify-image")
  })

  it("maps OLD collect (no order[]) -> reduce", () => {
    expect(migrateLegacyNodeType(makeNode("collect")).type).toBe("reduce")
  })

  it("leaves NEW collect (with order[]) unchanged", () => {
    expect(migrateLegacyNodeType(makeNode("collect", { order: ["a", "b"] })).type).toBe("collect")
  })

  it("leaves unrelated node types unchanged", () => {
    expect(migrateLegacyNodeType(makeNode("generate-image")).type).toBe("generate-image")
  })

  it("preserves parentId and other data fields", () => {
    const out = migrateLegacyNodeType(
      makeNode("edit-image", { provider: "nano-banana-edit", foo: 1 }, { parentId: "grp1" }),
    )
    expect(out.parentId).toBe("grp1")
    expect((out.data as Record<string, unknown>).foo).toBe(1)
    expect(out.id).toBe("n1")
  })
})
