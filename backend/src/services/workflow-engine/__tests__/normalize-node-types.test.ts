import { describe, it, expect } from "vitest"
import { normalizeLegacyNodeTypes } from "../normalize-node-types.js"
import { getOutputNodes } from "@nodaro/shared"

const mk = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })

describe("normalizeLegacyNodeTypes", () => {
  it("rewrites loop → list", () => {
    expect(normalizeLegacyNodeTypes([mk("n", "loop", { columns: [] })])[0].type).toBe("list")
  })
  it("keeps existing image migrations (image-to-image → modify-image)", () => {
    expect(normalizeLegacyNodeTypes([mk("n", "image-to-image")])[0].type).toBe("modify-image")
  })
  it("maps edit-image by provider", () => {
    expect(normalizeLegacyNodeTypes([mk("n", "edit-image", { provider: "nano-banana-edit" })])[0].type).toBe("modify-image")
    expect(normalizeLegacyNodeTypes([mk("n", "edit-image", { provider: "recraft-remove-bg" })])[0].type).toBe("remove-background")
    expect(normalizeLegacyNodeTypes([mk("n", "edit-image", {})])[0].type).toBe("upscale-image")
  })
  it("maps old collect (no order[]) → reduce but leaves new collect", () => {
    expect(normalizeLegacyNodeTypes([mk("n", "collect", {})])[0].type).toBe("reduce")
    expect(normalizeLegacyNodeTypes([mk("n", "collect", { order: ["a"] })])[0].type).toBe("collect")
  })
  it("leaves unrelated node types untouched", () => {
    expect(normalizeLegacyNodeTypes([mk("n", "list", {})])[0].type).toBe("list")
    expect(normalizeLegacyNodeTypes([mk("n", "generate-image", {})])[0].type).toBe("generate-image")
  })
})

// ── code-review #5 ─────────────────────────────────────────────────────────
// The loop→list PR removed "loop" from `NON_OUTPUT_TYPES` (only "list" remains).
// `routes/api-tokens.ts` reads `workflow.nodes` raw and calls getInputNodes /
// getOutputNodes WITHOUT normalizing — so a raw, un-migrated `loop` node
// (presentationVisible, leaf) is misclassified as a workflow OUTPUT in the
// API/SDK schema. Normalizing loop→list BEFORE classification fixes it: `list`
// IS in NON_OUTPUT_TYPES and is correctly excluded. This guards the invariant
// the route now upholds.
describe("normalize-before-getOutputNodes (api-tokens raw-read invariant)", () => {
  const loopNode = {
    id: "lp1",
    type: "loop",
    data: {
      presentationVisible: true,
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["a"]],
    },
  }

  it("raw `loop` leaf is WRONGLY surfaced as an output without normalization (bug repro)", () => {
    // No outgoing edges → leaf. Curated mode keys off presentationVisible.
    const outputs = getOutputNodes([loopNode], [], true)
    expect(outputs.map((n) => n.id)).toContain("lp1")
  })

  it("normalized loop→list is NOT surfaced as an output (the fix)", () => {
    const normalized = normalizeLegacyNodeTypes([loopNode])
    const outputs = getOutputNodes(normalized, [], true)
    expect(outputs.map((n) => n.id)).not.toContain("lp1")
    // And the normalized node's type is `list`.
    expect(normalized[0].type).toBe("list")
  })
})
