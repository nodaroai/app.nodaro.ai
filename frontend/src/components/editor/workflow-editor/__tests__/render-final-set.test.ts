import { describe, it, expect } from "vitest"
import { renderFinalRunSet, renderRunOverrides, rendersOfPlan } from "../render-final-set"
import { getDownstreamNodeIds } from "../run-from-here-set"

/**
 * TA17 (a), decided 2026-10-04: Render final runs
 * `(desc(plan) ∩ anc(render)) ∪ desc(render)`, minus the plan. For Tighten and
 * a single-camera Clip Pack that is exactly "from the render node onward"; in
 * multicam Camera Switch re-runs first.
 */
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const wire = (source: string, target: string, targetHandle?: string) => ({
  id: `${source}->${target}`,
  source,
  target,
  ...(targetHandle ? { targetHandle } : {}),
})

describe("renderFinalRunSet", () => {
  it("Tighten: the render and everything after it — exactly Run from here at the render", () => {
    const nodes = [node("t", "transcribe"), node("p", "edit-plan"), node("r", "apply-edl"), node("c", "add-captions"), node("u", "upload-video")]
    const edges = [wire("t", "p"), wire("p", "r", "edl"), wire("r", "c"), wire("u", "r", "sources")]
    const set = renderFinalRunSet("r", nodes, edges)
    expect([...set].sort()).toEqual(["c", "r"])
    expect([...set].sort()).toEqual([...getDownstreamNodeIds("r", edges)].sort())
  })

  it("multicam: Camera Switch re-runs before the render; the plan itself never does", () => {
    const nodes = [node("p", "edit-plan"), node("cam", "camera-switch"), node("r", "apply-edl"), node("c", "add-captions")]
    const edges = [wire("p", "cam", "edl"), wire("cam", "r", "edl"), wire("r", "c")]
    expect([...renderFinalRunSet("r", nodes, edges)].sort()).toEqual(["c", "cam", "r"])
  })

  it("a node that descends from the plan but does not feed the render stays out", () => {
    const nodes = [node("p", "edit-plan"), node("cam", "camera-switch"), node("r", "apply-edl"), node("side", "extract-field")]
    const edges = [wire("p", "cam", "edl"), wire("cam", "r", "edl"), wire("p", "side")]
    expect(renderFinalRunSet("r", nodes, edges).has("side")).toBe(false)
  })

  it("an ancestor of the render that is not downstream of the plan stays seeded", () => {
    const nodes = [node("p", "edit-plan"), node("cam", "camera-switch"), node("r", "apply-edl"), node("t", "transcribe")]
    const edges = [wire("p", "cam", "edl"), wire("cam", "r", "edl"), wire("t", "cam", "transcript")]
    const set = renderFinalRunSet("r", nodes, edges)
    expect(set.has("t")).toBe(false)
    expect(set.has("cam")).toBe(true)
  })

  it("the plan is reached through a teleport pair", () => {
    const nodes = [node("p", "edit-plan"), node("cam", "camera-switch"), node("tp", "teleport-send"), node("rcv", "teleport-receive"), node("r", "apply-edl")]
    const edges = [wire("p", "cam", "edl"), wire("cam", "tp"), wire("tp", "rcv"), wire("rcv", "r", "edl")]
    expect(renderFinalRunSet("r", nodes, edges).has("cam")).toBe(true)
  })

  it("no plan behind the render: just the render onward", () => {
    const nodes = [node("x", "generate-text"), node("r", "apply-edl"), node("c", "add-captions")]
    const edges = [wire("x", "r", "edl"), wire("r", "c")]
    expect([...renderFinalRunSet("r", nodes, edges)].sort()).toEqual(["c", "r"])
  })

  it("a node a Group membership or a field mapping feeds from the render is part of the tail", () => {
    const nodes = [node("r", "apply-edl"), node("m", "generate-text", { fieldMappings: { prompt: { sourceNodeId: "r" } } })]
    expect(renderFinalRunSet("r", nodes, []).has("m")).toBe(true)
  })

  it("an unknown render id yields an empty set", () => {
    expect(renderFinalRunSet("nope", [node("r", "apply-edl")], []).size).toBe(0)
  })
})

describe("renderRunOverrides", () => {
  it("overrides only the render, as a one-shot (TA18)", () => {
    expect(renderRunOverrides("r", "final", new Set(["r", "c"]))).toEqual({ r: { quality: "final" } })
    expect(renderRunOverrides("r", "proxy", new Set(["r"]))).toEqual({ r: { quality: "proxy" } })
  })

  it("refuses a render outside the subset: an override clears the node's saved results", () => {
    expect(() => renderRunOverrides("r", "final", new Set(["c"]))).toThrow(/subset/)
  })
})

describe("rendersOfPlan", () => {
  it("lists every render the plan feeds, straight or through Camera Switch, and no other", () => {
    const nodes = [
      node("p", "edit-plan"), node("cam", "camera-switch"), node("r1", "apply-edl"), node("r2", "apply-edl"),
      node("other", "edit-plan"), node("r3", "apply-edl"),
    ]
    const edges = [wire("p", "r1", "edl"), wire("p", "cam", "edl"), wire("cam", "r2", "edl"), wire("other", "r3", "edl")]
    expect(rendersOfPlan("p", nodes, edges).map((n) => n.id)).toEqual(["r1", "r2"])
    expect(rendersOfPlan("other", nodes, edges).map((n) => n.id)).toEqual(["r3"])
  })

  it("is empty for a plan that feeds no render", () => {
    expect(rendersOfPlan("p", [node("p", "edit-plan")], [])).toEqual([])
  })
})
