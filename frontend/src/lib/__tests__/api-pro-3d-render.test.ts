import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { proRender3D, quotePro3DRender, edit3DScene, generate3DScene } from "../api"

/**
 * The browser's half of quote-then-run.
 *
 * Two things the canvas cannot get wrong without a user paying for it: the
 * SOURCE must reach the server exactly as built (a render-only scene source
 * keeps its absent `editPrompt`), and the run must carry a retry token so a
 * resubmitted submit of the most expensive operation on the platform is not a
 * second charge.
 */
function mockFetchJson(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

const lastCall = (f: ReturnType<typeof mockFetchJson>) => ({
  url: f.mock.calls[0][0] as string,
  init: f.mock.calls[0][1] as RequestInit,
  body: JSON.parse((f.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>,
})

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "token" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("Advanced authoring transport", () => {
  it("sends a retained v2 edit to the selected engine with its revision and locks", async () => {
    const fetchMock = mockFetchJson({ jobId: "edit-job" })
    vi.stubGlobal("fetch", fetchMock)
    const scenePlan = { planType: "3d-scene", schemaVersion: 2, revisionId: "retained" }
    await edit3DScene({ engine: "blender-cloud", acceptedSceneSchemaVersions: [1, 2], scenePlan, expectedRevisionId: "retained", prompt: "Move", lockedObjectIds: ["subject"] })
    expect(lastCall(fetchMock).body).toMatchObject({ engine: "blender-cloud", scenePlan, expectedRevisionId: "retained", lockedObjectIds: ["subject"], acceptedSceneSchemaVersions: [1, 2] })
  })

  it("keeps the explicitly selected engine on a generation", async () => {
    const fetchMock = mockFetchJson({ jobId: "generate-job" })
    vi.stubGlobal("fetch", fetchMock)
    await generate3DScene({ engine: "blender-cloud", acceptedSceneSchemaVersions: [1, 2], prompt: "An airport" })
    expect(lastCall(fetchMock).body).toMatchObject({ engine: "blender-cloud", acceptedSceneSchemaVersions: [1, 2], prompt: "An airport" })
  })
})

describe("quotePro3DRender", () => {
  it("prices the request at the quote route without a quoteId", async () => {
    const fetchMock = mockFetchJson({ quoteId: "quote-1", maxCredits: 900 })
    vi.stubGlobal("fetch", fetchMock)

    const quote = await quotePro3DRender({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar" },
      durationSeconds: 30, aspectRatio: "21:9", maxRepairPasses: 1,
    })

    const call = lastCall(fetchMock)
    expect(call.url).toContain("/v1/pro-3d-render/quote")
    expect(call.body).toMatchObject({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar" },
      durationSeconds: 30, aspectRatio: "21:9", maxRepairPasses: 1,
    })
    expect(call.body.quoteId).toBeUndefined()
    expect(quote.maxCredits).toBe(900)
  })
})

describe("proRender3D", () => {
  it("submits the quoted body with an Idempotency-Key", async () => {
    const fetchMock = mockFetchJson({ jobId: "pro-job" })
    vi.stubGlobal("fetch", fetchMock)

    await proRender3D(
      { source: { kind: "prompt", prompt: "x" }, quoteId: "quote-1" },
      "pro3d-retry-token-1",
    )

    const call = lastCall(fetchMock)
    expect(call.url).toContain("/v1/pro-3d-render")
    expect(call.url).not.toContain("/quote")
    expect(call.body.quoteId).toBe("quote-1")
    expect((call.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("pro3d-retry-token-1")
  })

  it("keeps a render-only scene source render-only on the wire", async () => {
    const fetchMock = mockFetchJson({ jobId: "pro-job" })
    vi.stubGlobal("fetch", fetchMock)

    await proRender3D(
      { source: { kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" }, quoteId: "quote-1" },
      "pro3d-retry-token-1",
    )

    const source = lastCall(fetchMock).body.source as Record<string, unknown>
    expect(source).toEqual({ kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" })
    // Absence IS the request. Serializing an empty string here would buy the
    // user a paid authoring pass they did not ask for.
    expect("editPrompt" in source).toBe(false)
  })
})
