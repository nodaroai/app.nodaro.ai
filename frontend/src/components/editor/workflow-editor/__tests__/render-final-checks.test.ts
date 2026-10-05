import { describe, it, expect, vi } from "vitest"
import { buildEffectiveEdl } from "@nodaro/render-rules"
import { editPlanBasis } from "@nodaro/shared"
import { finalIsUnchanged, newerRunPatches, renderRuleVerdict } from "../render-final-checks"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * Render final's three prechecks: Apply EDL's rule (TA1 a), a newer run the
 * canvas does not show (TA3 c) and "nothing changed since the last final"
 * (TA15 a, decided 2026-10-04).
 */
const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle?: string) =>
  ({ id: `${source}->${target}`, source, target, ...(targetHandle ? { targetHandle } : {}) }) as unknown as WorkflowEdge
const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
const edlOf = (...segments: Array<Record<string, unknown>>) => ({
  version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments,
})

describe("renderRuleVerdict (TA1 a)", () => {
  it("passes a plan the render can draw", () => {
    const nodes = [node("p", "edit-plan", { generatedJson: edlOf(seg(0, 60_000)) }), node("r", "apply-edl")]
    expect(renderRuleVerdict("r", nodes, [edge("p", "r", "edl")])).toEqual({ ok: true })
  })

  it("refuses what Apply EDL's rule refuses, in the rule's own words", () => {
    const tooLong = edlOf(seg(0, 181 * 60_000))
    const nodes = [node("p", "edit-plan", { generatedJson: tooLong }), node("r", "apply-edl")]
    const verdict = renderRuleVerdict("r", nodes, [edge("p", "r", "edl")])
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.issues.length).toBeGreaterThan(0)
  })

  it("judges the plan as the review leaves it: a restored span the render cannot draw is refused", () => {
    const plan = edlOf(seg(0, 10_000), seg(20_000, 30_000))
    const edited = {
      v: 1, kind: "edl", basis: editPlanBasis(plan),
      edl: { segments: [{ ...seg(0, 10_000), video: undefined }, seg(20_000, 30_000)], dropped: [] },
    }
    const nodes = [node("p", "edit-plan", { generatedJson: plan, editedEdl: edited }), node("r", "apply-edl")]
    expect(renderRuleVerdict("r", nodes, [edge("p", "r", "edl")]).ok).toBe(false)
  })

  it("no EDL at all is a refusal, not a pass", () => {
    expect(renderRuleVerdict("r", [node("r", "apply-edl")], []).ok).toBe(false)
  })
})

describe("newerRunPatches (TA3 c)", () => {
  const nodes = [node("p", "edit-plan", { generatedJson: edlOf(seg(0, 5_000)) }), node("r", "apply-edl"), node("far", "generate-text")]
  const edges = [edge("p", "r", "edl")]
  const run = { id: "run-2", triggerType: "manual", status: "completed", nodeStates: { p: { status: "completed" } } }

  it("is empty when no ended run exists", () => {
    expect(newerRunPatches(nodes, edges, [], vi.fn())).toEqual({})
  })

  it("is empty when loading the run would change nothing (the canvas shows it)", () => {
    expect(newerRunPatches(nodes, edges, [run], (ns) => ns)).toEqual({})
  })

  it("names the EDL-path nodes the newer run would change", () => {
    const restore = (ns: WorkflowNode[]) =>
      ns.map((n) => (n.id === "p" || n.id === "far" ? ({ ...n, data: { ...n.data, generatedJson: edlOf(seg(0, 9_000)) } } as WorkflowNode) : n))
    const patches = newerRunPatches(nodes, edges, [run], restore)
    expect(Object.keys(patches)).toEqual(["p"]) // `far` is off the render's path
  })

  it("reads the newest orchestrated row, as the reopen lane does", () => {
    const single = { id: "s", triggerType: "single-node", status: "completed", nodeStates: { r: {} } }
    const seen: string[] = []
    newerRunPatches(nodes, edges, [single, run], (ns, _e, r) => { seen.push(r.id); return ns })
    expect(seen).toEqual(["run-2"])
  })
})

describe("finalIsUnchanged (TA15 a)", () => {
  const plan = edlOf(seg(0, 60_000))
  const effective = buildEffectiveEdl(plan, { crossfadeMs: 0, sourceOverrides: [] })
  const take = { url: "https://cdn/f.mp4", jobId: "job-final", timestamp: "t", quality: "final" as const }
  const graph = (extra: Record<string, unknown> = {}, p: unknown = plan) => ({
    nodes: [node("p", "edit-plan", { generatedJson: p }), node("r", "apply-edl", { generatedResults: [take], ...extra })],
    edges: [edge("p", "r", "edl")],
  })

  it("true when the stored EDL is what the render would send now (key order does not matter)", async () => {
    const { nodes, edges } = graph()
    const reordered = JSON.parse(JSON.stringify(effective), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))
    const getJob = vi.fn().mockResolvedValue({ input_data: { edl: reordered, output: "video" } })
    expect(await finalIsUnchanged("r", nodes, edges, getJob)).toBe(true)
    expect(getJob).toHaveBeenCalledWith("job-final")
  })

  it("false when the plan changed since", async () => {
    const { nodes, edges } = graph({}, edlOf(seg(0, 30_000)))
    const getJob = vi.fn().mockResolvedValue({ input_data: { edl: effective, output: "video" } })
    expect(await finalIsUnchanged("r", nodes, edges, getJob)).toBe(false)
  })

  it("false when the output medium changed", async () => {
    const { nodes, edges } = graph({ output: "audio" })
    const getJob = vi.fn().mockResolvedValue({ input_data: { edl: effective, output: "video" } })
    expect(await finalIsUnchanged("r", nodes, edges, getJob)).toBe(false)
  })

  it("false, with no fetch, when the render has no final take (a Preview is not a final)", async () => {
    const { nodes, edges } = graph({ generatedResults: [{ ...take, quality: "proxy" }] })
    const getJob = vi.fn()
    expect(await finalIsUnchanged("r", nodes, edges, getJob)).toBe(false)
    expect(getJob).not.toHaveBeenCalled()
  })

  it("fails open when the job cannot be fetched, or holds no EDL", async () => {
    const { nodes, edges } = graph()
    expect(await finalIsUnchanged("r", nodes, edges, vi.fn().mockRejectedValue(new Error("network")))).toBe(false)
    expect(await finalIsUnchanged("r", nodes, edges, vi.fn().mockResolvedValue({ input_data: {} }))).toBe(false)
  })

  it("a clip set: every clip must match its own last final, found by clipKey", async () => {
    const a = edlOf(seg(0, 10_000))
    const b = edlOf(seg(20_000, 40_000))
    const effA = buildEffectiveEdl(a, { crossfadeMs: 0, sourceOverrides: [] })
    const effB = buildEffectiveEdl(b, { crossfadeMs: 0, sourceOverrides: [] })
    const nodes = [
      node("p", "edit-plan", { generatedJson: [a, b] }),
      node("r", "apply-edl", {
        generatedResults: [
          { ...take, jobId: "jb", clipKey: "20000-40000" },
          { ...take, jobId: "ja", clipKey: "0-10000" },
        ],
      }),
    ]
    const edges = [edge("p", "r", "edl")]
    const jobs: Record<string, unknown> = { ja: effA, jb: effB }
    const getJob = vi.fn(async (id: string) => ({ input_data: { edl: jobs[id], output: "video" } }))
    expect(await finalIsUnchanged("r", nodes, edges, getJob)).toBe(true)
    jobs.jb = effA // clip b's last final was made from something else
    expect(await finalIsUnchanged("r", nodes, edges, getJob)).toBe(false)
  })

  it("behind Camera Switch the answer is unknowable, so it is never 'unchanged'", async () => {
    const nodes = [
      node("p", "edit-plan", { generatedJson: plan }),
      node("cam", "camera-switch", { generatedJson: { edl: plan } }),
      node("r", "apply-edl", { generatedResults: [take] }),
    ]
    const edges = [edge("p", "cam", "edl"), edge("cam", "r", "edl")]
    const getJob = vi.fn()
    expect(await finalIsUnchanged("r", nodes, edges, getJob)).toBe(false)
    expect(getJob).not.toHaveBeenCalled()
  })
})
