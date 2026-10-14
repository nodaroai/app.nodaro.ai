import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { Scene3DPlan } from "@nodaro/shared/scene3d"

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
  it("named helpers preserve the same authoring, revision and render-only requests", async () => {
    const { client, fetchMock } = setup()
    await client.scene3d.capabilities()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/3d-scene/capabilities")
    await client.scene3d.generate({ prompt: "Orbit a car", engine: "blender-cloud", acceptedSceneSchemaVersions: [2] })
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/3d-scene/generate")
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({ engine: "blender-cloud", acceptedSceneSchemaVersions: [2] })
    await client.scene3d.edit({ scenePlan: scene, expectedRevisionId: scene.revisionId, prompt: "Move it left" })
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.example.com/v1/3d-scene/edit")
    await client.scene3d.render({ planType: "3d-scene", plan: scene })
    expect(fetchMock.mock.calls[3][0]).toBe("https://api.example.com/v1/render-video/plan")
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

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

/**
 * A refused authoring run's retained recipe.
 *
 * The one output such a run has. Its recipe never compiled, so there is no revision, no poster
 * and no `.blend`, and the delivery is the only thing that resolves. Until the descriptor was
 * listed and its bytes served, `validation.sourceRetained: true` on the failed row pointed at
 * something the SDK could not fetch.
 */
describe("retained recipe of a refused run", () => {
  const RECIPE = { format: "scene3d-refused-recipe", version: 1, recipe: { header: { frameStart: 0 } } }

  function deliverySetup(assets: unknown[]) {
    const bytes = new TextEncoder().encode(JSON.stringify(RECIPE))
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/assets/")
        ? new Response(bytes, { status: 200, headers: { "content-type": "application/json" } })
        : ({ ok: true, status: 200, json: async () => ({
            deliveryId: "job-1", sceneRevisionId: null, sourceKind: "refused-authoring",
            sourcePlanSha256: null, sourceContentHash: null, sourceJobId: "job-1",
            workflowId: null, mode: "authored", createdAt: "2026-09-14T00:00:00Z",
            access: "own", assets,
          }) }),
    )
    const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"),
      fetch: fetchMock as unknown as typeof fetch })
    return { client, fetchMock, bytes }
  }

  const recipeAsset = (byteLength: number) => ({ assetId: "recipe-1", kind: "source-json",
    usage: "checkpoint", byteLength, sha256: "a".repeat(64), viaRevisionId: null })

  it("fetches and parses the recipe the delivery lists", async () => {
    const recipeBytes = new TextEncoder().encode(JSON.stringify(RECIPE)).byteLength
    const { client, fetchMock } = deliverySetup([
      { assetId: "report-1", kind: "validation-report", usage: "validation", byteLength: 12, sha256: "b".repeat(64), viaRevisionId: null },
      recipeAsset(recipeBytes),
    ])
    await expect(client.scene3d.retainedRecipe("job-1")).resolves.toEqual(RECIPE)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/3d-scene/deliveries/job-1")
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/3d-scene/deliveries/job-1/assets/recipe-1")
  })

  it("answers null — never throws — when the delivery lists no recipe", async () => {
    // Two causes, one answer: no pass ever cleared admission, or this caller holds less than
    // `edit` and the server did not list the descriptor for them.
    const { client } = deliverySetup([
      { assetId: "report-1", kind: "validation-report", usage: "validation", byteLength: 12, sha256: "b".repeat(64), viaRevisionId: null },
    ])
    await expect(client.scene3d.retainedRecipe("job-1")).resolves.toBeNull()
  })

  it("serves a shot still through the delivery guard, which used to refuse it", async () => {
    // Drive-by: the route has served `shot-still` bytes since stills existed, and this guard
    // only ever admitted a poster or a report.
    const { client, bytes } = deliverySetup([])
    await expect(client.scene3d.deliveryAssetBytes("job-1", { assetId: "still-1", kind: "shot-still",
      usage: "shot-still", byteLength: bytes.byteLength, sha256: "c".repeat(64), viaRevisionId: null,
      shotIndex: 0, frame: 0 })).resolves.toBeInstanceOf(ArrayBuffer)
  })

  it("still refuses a descriptor whose usage does not match its kind", () => {
    const { client } = deliverySetup([])
    expect(() => client.scene3d.deliveryAssetBytes("job-1", { assetId: "recipe-1",
      kind: "source-json", usage: "poster" as "checkpoint", byteLength: 10, sha256: "a".repeat(64),
      viaRevisionId: null })).toThrow(/not available/)
  })
})
