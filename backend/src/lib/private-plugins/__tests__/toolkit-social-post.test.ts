/**
 * The hardened social-post lane on the plugin toolkit: a plugin reaches it
 * only through `downloadSocialPostVideo`. The plain `downloadYouTubeVideo`
 * member drops the host-internal `hardening` option (raw yt-dlp arguments
 * among them), whatever a plugin passes. Both downloads refuse the running
 * job's account while its imports are blocked or it is closed, before
 * anything is fetched; outside a job there is no account to ask.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const yt = vi.hoisted(() => ({
  downloadYouTubeVideo: vi.fn(async () => undefined),
  downloadSocialPostVideo: vi.fn(async () => undefined),
  assertImportsAllowed: vi.fn(async (_userId: string): Promise<void> => undefined),
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
vi.mock("@/lib/account-measures.js", () => ({ assertImportsAllowed: yt.assertImportsAllowed }))

import { buildToolkit } from "../toolkit.js"
import { runWithJobCancellation } from "../../job-cancellation.js"
import { AccountMeasureError } from "../../account-measure-error.js"

const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const OWNER = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  yt.assertImportsAllowed.mockImplementation(async () => undefined)
})

describe("tk.providers.downloadYouTubeVideo", () => {
  it("never passes a plugin's hardening on to the host", async () => {
    const tk = buildToolkit()
    const opts = {
      url: URL_,
      outPath: "/tmp/x.mp4",
      hardening: { extraArgs: ["--exec", "touch /tmp/pwned"], env: {}, totalTimeoutMs: 1 },
    }
    await (tk.providers.downloadYouTubeVideo as (o: typeof opts) => Promise<void>)(opts)
    const [passed] = yt.downloadYouTubeVideo.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(passed).toEqual({ url: opts.url, outPath: opts.outPath })
    expect(passed).not.toHaveProperty("hardening")
  })
})

describe("a plugin's download and the account's measures", () => {
  const download = (tk: ReturnType<typeof buildToolkit>) => (tk.providers.downloadYouTubeVideo as (o: { url: string; outPath: string }) => Promise<void>)({ url: URL_, outPath: "/tmp/x.mp4" })
  const socialPost = (tk: ReturnType<typeof buildToolkit>) => (tk.providers.downloadSocialPostVideo as (...args: unknown[]) => Promise<void>)({ url: URL_, outPath: "/tmp/y.mp4" })

  it("refuses the running job's account while its imports are blocked, before anything is fetched", async () => {
    const tk = buildToolkit()
    yt.assertImportsAllowed.mockRejectedValue(new AccountMeasureError(null, "imports_blocked"))
    await runWithJobCancellation("job-1", OWNER, async () => {
      await expect(download(tk)).rejects.toBeInstanceOf(AccountMeasureError)
      await expect(socialPost(tk)).rejects.toBeInstanceOf(AccountMeasureError)
    })
    expect(yt.assertImportsAllowed).toHaveBeenCalledWith(OWNER)
    expect(yt.downloadYouTubeVideo).not.toHaveBeenCalled()
    expect(yt.downloadSocialPostVideo).not.toHaveBeenCalled()
  })

  it("lets an account with nothing in force download", async () => {
    const tk = buildToolkit()
    await runWithJobCancellation("job-1", OWNER, async () => {
      await download(tk)
      await socialPost(tk)
    })
    expect(yt.assertImportsAllowed).toHaveBeenCalledTimes(2)
    expect(yt.downloadYouTubeVideo).toHaveBeenCalledTimes(1)
    expect(yt.downloadSocialPostVideo).toHaveBeenCalledTimes(1)
  })

  it("outside a job there is no account to ask", async () => {
    const tk = buildToolkit()
    await download(tk)
    expect(yt.assertImportsAllowed).not.toHaveBeenCalled()
    expect(yt.downloadYouTubeVideo).toHaveBeenCalledTimes(1)
  })
})
