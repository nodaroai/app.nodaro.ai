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

  it("with the flag on, the listing's preview part counts the gated tail", async () => {
    const { preview } = await estimateWorkflowListingCredits(nodes("proxy"), edges, { publishType: "app" })
    expect(preview).toBe(whole())
    expect(preview - render()).toBe(STATIC_CREDIT_COSTS["nano-banana"])
  })

  it("with the flag on, a live run estimate still leaves the gated tail out", async () => {
    expect(await estimateWorkflowCredits(nodes("proxy"), edges)).toBe(render())
  })

  it("the base estimator takes the same whole-graph scope", () => {
    expect(CreditsService.estimateWorkflowBaseCredits(nodes("proxy"), edges, { scope: "whole-graph" })).toBe(whole())
    expect(CreditsService.estimateWorkflowBaseCredits(nodes("proxy"), edges, { scope: "run" })).toBe(render())
  })

  it("with the flag off, the listing's preview part and the run estimate agree", async () => {
    flag.on = false
    expect((await estimateWorkflowListingCredits(nodes("proxy"), edges, { publishType: "app" })).preview).toBe(whole())
    expect(await estimateWorkflowCredits(nodes("proxy"), edges)).toBe(whole())
  })
})

/**
 * A published app's listing (decided 2026-10-06): the PREVIEW part — the whole
 * graph, each render at its saved Preview, which earns the creator's fee — PLUS
 * each Render final — the render at Final and what follows it — which does
 * not. It never under-quotes: with the flag off an app run executes the whole
 * graph at Preview (fee on all of it), and staging and production share one
 * database, so the listing cannot follow the flag. With the flag on it
 * over-quotes by the tail a run leaves for its final (accepted; revisit when
 * production turns the flag on). Whatever the flag says.
 */
describe("the app listing estimate: the whole graph at Preview plus each Render final", () => {
  const base = (ns: Array<{ id: string; type: string; data: Record<string, unknown> }>) => CreditsService.estimateWorkflowBaseCredits(ns, [])
  const split = (ns: Parameters<typeof estimateWorkflowListingCredits>[0], es: Parameters<typeof estimateWorkflowListingCredits>[1]) =>
    estimateWorkflowListingCredits(ns, es, { publishType: "app" })

  it.each([true, false])("a Preview render (flag %s): the preview part is the whole graph; the final renders it at Final, then the tail", async (on) => {
    flag.on = on
    const { preview, final } = await split(nodes("proxy"), edges)
    expect(preview).toBe(base([nodes("proxy")[0]]) + STATIC_CREDIT_COSTS["nano-banana"]!)
    expect(final).toBe(base([nodes("final")[0]]) + STATIC_CREDIT_COSTS["nano-banana"])
  })

  it("never under-quotes a flag-off run: the preview part with any fee is at least what that run is charged with it", async () => {
    flag.on = false
    const { preview } = await split(nodes("proxy"), edges)
    // A flag-off app run executes every node at its saved settings; the fee applies to all of it.
    expect(preview).toBeGreaterThanOrEqual(await estimateWorkflowCredits(nodes("proxy"), edges))
  })

  it("a Final render: no final part — the whole graph is the preview part", async () => {
    const { preview, final } = await split(nodes("final"), edges)
    expect(final).toBe(0)
    expect(preview).toBe(CreditsService.estimateWorkflowBaseCredits(nodes("final")))
  })

  it("a template lists with the same function and the same figure", async () => {
    expect(await estimateWorkflowListingCredits(nodes("proxy"), edges, { publishType: "template" })).toEqual(await split(nodes("proxy"), edges))
  })

  it("a component never stops at a Preview: its final part is 0, its preview part the whole graph", async () => {
    const { preview, final } = await estimateWorkflowListingCredits(nodes("proxy"), edges, { publishType: "component" })
    expect(final).toBe(0)
    expect(preview).toBe(CreditsService.estimateWorkflowBaseCredits(nodes("proxy")))
  })

  it("the base-price listing (what a built-in template pins) is the same split", async () => {
    expect(CreditsService.estimateWorkflowBaseListing(nodes("proxy"), edges, "template")).toEqual(await split(nodes("proxy"), edges))
  })

  // Review round 3: the final part is an upper bound whatever the flag says.
  // With the flag off a final never stops at a later Preview, and the runner's
  // card offers Render final on every render whose take is Preview — so each
  // final runs its whole Render final set, and a node after two Preview
  // renders runs in both finals.
  it("a chain: each render's final is its whole Render final set, a later render at its saved Preview", async () => {
    const chain = [
      { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cap", type: "add-captions", data: {} },
      { id: "cut2", type: "apply-edl", data: { quality: "proxy" } },
      { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
    ]
    const chainEdges = [
      { source: "cut", target: "cap" },
      { source: "cap", target: "cut2" },
      { source: "cut2", target: "img" },
    ]
    const at = (q: string) => ({ id: "x", type: "apply-edl", data: { quality: q } })
    const captions = CreditsService.estimateWorkflowBaseCredits([chain[1]!], [])
    const { preview, final } = await split(chain, chainEdges)
    expect(preview).toBe(base([at("proxy")]) + captions + base([at("proxy")]) + STATIC_CREDIT_COSTS["nano-banana"]!)
    // cut's final: cut at Final, captions, cut2 at Preview, img. cut2's final: cut2 at Final, img.
    const img = STATIC_CREDIT_COSTS["nano-banana"]!
    expect(final).toBe(base([at("final")]) + captions + base([at("proxy")]) + img + base([at("final")]) + img)
  })

  it.each([true, false])("a chain (flag %s): the final part is at least what the runtime's finals run", async (on) => {
    flag.on = on
    const chain = [
      { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cap", type: "add-captions", data: {} },
      { id: "cut2", type: "apply-edl", data: { quality: "proxy" } },
      { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
    ]
    const chainEdges = [
      { source: "cut", target: "cap" },
      { source: "cap", target: "cut2" },
      { source: "cut2", target: "img" },
    ]
    const at = (q: string) => ({ id: "x", type: "apply-edl", data: { quality: q } })
    const captions = CreditsService.estimateWorkflowBaseCredits([chain[1]!], [])
    const img = STATIC_CREDIT_COSTS["nano-banana"]!
    // Flag off: cut's final runs cut@F, cap, cut2@P AND img; cut2's final runs cut2@F and img again.
    const flagOffRuns = base([at("final")]) + captions + base([at("proxy")]) + img + base([at("final")]) + img
    // Flag on: cut's final stops at cut2's Preview; cut2's final runs cut2@F and img.
    const flagOnRuns = base([at("final")]) + captions + base([at("proxy")]) + base([at("final")]) + img
    const { final } = await split(chain, chainEdges)
    expect(final).toBeGreaterThanOrEqual(flagOffRuns)
    expect(final).toBeGreaterThanOrEqual(flagOnRuns)
  })

  it("two Preview renders side by side: one final each", async () => {
    const side = [
      { id: "a", type: "apply-edl", data: { quality: "proxy" } },
      { id: "b", type: "apply-edl", data: { quality: "proxy" } },
      { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
    ]
    const sideEdges = [{ source: "a", target: "img" }]
    const at = (q: string) => ({ id: "x", type: "apply-edl", data: { quality: q } })
    const { preview, final } = await split(side, sideEdges)
    expect(preview).toBe(2 * base([at("proxy")]) + STATIC_CREDIT_COSTS["nano-banana"]!)
    expect(final).toBe(2 * base([at("final")]) + STATIC_CREDIT_COSTS["nano-banana"])
  })

  // Two Preview renders feeding ONE node. With the flag on the first final
  // stops there at the other render's Preview and the second runs it once;
  // with the flag off (review round 3) neither final stops, so the node and its
  // tail run in both. The listing prices them in both: never under-quoting.
  it.each([true, false])("two Preview renders feeding one node (flag %s): that node and its tail are priced in each final", async (on) => {
    flag.on = on
    const joined = [
      { id: "a", type: "apply-edl", data: { quality: "proxy" } },
      { id: "b", type: "apply-edl", data: { quality: "proxy" } },
      { id: "img", type: "generate-image", data: { provider: "nano-banana" } },
      { id: "img2", type: "generate-image", data: { provider: "nano-banana" } },
    ]
    const joinedEdges = [
      { source: "a", target: "img" },
      { source: "b", target: "img" },
      { source: "img", target: "img2" },
    ]
    const at = (q: string) => ({ id: "x", type: "apply-edl", data: { quality: q } })
    const { preview, final } = await split(joined, joinedEdges)
    expect(preview).toBe(2 * base([at("proxy")]) + 2 * STATIC_CREDIT_COSTS["nano-banana"]!)
    // a's final: a@F, img, img2. b's final: b@F, img, img2 — what the flag-off runtime runs.
    expect(final).toBe(2 * base([at("final")]) + 4 * STATIC_CREDIT_COSTS["nano-banana"]!)
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
