import { describe, it, expect } from "vitest"
import {
  pushRevision,
  findRevision,
  resolveSceneCompletion,
  adoptLocalRevision,
  archiveSupersededResult,
  descendsFrom,
  restoreContextPatch,
  scene3DRunContext,
  MAX_SCENE_REVISIONS,
} from "../revisions"
import { makePlan, REV_A, REV_B } from "./fixture"
import type { Scene3DRevisionEntry } from "@/types/nodes"

const NOW = () => "2026-09-07T12:00:00.000Z"

function entry(revisionId: string, source: Scene3DRevisionEntry["source"] = "manual"): Scene3DRevisionEntry {
  return { revisionId, scenePlan: makePlan({ revisionId }), source, createdAt: NOW() }
}

describe("pushRevision", () => {
  it("appends the new revision, newest last", () => {
    const next = pushRevision([entry(REV_A)], makePlan({ revisionId: REV_B }), "edit", { changeSummary: "moved the hero", now: NOW })
    expect(next.map((e) => e.revisionId)).toEqual([REV_A, REV_B])
    expect(next[1].changeSummary).toBe("moved the hero")
    expect(next[1].source).toBe("edit")
  })

  it("is a no-op when the newest entry is already that revision", () => {
    const history = [entry(REV_A), entry(REV_B)]
    const next = pushRevision(history, makePlan({ revisionId: REV_B }), "edit", { now: NOW })
    expect(next.map((e) => e.revisionId)).toEqual([REV_A, REV_B])
  })

  it("never stores the same revision twice (restore then re-adopt)", () => {
    const history = [entry(REV_A), entry(REV_B)]
    const next = pushRevision(history, makePlan({ revisionId: REV_A }), "manual", { now: NOW })
    expect(next.map((e) => e.revisionId)).toEqual([REV_B, REV_A])
  })

  it("does not mutate the history it was given", () => {
    const history = [entry(REV_A)]
    pushRevision(history, makePlan({ revisionId: REV_B }), "edit", { now: NOW })
    expect(history).toHaveLength(1)
  })

  it("drops a plan with no revision id — it cannot be restored", () => {
    const next = pushRevision([entry(REV_A)], { fps: 24 }, "edit", { now: NOW })
    expect(next.map((e) => e.revisionId)).toEqual([REV_A])
  })

  it("bounds the stack", () => {
    let history: Scene3DRevisionEntry[] = []
    for (let i = 0; i < MAX_SCENE_REVISIONS + 5; i++) {
      history = pushRevision(history, makePlan({ revisionId: `rev-${i}` }), "manual", { now: NOW })
    }
    expect(history).toHaveLength(MAX_SCENE_REVISIONS)
    expect(history[history.length - 1].revisionId).toBe(`rev-${MAX_SCENE_REVISIONS + 4}`)
  })

  it("findRevision looks entries up by id", () => {
    const history = [entry(REV_A), entry(REV_B)]
    expect(findRevision(history, REV_B)?.revisionId).toBe(REV_B)
    expect(findRevision(history, "nope")).toBeUndefined()
  })
})

describe("resolveSceneCompletion (stale-completion guard)", () => {
  const incoming = makePlan({ revisionId: REV_B })

  it("adopts when the node is still on the revision the job was launched against", () => {
    const result = resolveSceneCompletion({
      current: makePlan({ revisionId: REV_A }),
      baseRevisionId: REV_A,
      incoming,
      changeSummary: "added a wall",
      history: [entry(REV_A)],
      source: "edit",
      now: NOW,
    })
    expect(result.outcome).toBe("adopt")
    expect(result.patch.scenePlan).toBe(incoming)
    expect(result.patch.expectedRevisionId).toBe(REV_B)
    expect(result.patch.scenePendingPlan).toBeUndefined()
    expect(result.patch.sceneJobBaseRevisionId).toBeUndefined()
  })

  it("adopts a first generation (no current scene at all)", () => {
    const result = resolveSceneCompletion({
      current: undefined,
      baseRevisionId: undefined,
      incoming,
      history: undefined,
      source: "generate",
      now: NOW,
    })
    expect(result.outcome).toBe("adopt")
    expect(result.patch.sceneHistory.map((e) => e.revisionId)).toEqual([REV_B])
  })

  it("PARKS when a manual edit landed while the job ran — the newer edit survives", () => {
    const manual = makePlan({ revisionId: "33333333-3333-4333-8333-333333333333" })
    const result = resolveSceneCompletion({
      current: manual,
      baseRevisionId: REV_A,
      incoming,
      history: [entry(REV_A)],
      source: "edit",
      now: NOW,
    })
    expect(result.outcome).toBe("park")
    expect(result.patch.scenePlan).toBeUndefined()
    expect(result.patch.scenePendingPlan).toBe(incoming)
    // The paid-for revision is still recorded — nothing is thrown away.
    expect(result.patch.sceneHistory.map((e) => e.revisionId)).toEqual([REV_A, REV_B])
  })

  it("parks an incoming plan with no revision id rather than making it active", () => {
    const result = resolveSceneCompletion({
      current: makePlan({ revisionId: REV_A }),
      baseRevisionId: REV_A,
      incoming: { planType: "3d-scene" },
      history: [entry(REV_A)],
      source: "edit",
      now: NOW,
    })
    expect(result.outcome).toBe("park")
    expect(result.patch.scenePlan).toBeUndefined()
  })
})

describe("adoptLocalRevision", () => {
  it("records a manual edit and moves expectedRevisionId with it", () => {
    const plan = makePlan({ revisionId: REV_B })
    const patch = adoptLocalRevision([entry(REV_A)], plan, "Set position on hero", undefined, NOW)
    expect(patch.scenePlan).toBe(plan)
    expect(patch.expectedRevisionId).toBe(REV_B)
    expect(patch.sceneHistory.map((e) => e.source)).toEqual(["manual", "manual"])
    expect(patch.sceneHistory[1].changeSummary).toBe("Set position on hero")
  })
})

describe("descendsFrom", () => {
  const REV_C = "44444444-4444-4444-8444-444444444444"

  it("recognises the revision itself", () => {
    expect(descendsFrom(makePlan({ revisionId: REV_A }), REV_A, [])).toBe(true)
  })

  it("follows a one-hop parent link", () => {
    const child = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    expect(descendsFrom(child, REV_A, [])).toBe(true)
  })

  it("follows a multi-hop chain through stored history", () => {
    const mid = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    const leaf = makePlan({ revisionId: REV_C, parentRevisionId: REV_B })
    const history: Scene3DRevisionEntry[] = [
      { revisionId: REV_A, scenePlan: makePlan(), source: "generate", createdAt: NOW() },
      { revisionId: REV_B, scenePlan: mid, source: "manual", createdAt: NOW() },
    ]
    expect(descendsFrom(leaf, REV_A, history)).toBe(true)
  })

  it("is false for a divergent lineage (a regenerated upstream)", () => {
    const other = makePlan({ revisionId: REV_C, parentRevisionId: REV_B })
    expect(descendsFrom(other, REV_A, [])).toBe(false)
  })

  it("is false for an unversioned or missing plan", () => {
    expect(descendsFrom(undefined, REV_A, [])).toBe(false)
    expect(descendsFrom({ planType: "3d-scene" }, REV_A, [])).toBe(false)
  })

  it("terminates on a parent cycle instead of hanging the run", () => {
    const a = makePlan({ revisionId: REV_A, parentRevisionId: REV_B })
    const b = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    const history: Scene3DRevisionEntry[] = [
      { revisionId: REV_A, scenePlan: a, source: "manual", createdAt: NOW() },
      { revisionId: REV_B, scenePlan: b, source: "manual", createdAt: NOW() },
    ]
    expect(descendsFrom(a, REV_C, history)).toBe(false)
  })
})

describe("resolveSceneCompletion — races the both-present comparison used to miss", () => {
  const REV_C = "55555555-5555-4555-8555-555555555555"
  const incoming = makePlan({ revisionId: REV_C })

  it("PARKS when the job started on an empty node and a scene arrived while it ran", () => {
    // The clobber this closes: base `undefined` used to disable the guard
    // entirely, so a generation launched on an empty node overwrote whatever
    // a restore or a second job had landed in the meantime.
    const result = resolveSceneCompletion({
      current: makePlan({ revisionId: REV_A }),
      baseRevisionId: undefined,
      incoming,
      history: [entry(REV_A)],
      source: "generate",
      now: NOW,
    })
    expect(result.outcome).toBe("park")
    expect(result.patch.scenePlan).toBeUndefined()
    expect(result.patch.scenePendingPlan).toBe(incoming)
    expect(result.patch.sceneHistory.map((e) => e.revisionId)).toEqual([REV_A, REV_C])
  })

  it("PARKS when the user CLEARED the scene while the job ran", () => {
    const result = resolveSceneCompletion({
      current: undefined,
      baseRevisionId: REV_A,
      incoming,
      history: [entry(REV_A)],
      source: "edit",
      now: NOW,
    })
    expect(result.outcome).toBe("park")
    expect(result.patch.scenePlan).toBeUndefined()
  })

  it("still ADOPTS the ordinary first generation (both sides absent)", () => {
    const result = resolveSceneCompletion({
      current: undefined,
      baseRevisionId: undefined,
      incoming,
      history: [],
      source: "generate",
      now: NOW,
    })
    expect(result.outcome).toBe("adopt")
    expect(result.patch.scenePlan).toBe(incoming)
  })
})

describe("archiveSupersededResult", () => {
  it("keeps a result whose run the node has moved off, and touches nothing else", () => {
    const incoming = makePlan({ revisionId: REV_B })
    const patch = archiveSupersededResult([entry(REV_A)], incoming, "generate", { now: NOW })
    expect(patch).not.toBeNull()
    expect(Object.keys(patch!)).toEqual(["sceneHistory"])
    expect(patch!.sceneHistory.map((e) => e.revisionId)).toEqual([REV_A, REV_B])
  })

  it("is a no-op for a revision already in history, and for an unversioned plan", () => {
    expect(archiveSupersededResult([entry(REV_B)], makePlan({ revisionId: REV_B }), "edit", { now: NOW })).toBeNull()
    expect(archiveSupersededResult([], { planType: "3d-scene" }, "edit", { now: NOW })).toBeNull()
  })
})

describe("authoring context", () => {
  it("is stored with the revision a run produced", () => {
    const context = scene3DRunContext(
      { llmModel: "gpt-5", reasoningEffort: "high", lockedObjectIds: ["ground"], selectedObjectIds: [] },
      "a clay figure walks",
      [{ id: "n1", url: "https://r2/a.png", kind: "image", role: "appearance" }],
      REV_A,
    )
    expect(context).toEqual({
      prompt: "a clay figure walks",
      llmModel: "gpt-5",
      reasoningEffort: "high",
      references: [{ id: "n1", url: "https://r2/a.png", kind: "image", role: "appearance" }],
      baseRevisionId: REV_A,
      lockedObjectIds: ["ground"],
    })

    const result = resolveSceneCompletion({
      current: makePlan({ revisionId: REV_A }),
      baseRevisionId: REV_A,
      incoming: makePlan({ revisionId: REV_B }),
      history: [entry(REV_A)],
      source: "edit",
      context,
      now: NOW,
    })
    expect(result.patch.sceneHistory[1].context).toEqual(context)
  })

  it("restores into the node's OWN prompt field, and never clears what it did not record", () => {
    const patch = restoreContextPatch(
      { prompt: "move the camera lower", llmModel: "gpt-5", lockedObjectIds: ["hero"] },
      "editPrompt",
    )
    expect(patch).toEqual({
      editPrompt: "move the camera lower",
      llmModel: "gpt-5",
      lockedObjectIds: ["hero"],
    })
    // No `reasoningEffort` key at all — spreading `undefined` would CLEAR the
    // model settings the user currently has selected.
    expect("reasoningEffort" in patch).toBe(false)
    expect(restoreContextPatch(undefined, "scenePrompt")).toEqual({})
  })

  it("a manual edit records the revision it was derived from", () => {
    const plan = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    const patch = adoptLocalRevision([entry(REV_A)], plan, "Set position on hero", { lockedObjectIds: ["ground"] }, NOW)
    expect(patch.sceneHistory[1].context).toEqual({ lockedObjectIds: ["ground"], baseRevisionId: REV_A })
  })
})
