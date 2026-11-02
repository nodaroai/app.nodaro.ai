/**
 * The worker's audio download (`downloadAudioToR2`) is an import of a link:
 * the gate reads first and nothing is fetched on a refusal; the confirmation
 * is spent right before yt-dlp runs, never before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  runYtDlpOptions: vi.fn(),
  requireImportAllowed: vi.fn(),
  spendImportConfirmation: vi.fn(),
}))

vi.mock("@/providers/video/ytdlp-options-run.js", () => ({ runYtDlpOptions: mocks.runYtDlpOptions }))
vi.mock("@/lib/import-gate.js", () => ({
  requireImportAllowed: mocks.requireImportAllowed,
  spendImportConfirmation: mocks.spendImportConfirmation,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/storage.js", () => ({
  uploadToR2: vi.fn(),
  uploadFileToR2: vi.fn(),
  uploadBufferToR2: vi.fn(),
  uploadFileWithKeyToR2: vi.fn(),
  getR2ObjectSize: vi.fn(),
}))
vi.mock("@/lib/job-scratch.js", () => ({ uploadJobScratchFile: vi.fn() }))

import { downloadAudioToR2 } from "../download-audio.js"
import { importRightsOf } from "../shared.js"

const URL_ = "https://www.youtube.com/watch?v=abc"
const rights = { userId: "u1", confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01", lane: "route" as const, requestId: "job-1", via: null, appId: null, authorizationId: null }

class Refusal extends Error {
  readonly code = "import_source_disabled"
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
})

describe("importRightsOf", () => {
  it("is the job's owner, the confirmation its route put in the job data and the job id as the request; a job with no owner matches no confirmation", () => {
    expect(importRightsOf({ data: { youtubeUrl: URL_, confirmationId: rights.confirmationId } }, { jobId: "job-1", jobUserId: "u1" })).toEqual(rights)
    expect(importRightsOf({ data: { youtubeUrl: URL_ } }, { jobId: "job-1", jobUserId: "u1" })).toEqual({ userId: "u1", confirmationId: null, lane: "route", requestId: "job-1", via: null, appId: null, authorizationId: null })
    expect(importRightsOf({ data: { confirmationId: 7 } }, { jobId: "job-2", jobUserId: undefined })).toEqual({ userId: "", confirmationId: null, lane: "route", requestId: "job-2", via: null, appId: null, authorizationId: null })
  })

  it("carries the way in, and the connected app and grant, the route put in the job data, so a key's, an app's or an agent's job stands on the standing authorization", () => {
    expect(importRightsOf({ data: { youtubeUrl: URL_, importVia: "mcp" } }, { jobId: "job-1", jobUserId: "u1" })).toMatchObject({ via: "mcp" })
    expect(importRightsOf({ data: { youtubeUrl: URL_, importVia: "app", importAppId: "app-1", importAuthorizationId: "grant-1" } }, { jobId: "job-1", jobUserId: "u1" })).toMatchObject({ via: "app", appId: "app-1", authorizationId: "grant-1" })
    expect(importRightsOf({ data: { youtubeUrl: URL_, importVia: "nonsense", importAppId: 7 } }, { jobId: "job-1", jobUserId: "u1" })).toMatchObject({ via: null, appId: null })
  })
})

describe("downloadAudioToR2", () => {
  it("a refusal by the gate is the gate's own error, and fetches nothing and spends nothing", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Refusal("This link can't be imported here."))
    await expect(downloadAudioToR2(URL_, rights)).rejects.toBeInstanceOf(Refusal)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(URL_, rights)
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(mocks.runYtDlpOptions).not.toHaveBeenCalled()
  })

  it("spends the confirmation right before yt-dlp runs; a spent one fetches nothing", async () => {
    mocks.runYtDlpOptions.mockRejectedValueOnce(new Error("yt-dlp failed"))
    await expect(downloadAudioToR2(URL_, rights)).rejects.toThrow("yt-dlp failed")
    expect(mocks.spendImportConfirmation).toHaveBeenCalledWith(URL_, rights)
    expect(mocks.spendImportConfirmation.mock.invocationCallOrder[0]).toBeLessThan(mocks.runYtDlpOptions.mock.invocationCallOrder[0]!)

    mocks.spendImportConfirmation.mockRejectedValueOnce(new Refusal("Used already"))
    await expect(downloadAudioToR2(URL_, rights)).rejects.toBeInstanceOf(Refusal)
    expect(mocks.runYtDlpOptions).toHaveBeenCalledTimes(1)
  })
})
