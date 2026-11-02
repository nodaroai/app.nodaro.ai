/**
 * POST /v1/youtube-audio (routes/youtube-audio.ts) is an import of a link: it
 * needs a signed-in account, the gate reads before yt-dlp is asked (a refusal
 * is 403 with the gate's code and message, nothing fetched), and the
 * confirmation is spent right before the fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  runYtDlpOptions: vi.fn(),
  requireImportAllowed: vi.fn(),
  spendImportConfirmation: vi.fn(),
}))

vi.mock("@/providers/video/ytdlp-options-run.js", () => ({ runYtDlpOptions: mocks.runYtDlpOptions }))
vi.mock("@/lib/storage.js", () => ({ uploadFileWithKeyToR2: vi.fn(), uploadBufferToR2: vi.fn() }))
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: mocks.requireImportAllowed,
  spendImportConfirmation: mocks.spendImportConfirmation,
}))

import { youtubeAudioRoutes } from "../youtube-audio.js"

class Refusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const USER = "00000000-0000-4000-8000-000000000001"
const URL_ = "https://www.youtube.com/watch?v=abc"
const ID = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(youtubeAudioRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>, user: string | null = USER) =>
  app.inject({ method: "POST", url: "/v1/youtube-audio", headers: user ? { "x-user-id": user } : {}, payload })

describe("POST /v1/youtube-audio", () => {
  it("needs a signed-in account and a video link", async () => {
    expect((await post({ url: URL_ }, null)).statusCode).toBe(401)
    expect((await post({ url: "https://example.com/not-a-video" })).statusCode).toBe(400)
    expect((await post({ url: URL_, confirmationId: "nope" })).statusCode).toBe(400)
    expect(mocks.runYtDlpOptions).not.toHaveBeenCalled()
  })

  it("a refusal by the gate is 403 with its code and message, and nothing is fetched or spent", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Refusal("import_source_disabled", "This link can't be imported here."))
    const res = await post({ url: URL_, confirmationId: ID })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "import_source_disabled", message: "This link can't be imported here." })
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(URL_, expect.objectContaining({ userId: USER, confirmationId: ID, lane: "route" }))
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(mocks.runYtDlpOptions).not.toHaveBeenCalled()
  })

  it("spends the confirmation right before yt-dlp runs; a spent one is 403 and fetches nothing", async () => {
    mocks.runYtDlpOptions.mockRejectedValueOnce(new Error("yt-dlp failed"))
    const failed = await post({ url: URL_, confirmationId: ID })
    expect(failed.statusCode).toBe(500)
    expect(mocks.spendImportConfirmation).toHaveBeenCalledWith(URL_, expect.objectContaining({ confirmationId: ID, lane: "route" }))
    expect(mocks.spendImportConfirmation.mock.invocationCallOrder[0]).toBeLessThan(mocks.runYtDlpOptions.mock.invocationCallOrder[0]!)

    mocks.spendImportConfirmation.mockRejectedValueOnce(new Refusal("rights_confirmation_used", "Used already"))
    const raced = await post({ url: URL_, confirmationId: ID })
    expect(raced.statusCode).toBe(403)
    expect(raced.json().error.code).toBe("rights_confirmation_used")
    expect(mocks.runYtDlpOptions).toHaveBeenCalledTimes(1)
  })
})
