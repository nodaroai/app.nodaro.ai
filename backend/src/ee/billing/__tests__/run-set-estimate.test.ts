import { describe, it, expect, vi } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => false,
}))

/**
 * A run of a SUBSET (Render final runs the render and its tail; every other
 * node is seeded) is priced over its own nodes only, with the whole graph as
 * the context a price reads (a wired setting, a caption source). An agent's
 * Render final quote is this estimate (decided 2026-10-06).
 */
describe("estimating a run of a subset", () => {
  const nodes = [
    { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
    { id: "cut", type: "apply-edl", data: { quality: "final" } },
    { id: "img2", type: "generate-image", data: { provider: "nano-banana" } },
  ]
  const edges = [
    { source: "img", target: "cut" },
    { source: "cut", target: "img2" },
  ]

  it("prices only the nodes the run executes", () => {
    const whole = CreditsService.estimateWorkflowBaseCredits(nodes, edges)
    const subset = CreditsService.estimateWorkflowBaseCredits(nodes, edges, { runNodeIds: new Set(["cut", "img2"]) })
    expect(whole - subset).toBe(STATIC_CREDIT_COSTS["nano-banana"])
  })

  it("an empty subset prices nothing", () => {
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges, { runNodeIds: new Set() })).toBe(0)
  })
})
