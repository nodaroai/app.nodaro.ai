import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { Pro3DRenderShotStill, Scene3DPlan } from "@nodaro/shared"

/**
 * The SDK surface for 3D Render Pro.
 *
 * One operation, so the client's job is to carry the caller's SOURCE to the
 * one pair of routes unchanged and hand back both halves of the settled
 * result. These assert exactly that: the reference set is forwarded (not
 * rewritten, not dropped), a render-only scene source keeps its absent
 * `editPrompt`, quoting precedes running with the identical body, and the run
 * carries an idempotency key so a retried submit is not a second charge.
 */
const VIDEO_URL = "https://r2.example/renders/pro.mp4"
const scene = {
  planType: "3d-scene", schemaVersion: 1,
  revisionId: "c94b9f2f-4f10-48a6-a0bf-3ca4c2653b5a",
  width: 854, height: 480, fps: 24, durationInFrames: 96,
  backgroundColor: "#eeeeee",
  camera: { position: [0, 2, 8], target: [0, 0, 0], focalLengthMm: 42, sensorWidthMm: 36 },
  lighting: { ambientIntensity: 1, keyIntensity: 2, keyPosition: [3, 5, 4] },
  objects: [{ id: "box", name: "Box", primitive: "box", dimensions: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc3333" }],
} as Scene3DPlan

const OUTPUT = {
  videoUrl: VIDEO_URL,
  scenePlan: scene,
  sceneRevisionId: scene.revisionId,
  posterAssetId: "poster-1",
  shotStills: [
    { shotIndex: 0, frame: 0, assetId: "still-0", url: "https://cdn.example/still-0.png" },
    { shotIndex: 1, frame: 360, assetId: "still-1", url: "https://cdn.example/still-1.png" },
  ],
  validation: { status: "passed", reportAssetId: "report-1", warnings: [] },
  renderer: "three-remotion@1",
  metadata: { width: 1680, height: 720, fps: 24, frames: 720, duration: 30 },
}

function setup() {
  const fetchMock = vi.fn(async (url: string, init: { method?: string }) => ({
    ok: true, status: 200,
    json: async () =>
      init.method === "POST"
        ? url.endsWith("/quote")
          ? { quoteId: "quote-1", expiresAt: "2026-09-08T01:00:00.000Z", maxCredits: 900, breakdown: [{ code: "author", label: "Authoring", credits: 600 }], pricingVersion: "p1", capabilitiesVersion: "c1", normalizedInputHash: "hash-1" }
          : { jobId: "pro-job" }
        : { data: { id: "pro-job", status: "completed", progress: 100, output_data: OUTPUT } },
  }))
  const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("test"), fetch: fetchMock as unknown as typeof fetch })
  return { client, fetchMock }
}

const references = [
  { id: "look", kind: "image" as const, role: "appearance" as const, url: "https://example.com/look.png" },
  { id: "motion", kind: "video" as const, role: "motion" as const, url: "https://example.com/motion.mp4" },
]
const bodyOf = (fetchMock: ReturnType<typeof setup>["fetchMock"], i: number) =>
  JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string) as Record<string, unknown>
const headersOf = (fetchMock: ReturnType<typeof setup>["fetchMock"], i: number) =>
  (fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>

describe("3D Render Pro transport", () => {
  it("preserves selected GLBs and image references in preview and Pro requests", async () => {
    const { client, fetchMock } = setup()
    const inputAssets = [{ id: "vehicle", revisionId: "00000000-0000-4000-8000-000000000010",
      assetId: "00000000-0000-4000-8000-000000000011" }]
    await client.scene3d.generate({ prompt: "Drive", engine: "blender-cloud", inputAssets, references })
    expect(bodyOf(fetchMock, 0)).toMatchObject({ engine: "blender-cloud", inputAssets, references })
    const source = { kind: "prompt" as const, prompt: "Drive", inputAssets, references }
    await client.scene3d.quotePro({ source })
    await client.scene3d.runPro({ source, quoteId: "quote-1" })
    expect(bodyOf(fetchMock, 1).source).toEqual(source)
    expect(bodyOf(fetchMock, 2).source).toEqual(source)
  })
  it("quotes without starting anything", async () => {
    const { client, fetchMock } = setup()
    const quote = await client.scene3d.quotePro({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references },
      durationSeconds: 30, aspectRatio: "21:9", maxRepairPasses: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pro-3d-render/quote")
    expect(bodyOf(fetchMock, 0).source).toEqual({ kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references })
    expect(quote.maxCredits).toBe(900)
    expect(quote.normalizedInputHash).toBe("hash-1")
  })

  it("forwards every reference and control on the run, with a retry key", async () => {
    const { client, fetchMock } = setup()
    await client.scene3d.runPro({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references },
      quoteId: "quote-1", durationSeconds: 30, fps: 24, aspectRatio: "21:9", maxRepairPasses: 1,
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pro-3d-render")
    expect(bodyOf(fetchMock, 0)).toMatchObject({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references },
      quoteId: "quote-1", durationSeconds: 30, fps: 24, aspectRatio: "21:9", maxRepairPasses: 1,
    })
    expect(headersOf(fetchMock, 0)["Idempotency-Key"]).toMatch(/^sdk-pro3d-/)
  })

  it("reuses the caller's key when one is supplied", async () => {
    const { client, fetchMock } = setup()
    await client.scene3d.runPro(
      { source: { kind: "prompt", prompt: "x" }, quoteId: "quote-1" },
      { idempotencyKey: "caller-retry-0001" },
    )
    expect(headersOf(fetchMock, 0)["Idempotency-Key"]).toBe("caller-retry-0001")
  })

  it("quotes then runs the IDENTICAL body when no quoteId is supplied", async () => {
    const { client, fetchMock } = setup()
    await client.scene3d.renderProAndWait({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references },
      aspectRatio: "21:9", durationSeconds: 30,
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pro-3d-render/quote")
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/pro-3d-render")
    const quoteBody = bodyOf(fetchMock, 0)
    const runBody = bodyOf(fetchMock, 1)
    expect(runBody.quoteId).toBe("quote-1")
    expect({ ...runBody, quoteId: undefined }).toEqual({ ...quoteBody, quoteId: undefined })
  })

  it("skips the quote when the caller already has one", async () => {
    const { client, fetchMock } = setup()
    await client.scene3d.renderProAndWait({ source: { kind: "prompt", prompt: "x" }, quoteId: "quote-9" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pro-3d-render")
    expect(bodyOf(fetchMock, 0).quoteId).toBe("quote-9")
  })

  it("keeps a render-only scene source render-only", async () => {
    const { client, fetchMock } = setup()
    await client.scene3d.renderProAndWait({
      source: { kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" },
    })
    const source = bodyOf(fetchMock, 1).source as Record<string, unknown>
    expect(source).toEqual({ kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" })
    expect("editPrompt" in source).toBe(false)
  })

  it("reaches the same route through the generic node runner", async () => {
    const { client, fetchMock } = setup()
    await client.nodes.run("pro-3d-render", { source: { kind: "prompt", prompt: "Orbit the product", references }, quoteId: "quote-1" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pro-3d-render")
    expect(bodyOf(fetchMock, 0)).toMatchObject({ source: { kind: "prompt", prompt: "Orbit the product", references }, quoteId: "quote-1" })
  })

  it("returns the full settled result, typed", async () => {
    const { client } = setup()
    const result = await client.scene3d.renderProAndWait({ source: { kind: "prompt", prompt: "x" } })
    expect(result.videoUrl).toBe(VIDEO_URL)
    expect(result.scenePlan).toEqual(scene)
    expect(result.sceneRevisionId).toBe(scene.revisionId)
    expect(result.posterAssetId).toBe("poster-1")
    // One still per shot, in shot order, with the frame each shot opens on.
    expect(result.shotStills).toEqual(OUTPUT.shotStills)
    expectTypeOf(result.shotStills).toEqualTypeOf<Pro3DRenderShotStill[] | undefined>()
    expect(result.validation.status).toBe("passed")
    expect(result.metadata).toEqual({ width: 1680, height: 720, fps: 24, frames: 720, duration: 30 })
    expectTypeOf(result.videoUrl).toEqualTypeOf<string>()
    expectTypeOf(result.scenePlan).toEqualTypeOf<Scene3DPlan>()
    expectTypeOf(result.renderer).toEqualTypeOf<string>()
  })
})
