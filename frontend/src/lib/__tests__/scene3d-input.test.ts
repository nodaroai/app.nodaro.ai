import { describe, expect, it } from "vitest"
import { resolveScene3DAuthoringEngine } from "@nodaro/shared"
import { scene3DEditInput } from "../scene3d/scene-input"
import { restoreContextPatch, scene3DRunContext } from "../scene3d/revisions"

describe("scene input shared by edit controls and canvas execution", () => {
  it("restores immutable input selectors without sharing mutable history state", () => {
    const inputAssets = [{ id: "vehicle", revisionId: "00000000-0000-4000-8000-000000000010",
      assetId: "00000000-0000-4000-8000-000000000011" }]
    const context = scene3DRunContext({ engine: "blender-cloud", inputAssets }, "Drive", [], undefined)
    const restored = restoreContextPatch(context, "scenePrompt")
    expect(restored.inputAssets).toEqual(inputAssets)
    inputAssets[0].id = "changed"
    expect(context.inputAssets?.[0].id).toBe("vehicle")
    expect(restoreContextPatch(scene3DRunContext({ inputAssets: [] }, "Empty", [], undefined), "scenePrompt"))
      .toMatchObject({ inputAssets: [] })
    expect(restoreContextPatch({}, "scenePrompt")).not.toHaveProperty("inputAssets")
  })
  const old = { planType: "3d-scene", schemaVersion: 1, revisionId: "old" }
  const baked = Object.freeze({ planType: "3d-scene", schemaVersion: 2, revisionId: "new", provenance: { engine: "blender-cloud" } })
  const nodes = [{ id: "pro", type: "pro-3d-render", data: { scenePlan: baked } }]

  it("uses the wired v2 revision and selects Advanced over an older own v1 result", () => {
    const input = scene3DEditInput("edit", old, nodes, [{ source: "pro", target: "edit", targetHandle: "scene" }])
    expect(input).toBe(baked)
    expect(resolveScene3DAuthoringEngine({ plan: input, availableEngines: ["blender-cloud"] })).toMatchObject({ lane: "advanced", engine: "blender-cloud" })
  })

  it("does not treat a Pro video reference as the scene under edit", () => {
    expect(scene3DEditInput("edit", old, nodes, [{ source: "pro", target: "edit", targetHandle: "references" }])).toBe(old)
  })

  it("keeps explicit Basic selection as an actionable refusal for a v2 source", () => {
    const input = scene3DEditInput("edit", baked, [], [])
    expect(resolveScene3DAuthoringEngine({ plan: input, requested: "basic" })).toMatchObject({ ok: false, code: "schema_requires_advanced" })
  })

  it.each(["basic", "blender-cloud", "blender-local"])("restores the recorded %s engine with its revision", (engine) => {
    const context = scene3DRunContext({ engine }, "Move the camera", [], "base")
    expect(restoreContextPatch(context, "editPrompt")).toMatchObject({ engine, editPrompt: "Move the camera" })
  })
})
