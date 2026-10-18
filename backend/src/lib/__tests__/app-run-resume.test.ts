/**
 * Which execution an app run's Retry continues (`resumeSource`) and which nodes it considers
 * (`resumeRouteNodeIds`).
 */
import { describe, expect, it } from "vitest"
import { resumeRouteNodeIds, resumeSource } from "../app-run-resume.js"
import type { ContinuationSource } from "../../services/workflow-engine/run-continuation.js"

const exec = (id: string, over: Partial<ContinuationSource> = {}): ContinuationSource => ({
  id, userId: "u1", workflowId: "wf-1", status: "failed", appVersionId: "v1", startedAt: "t", resumedFrom: null, ...over,
})

describe("resumeSource", () => {
  it("a run that started: itself", async () => {
    const pointed = exec("e2", { resumedFrom: "e1" })
    expect(await resumeSource(pointed, async () => exec("e1"))).toBe(pointed)
  })

  it("a Retry refused before it started: what it continued, over every such Retry", async () => {
    const rows = new Map([
      ["e2", exec("e2", { startedAt: null, resumedFrom: "e1" })],
      ["e1", exec("e1")],
    ])
    const pointed = exec("e3", { startedAt: null, resumedFrom: "e2" })
    expect((await resumeSource(pointed, async (id) => rows.get(id) ?? null)).id).toBe("e1")
  })

  it("never walks to another runner's or another version's execution, nor to one that is gone", async () => {
    const pointed = exec("e2", { startedAt: null, resumedFrom: "e1" })
    expect((await resumeSource(pointed, async () => exec("e1", { userId: "u2" }))).id).toBe("e2")
    expect((await resumeSource(pointed, async () => exec("e1", { appVersionId: "v2" }))).id).toBe("e2")
    expect((await resumeSource(pointed, async () => null)).id).toBe("e2")
  })

  it("stops after a few hops", async () => {
    let n = 0
    const load = async (id: string) => exec(id, { startedAt: null, resumedFrom: `e${++n}` })
    const found = await resumeSource(exec("e0", { startedAt: null, resumedFrom: "start" }), load)
    expect(n).toBe(5)
    expect(found.startedAt).toBeNull()
  })
})

describe("resumeRouteNodeIds", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }]
  it("every node, in graph order, unless the app runs a route", () => {
    expect(resumeRouteNodeIds(["a", "b", "c"], nodes, [], {})).toEqual(["a", "b", "c"])
    expect(resumeRouteNodeIds(["a", "b", "c"], nodes, [], null)).toEqual(["a", "b", "c"])
  })
})
