/**
 * Scene3D authoring — the layer between a model's answer and the contract.
 *
 * Three things are worth failing a build over:
 *
 * 1. The SERVER owns timing and identity. A model that returns a scene cannot
 *    change how long the render is or which revision it becomes.
 * 2. A semantically invalid answer is REVISED, not accepted and not silently
 *    dropped: the refusal goes back to the model in its own words and it gets
 *    another try, bounded.
 * 3. Locks are enforced on the model's OUTPUT. The prompt asks nicely;
 *    `applyScene3DEditOperations` is what actually refuses, and the edit lane
 *    must route through it — a lane that let the model write a whole plan
 *    would have no such check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ llmCompleteStructured: vi.fn(), prefetchAsBase64: vi.fn() }))

vi.mock("@/lib/llm-client.js", () => ({ llmCompleteStructured: mocks.llmCompleteStructured }))
vi.mock("@/lib/anthropic-image.js", () => ({ prefetchAsBase64: mocks.prefetchAsBase64 }))

import { SCENE3D_PLAN_TYPE, SCENE3D_SCHEMA_VERSION, type Scene3DPlan } from "@nodaro/shared"
import {
  applyDeterministicScene3DEdit,
  applyScene3DEditWithReferences,
  editScenePlan,
  generateScenePlan,
  SCENE3D_MAX_REVISIONS,
} from "../scene3d-authoring.js"

const REV = "11111111-2222-4333-8444-555555555555"
const NEXT_REV = "66666666-7777-4888-8999-aaaaaaaaaaaa"

const DRAFT_OBJECT = {
  id: "hero",
  name: "Hero",
  primitive: "capsule" as const,
  dimensions: [0.5, 1.7, 0.5],
  position: [0, 0.85, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  color: "#cc8844",
}

const DRAFT_PLAN = {
  backgroundColor: "#101014",
  camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35 },
  objects: [DRAFT_OBJECT],
  lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
}

const PLAN: Scene3DPlan = {
  planType: SCENE3D_PLAN_TYPE,
  schemaVersion: SCENE3D_SCHEMA_VERSION,
  revisionId: REV,
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
  backgroundColor: "#101014",
  camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [
    { id: "ground", name: "Ground", primitive: "plane", dimensions: [10, 0.01, 10], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#333333" },
    { id: "hero", name: "Hero", primitive: "capsule", dimensions: [0.5, 1.7, 0.5], position: [0, 0.85, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc8844" },
  ],
  lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
}

/** Queue one structured answer per attempt, in order. */
function answers(...outputs: unknown[]) {
  for (const output of outputs) {
    mocks.llmCompleteStructured.mockResolvedValueOnce({ output, inputTokens: 100, outputTokens: 200, providerCost: 0.01 })
  }
}

const generateArgs = {
  prompt: "A lone figure in an empty warehouse",
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
  llmModel: "claude-sonnet-4.6",
  references: [],
  revisionId: REV,
}

const editArgs = {
  plan: PLAN,
  instruction: "move the hero to the left",
  lockedObjectIds: [] as string[],
  selectedObjectIds: [] as string[],
  llmModel: "claude-sonnet-4.6",
  references: [],
  revisionId: NEXT_REV,
}

/** The user turn of attempt N, flattened to text. */
function userTextAt(call: number): string {
  const request = mocks.llmCompleteStructured.mock.calls[call][0] as { messages: { role: string; content: unknown }[] }
  return request.messages
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : (m.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("\n"),
    )
    .join("\n---\n")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prefetchAsBase64.mockImplementation(async (url: string) => ({ type: "image", url }))
})

describe("generateScenePlan", () => {
  it("stamps the SERVER's timing and identity onto the model's scene", async () => {
    answers(DRAFT_PLAN)
    const result = await generateScenePlan(generateArgs)
    expect(result.plan).toMatchObject({
      planType: "3d-scene",
      schemaVersion: 1,
      revisionId: REV,
      width: 1920,
      height: 1080,
      fps: 24,
      durationInFrames: 96,
    })
    expect(result.plan.objects[0].position).toEqual([0, 0.85, 0])
    expect(result.plan.camera.sensorWidthMm).toBe(36)
    expect(result.revisions).toBe(0)
    expect(result).toMatchObject({ inputTokens: 100, outputTokens: 200, providerCost: 0.01 })
  })

  it("tells the model the exact frame range it may animate in", async () => {
    answers(DRAFT_PLAN)
    await generateScenePlan({ ...generateArgs, fps: 30, durationInFrames: 60 })
    expect(userTextAt(0)).toContain("0..59")
  })

  it("attaches image references as content blocks and names each role", async () => {
    answers(DRAFT_PLAN)
    await generateScenePlan({
      ...generateArgs,
      references: [
        { id: "r1", url: "https://x.test/a.png", kind: "image", role: "appearance" },
        { id: "r2", url: "https://x.test/b.png", kind: "image", role: "layout", objectId: "hero" },
      ],
    })
    expect(mocks.prefetchAsBase64).toHaveBeenCalledTimes(2)
    const content = (mocks.llmCompleteStructured.mock.calls[0][0] as { messages: { content: { type: string }[] }[] })
      .messages[0].content
    expect(content.filter((b) => b.type === "image")).toHaveLength(2)
    const text = userTextAt(0)
    expect(text).toContain("its palette and materials")
    // Silhouette and proportion are the point of an appearance reference in a
    // grey-box previz — a palette-only instruction wastes the picture.
    expect(text).toContain("silhouette and proportions")
    expect(text).toContain('applies to object "hero"')
  })

  it("composes the video analysis into the brief", async () => {
    answers(DRAFT_PLAN)
    await generateScenePlan({
      ...generateArgs,
      references: [{ id: "r1", url: "https://x.test/a.mp4", kind: "video", role: "motion" }],
      analysis: { summary: "a slow dolly in on a seated figure" } as never,
    })
    const text = userTextAt(0)
    expect(text).toContain("VIDEO REFERENCE ANALYSIS")
    expect(text).toContain("slow dolly")
    // A video reference is not an image attachment.
    expect(mocks.prefetchAsBase64).not.toHaveBeenCalled()
  })

  it("revises a scene the contract rejects, feeding the reason back", async () => {
    const cyclic = {
      ...DRAFT_PLAN,
      objects: [
        { ...DRAFT_OBJECT, id: "a", parentId: "b" },
        { ...DRAFT_OBJECT, id: "b", parentId: "a" },
      ],
    }
    answers(cyclic, DRAFT_PLAN)
    const result = await generateScenePlan(generateArgs)
    expect(result.revisions).toBe(1)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(2)
    expect(userTextAt(1)).toContain("parent cycle")
    // Usage accumulates across attempts — a retried call really was billed.
    expect(result.inputTokens).toBe(200)
    expect(result.providerCost).toBeCloseTo(0.02)
  })

  it("gives up after the revision budget rather than shipping an invalid scene", async () => {
    const past = { ...DRAFT_PLAN, objects: [{ ...DRAFT_OBJECT, keyframes: [{ frame: 9999 }] }] }
    answers(...Array.from({ length: SCENE3D_MAX_REVISIONS + 1 }, () => past))
    await expect(generateScenePlan(generateArgs)).rejects.toThrow(/past the scene's last frame/)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(SCENE3D_MAX_REVISIONS + 1)
  })
})

describe("editScenePlan", () => {
  it("applies the model's operations and produces the pinned revision", async () => {
    answers({
      operations: [{ op: "set-object", objectId: "hero", changes: { position: [-2, 0.85, 0] } }],
      changeSummary: "Moved the hero to the left.",
    })
    const result = await editScenePlan(editArgs)
    expect(result.plan.revisionId).toBe(NEXT_REV)
    expect(result.plan.parentRevisionId).toBe(REV)
    expect(result.plan.objects.find((o) => o.id === "hero")?.position).toEqual([-2, 0.85, 0])
    expect(result.changeSummary).toBe("Moved the hero to the left.")
    // The input plan is untouched — a revision is a new object, always.
    expect(PLAN.objects.find((o) => o.id === "hero")?.position).toEqual([0, 0.85, 0])
  })

  it("shows the model the scene, the locks and the selection — and hides our bookkeeping", async () => {
    answers({ operations: [{ op: "set-background", color: "#000000" }], changeSummary: "Darkened it." })
    await editScenePlan({ ...editArgs, lockedObjectIds: ["ground"], selectedObjectIds: ["hero"] })
    const text = userTextAt(0)
    expect(text).toContain("LOCKED (must not change in any way): ground")
    expect(text).toContain("SELECTED")
    expect(text).toContain('"id":"hero"')
    expect(text).not.toContain(REV)
  })

  it("REFUSES a model edit that touches a locked object, and tells it why", async () => {
    answers(
      { operations: [{ op: "set-object", objectId: "ground", changes: { color: "#ff0000" } }], changeSummary: "Recoloured the ground." },
      { operations: [{ op: "set-object", objectId: "hero", changes: { color: "#ff0000" } }], changeSummary: "Recoloured the hero." },
    )
    const result = await editScenePlan({ ...editArgs, lockedObjectIds: ["ground"] })
    expect(result.revisions).toBe(1)
    expect(userTextAt(1)).toContain('"ground" is locked')
    expect(result.plan.objects.find((o) => o.id === "ground")?.color).toBe("#333333")
    expect(result.plan.objects.find((o) => o.id === "hero")?.color).toBe("#ff0000")
  })

  it("fails the job rather than smuggling a locked change through", async () => {
    const locked = { operations: [{ op: "remove-object", objectId: "ground" }], changeSummary: "Removed it." }
    answers(...Array.from({ length: SCENE3D_MAX_REVISIONS + 1 }, () => locked))
    await expect(editScenePlan({ ...editArgs, lockedObjectIds: ["ground"] })).rejects.toThrow(/locked/)
  })

  it("revises a malformed operation the model can fix", async () => {
    answers(
      { operations: [{ op: "set-object", objectId: "hero" }], changeSummary: "..." },
      { operations: [{ op: "set-object", objectId: "hero", changes: { color: "#00ff00" } }], changeSummary: "Greened the hero." },
    )
    const result = await editScenePlan(editArgs)
    expect(userTextAt(1)).toContain("needs a changes object")
    expect(result.plan.objects.find((o) => o.id === "hero")?.color).toBe("#00ff00")
  })

  it("falls back to the mechanical summary when the model writes none", async () => {
    answers({ operations: [{ op: "set-background", color: "#000000" }], changeSummary: "   " })
    const result = await editScenePlan(editArgs)
    expect(result.changeSummary).toContain("#000000")
  })

  it("refuses an edit that would orphan a child, then accepts the corrected pair", async () => {
    const parented: Scene3DPlan = {
      ...PLAN,
      objects: [PLAN.objects[0], { ...PLAN.objects[1], parentId: "ground" }],
    }
    answers(
      { operations: [{ op: "remove-object", objectId: "ground" }], changeSummary: "Removed the ground." },
      {
        operations: [
          { op: "set-object", objectId: "hero", changes: { parentId: null } },
          { op: "remove-object", objectId: "ground" },
        ],
        changeSummary: "Detached the hero, then removed the ground.",
      },
    )
    const result = await editScenePlan({ ...editArgs, plan: parented })
    expect(userTextAt(1)).toContain("unknown parent")
    expect(result.plan.objects).toHaveLength(1)
    expect(result.plan.objects[0].parentId).toBeUndefined()
  })
})

describe("editScenePlan — references", () => {
  const IMG = "https://r2.test/ref.png"

  it("shows the model the plan's OWN references, so an earlier edit's reference still conditions this one", async () => {
    answers({ operations: [{ op: "set-background", color: "#000000" }], changeSummary: "Darkened it." })
    const withRef: Scene3DPlan = {
      ...PLAN,
      references: [{ id: "hero-ref", url: IMG, kind: "image", role: "appearance", objectId: "hero" }],
    }
    const result = await editScenePlan({ ...editArgs, plan: withRef, references: [] })
    // Attached, labelled, and still on the revision this edit produced.
    expect(userTextAt(0)).toContain('REFERENCE "hero-ref"')
    expect(result.plan.references?.map((r) => r.id)).toEqual(["hero-ref"])
  })

  it("replaces the reference set in both model conditioning and the new revision", async () => {
    answers({ operations: [{ op: "set-background", color: "#000000" }], changeSummary: "Darkened it." })
    const previous: Scene3DPlan = { ...PLAN, references: [{ id: "removed", url: IMG, kind: "image", role: "appearance" }] }
    const result = await editScenePlan({ ...editArgs, plan: previous, references: [], replaceReferences: true })
    expect(userTextAt(0)).not.toContain("removed")
    expect(userTextAt(0)).not.toContain(IMG)
    expect(result.plan.references).toBeUndefined()
    expect(previous.references).toHaveLength(1)
    expect(result.plan.parentRevisionId).toBe(previous.revisionId)
  })

  it("persists a reference supplied WITH the instruction", async () => {
    answers({ operations: [{ op: "set-background", color: "#000000" }], changeSummary: "Darkened it." })
    const result = await editScenePlan({
      ...editArgs,
      references: [{ id: "new-ref", url: IMG, kind: "image", role: "appearance" }],
    })
    expect(result.plan.references?.map((r) => r.id)).toEqual(["new-ref"])
  })
})

describe("applyScene3DEditWithReferences", () => {
  const IMG = "https://r2.test/ref.png"
  const bg = [{ op: "set-background" as const, color: "#000000" }]

  it("lands a NEW reference on the produced revision", () => {
    // The bug this replaces: the result was derived from the SOURCE plan, so a
    // reference the caller had just paid to attach was never on the revision
    // the edit produced — accepted, charged, and silently absent.
    const result = applyScene3DEditWithReferences({
      plan: PLAN,
      operations: bg,
      references: [{ id: "r1", url: IMG, kind: "image", role: "appearance" }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.references).toEqual([{ id: "r1", url: IMG, kind: "image", role: "appearance" }])
  })

  it("can remove a referenced object when its reference is explicitly cleared", () => {
    const previous: Scene3DPlan = { ...PLAN, references: [{ id: "removed", url: IMG, kind: "image", role: "appearance", objectId: "hero" }] }
    const result = applyScene3DEditWithReferences({ plan: previous, operations: [{ op: "remove-object", objectId: "hero" }], references: [], replaceReferences: true })
    expect(result.ok).toBe(true)
    if (!result.ok) throw Error(result.message)
    expect(result.plan.references).toBeUndefined()
    expect(previous.objects.some((object) => object.id === "hero")).toBe(true)
  })

  it("keeps prior references and replaces the one sharing an id", () => {
    const withRefs: Scene3DPlan = {
      ...PLAN,
      references: [
        { id: "keep", url: IMG, kind: "image", role: "layout" },
        { id: "hero-ref", url: IMG, kind: "image", role: "appearance", objectId: "hero" },
      ],
    }
    const result = applyScene3DEditWithReferences({
      plan: withRefs,
      operations: bg,
      references: [{ id: "hero-ref", url: `${IMG}?2`, kind: "image", role: "layout", objectId: "ground" }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.references?.map((r) => r.id)).toEqual(["keep", "hero-ref"])
    expect(result.plan.references?.[1]).toMatchObject({ role: "layout", objectId: "ground" })
  })

  it("accepts a reference bound to an object the SAME operation list adds", () => {
    // References are stripped before the operations run and stamped back
    // afterwards. Judging them first would refuse this pair — which is exactly
    // what the authoring prompt asks the model to produce.
    const result = applyScene3DEditWithReferences({
      plan: PLAN,
      operations: [
        {
          op: "add-object",
          object: {
            id: "car", name: "Car", primitive: "box", dimensions: [4.5, 1.4, 1.8],
            position: [3, 0.7, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#224466",
          },
        },
      ],
      references: [{ id: "r1", url: IMG, kind: "image", role: "appearance", objectId: "car" }],
    })
    expect(result.ok).toBe(true)
  })

  it("refuses a reference bound to an object the edit removes", () => {
    const result = applyScene3DEditWithReferences({
      plan: { ...PLAN, references: [{ id: "r1", url: IMG, kind: "image", role: "appearance", objectId: "hero" }] },
      operations: [{ op: "remove-object", objectId: "hero" }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_plan")
    expect(result.message).toContain("unknown object")
  })

  it("still refuses a stale revision and a locked object", () => {
    const stale = applyScene3DEditWithReferences({
      plan: PLAN,
      operations: bg,
      expectedRevisionId: "99999999-2222-4333-8444-555555555555",
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.code).toBe("stale_revision")

    const locked = applyScene3DEditWithReferences({
      plan: PLAN,
      operations: [{ op: "remove-object", objectId: "hero" }],
      lockedObjectIds: ["hero"],
    })
    expect(locked.ok).toBe(false)
    if (!locked.ok) expect(locked.code).toBe("locked_object")
  })

  it("is what the deterministic lane runs — same references, same result", () => {
    const args = {
      plan: PLAN,
      operations: bg,
      references: [{ id: "r1", url: IMG, kind: "image" as const, role: "appearance" as const }],
      revisionId: "22222222-2222-4333-8444-555555555555",
    }
    expect(applyDeterministicScene3DEdit(args)).toEqual(applyScene3DEditWithReferences(args))
  })
})
