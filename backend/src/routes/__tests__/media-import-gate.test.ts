/**
 * The two link-import routes of media (`/v1/media/import-url`,
 * `/v1/media/import-recording`) are engines of the import gate: the gate
 * reads before anything is fetched; the confirmation is spent inside the
 * lib's `beforeFetch` (once the recording import holds its slot, so a 429
 * spends nothing); a refusal is 403 with the gate's code and message and
 * nothing is fetched; the import's end is noted on the confirmation; a
 * failure of the gate that is not a refusal is the server's own error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  importImageFromUrl: vi.fn(),
  importRecordingFromUrl: vi.fn(),
  requireImportAllowed: vi.fn(),
  spendImportConfirmation: vi.fn(),
  recordEvent: vi.fn(),
  fetched: vi.fn(),
}))

vi.mock("@/lib/media-import.js", () => ({ importImageFromUrl: mocks.importImageFromUrl }))
vi.mock("@/lib/media-url-import.js", () => ({ importRecordingFromUrl: mocks.importRecordingFromUrl }))
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: mocks.requireImportAllowed,
  spendImportConfirmation: mocks.spendImportConfirmation,
}))
vi.mock("@/lib/content-rights.js", () => ({ recordEvent: mocks.recordEvent }))

import { mediaImportUrlRoutes } from "../media-import-url.js"
import { mediaUrlImportRoutes } from "../media-url-import.js"

class Refusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const USER = "00000000-0000-4000-8000-000000000001"
const ID = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
let app: FastifyInstance

/** The libs as they are: run `beforeFetch` (the picture lib at once, the recording lib once its slot is held), then fetch. */
function libsThatFetch() {
  mocks.importImageFromUrl.mockImplementation(async (_user: string, _url: string, opts?: { beforeFetch?: () => Promise<void> }) => {
    await opts?.beforeFetch?.()
    mocks.fetched("image")
    return { ok: true, url: "https://pub-test.r2.dev/uploads/images/a.jpg", assetId: "asset-1" }
  })
  mocks.importRecordingFromUrl.mockImplementation(async (_user: string, _url: string, opts?: { beforeFetch?: () => Promise<void> }) => {
    await opts?.beforeFetch?.()
    mocks.fetched("recording")
    return { ok: true, url: "https://pub-test.r2.dev/uploads/audio/a.mp3", assetId: "asset-2" }
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.recordEvent.mockResolvedValue(true)
  libsThatFetch()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(mediaImportUrlRoutes)
  await app.register(mediaUrlImportRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, headers: { "x-user-id": USER }, payload })

describe.each([
  ["/v1/media/import-url", "https://images.example.com/face.jpg", () => mocks.importImageFromUrl],
  ["/v1/media/import-recording", "https://files.example.com/episode.mp3", () => mocks.importRecordingFromUrl],
])("POST %s", (route, link, fetcher) => {
  it("a refusal by the gate is 403 with its code and message, and nothing is fetched or spent", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Refusal("import_source_disabled", "This link can't be imported here."))
    const res = await post(route, { url: link, confirmationId: ID })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "import_source_disabled", message: "This link can't be imported here." })
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(link, expect.objectContaining({ userId: USER, confirmationId: ID, lane: "route" }))
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(fetcher()).not.toHaveBeenCalled()
    expect(mocks.recordEvent).not.toHaveBeenCalled()
  })

  it("reads, then spends right before the fetch, then notes the import's end on the confirmation", async () => {
    const ok = await post(route, { url: link, confirmationId: ID })
    expect(ok.statusCode).toBe(200)
    expect(mocks.spendImportConfirmation).toHaveBeenCalledWith(link, expect.objectContaining({ confirmationId: ID, lane: "route" }))
    expect(mocks.spendImportConfirmation.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetched.mock.invocationCallOrder[0]!)
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ confirmationId: ID, kind: "download_completed", lane: "route" }))
  })

  it("a spent confirmation is 403 and fetches nothing; a failed import is noted as such", async () => {
    mocks.spendImportConfirmation.mockRejectedValueOnce(new Refusal("rights_confirmation_used", "Used already"))
    const raced = await post(route, { url: link, confirmationId: ID })
    expect(raced.statusCode).toBe(403)
    expect(raced.json().error.code).toBe("rights_confirmation_used")
    expect(mocks.fetched).not.toHaveBeenCalled()

    fetcher().mockImplementationOnce(async (_u: string, _l: string, opts?: { beforeFetch?: () => Promise<void> }) => {
      await opts?.beforeFetch?.()
      return { ok: false, status: 422, code: "fetch_failed", message: "The URL responded with HTTP 404" }
    })
    const failed = await post(route, { url: link, confirmationId: ID })
    expect(failed.statusCode).toBe(422)
    expect(mocks.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ confirmationId: ID, kind: "download_failed", detail: { code: "fetch_failed" } }))
  })

  it("a bad confirmation id is refused at the boundary; without one the gate is still asked and nothing is noted", async () => {
    expect((await post(route, { url: link, confirmationId: "nope" })).statusCode).toBe(400)
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    const res = await post(route, { url: link })
    expect(res.statusCode).toBe(200)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(link, expect.objectContaining({ userId: USER, confirmationId: undefined }))
    expect(mocks.recordEvent).not.toHaveBeenCalled()
  })

  it("a failure of the gate that is not a refusal is the server's own error, and nothing is fetched", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Error("[import-source-policy] read failed"))
    const res = await post(route, { url: link, confirmationId: ID })
    expect(res.statusCode).toBe(500)
    expect(fetcher()).not.toHaveBeenCalled()
  })
})

describe("POST /v1/media/import-recording and its slot", () => {
  it("a 429 (no slot) never reaches the fetch: nothing is spent and nothing is noted", async () => {
    mocks.importRecordingFromUrl.mockResolvedValueOnce({ ok: false, status: 429, code: "too_many_imports", message: "Too many imports in progress. Try again shortly." })
    const res = await post("/v1/media/import-recording", { url: "https://files.example.com/episode.mp3", confirmationId: ID })
    expect(res.statusCode).toBe(429)
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(mocks.recordEvent).not.toHaveBeenCalled()
  })
})
