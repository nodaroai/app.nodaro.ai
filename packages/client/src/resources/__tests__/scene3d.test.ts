import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { Scene3DPlan } from "@nodaro/shared"

const scene = {
  planType: "3d-scene", schemaVersion: 1,
  revisionId: "c94b9f2f-4f10-48a6-a0bf-3ca4c2653b5a",
  width: 854, height: 480, fps: 24, durationInFrames: 96,
  backgroundColor: "#eeeeee",
  camera: { position: [0, 2, 8], target: [0, 0, 0], focalLengthMm: 42, sensorWidthMm: 36 },
  lighting: { ambientIntensity: 1, keyIntensity: 2, keyPosition: [3, 5, 4] },
  objects: [{ id: "box", name: "Box", primitive: "box", dimensions: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc3333" }],
} as Scene3DPlan

function setup() {
  const fetchMock = vi.fn(async (_url: string, init: { method?: string }) => ({
    ok: true, status: 200,
    json: async () => init.method === "POST" ? { jobId: "scene-job" }
      : { data: { id: "scene-job", status: "completed", progress: 100, output_data: { scenePlan: scene } } },
  }))
  const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("test"), fetch: fetchMock as unknown as typeof fetch })
  return { client, fetchMock }
}

describe("3D scene node transport", () => {
  it("runs generation through the authoring route and preserves reference roles", async () => {
    const { client, fetchMock } = setup()
    const references = [{ id: "product", kind: "image" as const, role: "appearance" as const, url: "https://example.com/product.png" }]
    const result = await client.nodes.runAndWait("generate-3d-scene", { prompt: "Orbit the product", references, durationSeconds: 4 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/3d-scene/generate")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ prompt: "Orbit the product", references })
    expectTypeOf(result.scenePlan).toEqualTypeOf<Scene3DPlan>()
    expect(result.scenePlan.revisionId).toBe(scene.revisionId)
  })

  it("forwards deterministic edits and their base revision without losing operations", async () => {
    const { client, fetchMock } = setup()
    const operations = [{ op: "set-object" as const, objectId: "box", changes: { position: [1, 0, 0] as [number, number, number] } }]
    await client.nodes.run("edit-3d-scene", { scenePlan: scene, expectedRevisionId: scene.revisionId, operations, lockedObjectIds: [] })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/3d-scene/edit")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ scenePlan: scene, expectedRevisionId: scene.revisionId, operations })
  })

  it("dispatches typed 3D plans to composition rendering and preserves legacy renders", async () => {
    const { client, fetchMock } = setup()
    await client.nodes.run("render-video", { planType: "3d-scene", plan: scene })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/render-video/plan")
    await client.nodes.run("render-video", { template: "slideshow", mediaAssets: [] })
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/render-video")
  })
})
