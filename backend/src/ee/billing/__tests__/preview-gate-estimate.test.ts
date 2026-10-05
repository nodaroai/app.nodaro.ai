import { describe, it, expect, vi, beforeEach } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS, estimateWorkflowCredits, estimateWorkflowListingCredits } from "../credits.js"

const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))
// No credit system: the async estimators price at the static base, with no
// price-table read, so they compare with `estimateWorkflowBaseCredits`.
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => false,
}))
beforeEach(() => {
  flag.on = true
})

/**
 * A run stops at a Preview render (decided 2026-10-04): what follows it runs
 * only after Render final, so the estimate of a RUN quotes it up to the
 * preview. The price stored at publish — an app's or template's listing — is
 * not a run estimate and counts the whole graph (decided 2026-10-05).
 */
const nodes = (quality: "proxy" | "final") => [
  { id: "cut", type: "apply-edl", data: { quality } },
  { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
]
const edges = [{ source: "cut", target: "img" }]

describe("the workflow estimate under the preview stop rule", () => {
  it("leaves out every node a Preview render gates", () => {
    const gated = CreditsService.estimateWorkflowBaseCredits(nodes("proxy"), edges)
    const alone = CreditsService.estimateWorkflowBaseCredits([nodes("proxy")[0]], [])
    expect(gated).toBe(alone)
  })

  it("a Final render's tail is quoted", () => {
    const full = CreditsService.estimateWorkflowBaseCredits(nodes("final"), edges)
    const render = CreditsService.estimateWorkflowBaseCredits([nodes("final")[0]], [])
    expect(full).toBeGreaterThan(render)
    expect(full - render).toBe(STATIC_CREDIT_COSTS["nano-banana"])
  })

  it("follows Group membership into the closure, as the editor's estimate does", () => {
    // cut(proxy) → cap, which sits in Group grp; grp → img. The editor gates
    // cap, grp and img: the backend estimate must not still price img.
    const grouped = [
      { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cap", type: "add-captions", data: {}, parentId: "grp" },
      { id: "grp", type: "group", data: {} },
      { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
    ]
    const groupedEdges = [
      { source: "cut", target: "cap" },
      { source: "grp", target: "img" },
    ]
    const quoted = CreditsService.estimateWorkflowBaseCredits(grouped, groupedEdges)
    const render = CreditsService.estimateWorkflowBaseCredits([grouped[0]], [])
    expect(quoted).toBe(render)
  })

  it("without edges it cannot see the closure, so it never under-quotes", () => {
    const blind = CreditsService.estimateWorkflowBaseCredits(nodes("proxy"))
    expect(blind).toBeGreaterThan(CreditsService.estimateWorkflowBaseCredits(nodes("proxy"), edges))
  })
})

describe("the listing estimate (stored at publish) ignores the stop rule", () => {
  const whole = () => CreditsService.estimateWorkflowBaseCredits(nodes("proxy"))
  const render = () => CreditsService.estimateWorkflowBaseCredits([nodes("proxy")[0]], [])

  it("with the flag on, the listing counts the gated tail", async () => {
    const listing = await estimateWorkflowListingCredits(nodes("proxy"), edges)
    expect(listing).toBe(whole())
    expect(listing - render()).toBe(STATIC_CREDIT_COSTS["nano-banana"])
  })

  it("with the flag on, a live run estimate still leaves the gated tail out", async () => {
    expect(await estimateWorkflowCredits(nodes("proxy"), edges)).toBe(render())
  })

  it("the base estimator takes the same whole-graph scope", () => {
    expect(CreditsService.estimateWorkflowBaseCredits(nodes("proxy"), edges, { scope: "whole-graph" })).toBe(whole())
    expect(CreditsService.estimateWorkflowBaseCredits(nodes("proxy"), edges, { scope: "run" })).toBe(render())
  })

  it("with the flag off, the listing and the run estimate agree", async () => {
    flag.on = false
    expect(await estimateWorkflowListingCredits(nodes("proxy"), edges)).toBe(whole())
    expect(await estimateWorkflowCredits(nodes("proxy"), edges)).toBe(whole())
  })
})

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): dev before the rule", () => {
  it("quotes the whole graph", () => {
    flag.on = false
    const quoted = CreditsService.estimateWorkflowBaseCredits(nodes("proxy"), edges)
    const render = CreditsService.estimateWorkflowBaseCredits([nodes("proxy")[0]], [])
    expect(quoted - render).toBe(STATIC_CREDIT_COSTS["nano-banana"])
    expect(quoted).toBe(CreditsService.estimateWorkflowBaseCredits(nodes("proxy")))
  })
})

describe("guard: a render with a Preview price is a render the run stops at", () => {
  it("the `:proxy` credit ids and PREVIEW_RENDER_NODE_TYPES name the same node types, both ways", async () => {
    const { PREVIEW_RENDER_NODE_TYPES } = await import("@nodaro/shared")
    const proxyTypes = Object.keys(STATIC_CREDIT_COSTS)
      .filter((id) => id.endsWith(":proxy"))
      .map((id) => id.slice(0, -":proxy".length))
      .sort()
    // A node priced as a Preview that the stop rule does not know would let
    // its tail consume the preview; a stop-rule render with no Preview price
    // would bill its preview as a final.
    expect(proxyTypes).toEqual([...PREVIEW_RENDER_NODE_TYPES].sort())
  })
})
