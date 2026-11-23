import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { startPro3DRender, edit3DScene, generate3DScene } from "../api"

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

/** The two requests of one quote-then-run, in the order sent. */
function quoteAndRun(f: ReturnType<typeof mockFetchJson>) {
  const at = (index: number) => ({
    url: f.mock.calls[index][0] as string,
    init: f.mock.calls[index][1] as RequestInit,
    body: JSON.parse((f.mock.calls[index][1] as RequestInit).body as string) as Record<string, unknown>,
  })
  return { quote: at(0), run: at(1) }
}

describe("startPro3DRender", () => {
  it("prices the request at the quote route without a quoteId, and hands the quote over", async () => {
    const fetchMock = mockFetchJson({ quoteId: "quote-1", maxCredits: 900, jobId: "pro-job" })
    vi.stubGlobal("fetch", fetchMock)
    const quotes: number[] = []

    await startPro3DRender({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar" },
      durationSeconds: 30, aspectRatio: "21:9", maxRepairPasses: 1,
    }, "pro3d-retry-token-1", (quote) => quotes.push(quote.maxCredits))

    const { quote } = quoteAndRun(fetchMock)
    expect(quote.url).toContain("/v1/pro-3d-render/quote")
    expect(quote.body).toMatchObject({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar" },
      durationSeconds: 30, aspectRatio: "21:9", maxRepairPasses: 1,
    })
    expect(quote.body.quoteId).toBeUndefined()
    expect(quotes).toEqual([900])
  })

  it("submits the quoted body with its quoteId and an Idempotency-Key", async () => {
    const fetchMock = mockFetchJson({ quoteId: "quote-1", maxCredits: 900, jobId: "pro-job" })
    vi.stubGlobal("fetch", fetchMock)

    const started = await startPro3DRender({ source: { kind: "prompt", prompt: "x" } }, "pro3d-retry-token-1")

    const { quote, run } = quoteAndRun(fetchMock)
    expect(run.url).toContain("/v1/pro-3d-render")
    expect(run.url).not.toContain("/quote")
    expect(run.body).toEqual({ ...quote.body, quoteId: "quote-1" })
    expect((run.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("pro3d-retry-token-1")
    expect((quote.init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined()
    expect(started.jobId).toBe("pro-job")
  })

  it("keeps a render-only scene source render-only on the wire", async () => {
    const fetchMock = mockFetchJson({ quoteId: "quote-1", maxCredits: 900, jobId: "pro-job" })
    vi.stubGlobal("fetch", fetchMock)

    await startPro3DRender(
      { source: { kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" } },
      "pro3d-retry-token-1",
    )

    const source = quoteAndRun(fetchMock).run.body.source as Record<string, unknown>
    expect(source).toEqual({ kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" })
    // Absence IS the request. Serializing an empty string here would buy the
    // user a paid authoring pass they did not ask for.
    expect("editPrompt" in source).toBe(false)
  })
})
