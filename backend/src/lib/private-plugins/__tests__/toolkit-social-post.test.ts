/**
 * A plugin's own downloads of a link, as the toolkit hands them over
 * (`toolkit-downloads.ts`). A plugin reaches the hardened social-post lane
 * only through `downloadSocialPostVideo`; the plain `downloadYouTubeVideo`
 * member drops the host-internal `hardening` option (raw yt-dlp arguments
 * among them), whatever a plugin passes. Before anything is fetched:
 *  - a link the runner itself would refuse is refused before the gate, so it
 *    never uses up the person's confirmation;
 *  - in a job, the gate is read and then spent with the job's owner, the job
 *    as the request, the plugin's confirmation and no way in (a plugin's job
 *    carries none), and the confirmation never reaches the runner;
 *  - outside any job, the accountless gate decides (the site's policy and the
 *    deployment's rule), and nothing is spent.
 * The gate's own decisions are the gate's tests (import-gate.test.ts); here
 * it is mocked, so these tests prove what the toolkit hands it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const yt = vi.hoisted(() => ({
  steps: [] as string[],
  downloadYouTubeVideo: vi.fn(async (_opts: Record<string, unknown>): Promise<void> => undefined),
  downloadSocialPostVideo: vi.fn(async (_opts: Record<string, unknown>): Promise<void> => undefined),
  requireImportAllowed: vi.fn(async (_url: string, _rights: Record<string, unknown>): Promise<void> => undefined),
  spendImportConfirmation: vi.fn(async (_url: string, _rights: Record<string, unknown>): Promise<string | null> => null),
  requireAccountlessImportAllowed: vi.fn(async (_url: string, _lane: string): Promise<void> => undefined),
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/providers/video/youtube-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/youtube-video.js")>()),
  downloadYouTubeVideo: yt.downloadYouTubeVideo,
}))
vi.mock("@/providers/video/social-post-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/social-post-video.js")>()),
  downloadSocialPostVideo: yt.downloadSocialPostVideo,
}))
vi.mock("@/lib/import-gate.js", () => ({
  requireImportAllowed: yt.requireImportAllowed,
  spendImportConfirmation: yt.spendImportConfirmation,
  requireAccountlessImportAllowed: yt.requireAccountlessImportAllowed,
}))

import { buildToolkit } from "../toolkit.js"
import { runWithJobCancellation } from "../../job-cancellation.js"
import { AccountMeasureError } from "../../account-measure-error.js"
import { YtUrlNotAllowedError } from "../../../providers/video/youtube-video.js"

const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const OWNER = "11111111-1111-4111-8111-111111111111"
const CONFIRMATION = "22222222-2222-4222-8222-222222222222"

type Download = (opts: Record<string, unknown>) => Promise<void>
const plain = (tk: ReturnType<typeof buildToolkit>) => tk.providers.downloadYouTubeVideo as unknown as Download
const socialPost = (tk: ReturnType<typeof buildToolkit>) => tk.providers.downloadSocialPostVideo as unknown as Download

beforeEach(() => {
  vi.clearAllMocks()
  yt.steps.length = 0
  yt.requireImportAllowed.mockImplementation(async () => { yt.steps.push("read") })
  yt.spendImportConfirmation.mockImplementation(async () => { yt.steps.push("spend"); return null })
  yt.requireAccountlessImportAllowed.mockImplementation(async () => { yt.steps.push("accountless") })
  yt.downloadYouTubeVideo.mockImplementation(async () => { yt.steps.push("fetch") })
  yt.downloadSocialPostVideo.mockImplementation(async () => { yt.steps.push("fetch") })
})

const rightsFor = (confirmationId: string | null, userId = OWNER) => ({
  userId,
  confirmationId,
  lane: "plugin",
  requestId: "job-1",
  via: null,
})

describe("tk.providers.downloadYouTubeVideo", () => {
  it("never passes a plugin's hardening, or its confirmation, on to the runner", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", OWNER, async () => {
      await plain(tk)({
        url: URL_,
        outPath: "/tmp/x.mp4",
        confirmationId: CONFIRMATION,
        hardening: { extraArgs: ["--exec", "touch /tmp/pwned"], env: {}, totalTimeoutMs: 1 },
      })
    })
    expect(yt.downloadYouTubeVideo.mock.calls[0]![0]).toEqual({ url: URL_, outPath: "/tmp/x.mp4" })
  })

  it("hands the gate the job's owner, the job as the request, the confirmation and no way in: read, then spend, then fetch", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", OWNER, async () => {
      await plain(tk)({ url: URL_, outPath: "/tmp/x.mp4", confirmationId: CONFIRMATION })
    })
    expect(yt.requireImportAllowed).toHaveBeenCalledWith(URL_, rightsFor(CONFIRMATION))
    expect(yt.spendImportConfirmation).toHaveBeenCalledWith(URL_, rightsFor(CONFIRMATION))
    expect(yt.steps).toEqual(["read", "spend", "fetch"])
  })

  it("a link the runner would refuse is refused before the gate, so no confirmation is used up", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", OWNER, async () => {
      await expect(plain(tk)({ url: "https://example.com/a-page", outPath: "/tmp/x.mp4", confirmationId: CONFIRMATION })).rejects.toBeInstanceOf(YtUrlNotAllowedError)
    })
    expect(yt.requireImportAllowed).not.toHaveBeenCalled()
    expect(yt.spendImportConfirmation).not.toHaveBeenCalled()
    expect(yt.downloadYouTubeVideo).not.toHaveBeenCalled()
  })
})

describe("tk.providers.downloadSocialPostVideo", () => {
  it("hands the gate the same rights, and the runner the options without the confirmation", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", OWNER, async () => {
      await socialPost(tk)({ url: URL_, outPath: "/tmp/y.mp4", maxDurationSec: 60, confirmationId: CONFIRMATION })
    })
    expect(yt.requireImportAllowed).toHaveBeenCalledWith(URL_, rightsFor(CONFIRMATION))
    expect(yt.spendImportConfirmation).toHaveBeenCalledWith(URL_, rightsFor(CONFIRMATION))
    expect(yt.steps).toEqual(["read", "spend", "fetch"])
    expect(yt.downloadSocialPostVideo.mock.calls[0]![0]).toEqual({ url: URL_, outPath: "/tmp/y.mp4", maxDurationSec: 60 })
  })

  it("a link that is not one post this lane reads is refused before the gate", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", OWNER, async () => {
      await expect(socialPost(tk)({ url: "https://www.youtube.com/@someone", outPath: "/tmp/y.mp4", maxDurationSec: 60, confirmationId: CONFIRMATION })).rejects.toBeInstanceOf(YtUrlNotAllowedError)
    })
    expect(yt.requireImportAllowed).not.toHaveBeenCalled()
    expect(yt.spendImportConfirmation).not.toHaveBeenCalled()
    expect(yt.downloadSocialPostVideo).not.toHaveBeenCalled()
  })
})

describe("a plugin's download and the import gate", () => {
  it("without a confirmation the gate is handed none, and no way in stands for a standing authorization", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", OWNER, async () => {
      await plain(tk)({ url: URL_, outPath: "/tmp/x.mp4" })
      await socialPost(tk)({ url: URL_, outPath: "/tmp/y.mp4", maxDurationSec: 60 })
    })
    expect(yt.requireImportAllowed.mock.calls.map((c) => c[1])).toEqual([rightsFor(null), rightsFor(null)])
    expect(yt.spendImportConfirmation.mock.calls.map((c) => c[1])).toEqual([rightsFor(null), rightsFor(null)])
  })

  it("in a job whose owner could not be read the gate is handed no account (it refuses that outright)", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", undefined, async () => {
      await plain(tk)({ url: URL_, outPath: "/tmp/x.mp4", confirmationId: CONFIRMATION })
    })
    expect(yt.requireImportAllowed).toHaveBeenCalledWith(URL_, rightsFor(CONFIRMATION, ""))
    expect(yt.requireAccountlessImportAllowed).not.toHaveBeenCalled()
  })

  it("a refusal of the read fetches nothing and spends nothing", async () => {
    const tk = buildToolkit()
    yt.requireImportAllowed.mockRejectedValue(new AccountMeasureError(null, "imports_blocked"))
    await runWithJobCancellation("job-1", OWNER, async () => {
      await expect(plain(tk)({ url: URL_, outPath: "/tmp/x.mp4" })).rejects.toBeInstanceOf(AccountMeasureError)
      await expect(socialPost(tk)({ url: URL_, outPath: "/tmp/y.mp4", maxDurationSec: 60 })).rejects.toBeInstanceOf(AccountMeasureError)
    })
    expect(yt.spendImportConfirmation).not.toHaveBeenCalled()
    expect(yt.downloadYouTubeVideo).not.toHaveBeenCalled()
    expect(yt.downloadSocialPostVideo).not.toHaveBeenCalled()
  })

  it("a refusal at the spend (a measure placed meanwhile) fetches nothing", async () => {
    const tk = buildToolkit()
    yt.spendImportConfirmation.mockRejectedValue(new AccountMeasureError(null, "closed"))
    await runWithJobCancellation("job-1", OWNER, async () => {
      await expect(plain(tk)({ url: URL_, outPath: "/tmp/x.mp4", confirmationId: CONFIRMATION })).rejects.toBeInstanceOf(AccountMeasureError)
    })
    expect(yt.downloadYouTubeVideo).not.toHaveBeenCalled()
  })

  it("outside any job the accountless gate decides, for the plugin lane, and nothing is spent", async () => {
    const tk = buildToolkit()
    await plain(tk)({ url: URL_, outPath: "/tmp/x.mp4", confirmationId: CONFIRMATION })
    expect(yt.requireAccountlessImportAllowed).toHaveBeenCalledWith(URL_, "plugin")
    expect(yt.requireImportAllowed).not.toHaveBeenCalled()
    expect(yt.spendImportConfirmation).not.toHaveBeenCalled()
    expect(yt.steps).toEqual(["accountless", "fetch"])
  })

  it("outside any job a refusal by the accountless gate fetches nothing", async () => {
    const tk = buildToolkit()
    yt.requireAccountlessImportAllowed.mockRejectedValue(new AccountMeasureError(null, "imports_blocked"))
    await expect(socialPost(tk)({ url: URL_, outPath: "/tmp/y.mp4", maxDurationSec: 60 })).rejects.toBeInstanceOf(AccountMeasureError)
    expect(yt.downloadSocialPostVideo).not.toHaveBeenCalled()
  })
})
