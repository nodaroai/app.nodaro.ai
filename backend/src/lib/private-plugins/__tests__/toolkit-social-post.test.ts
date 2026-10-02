/**
 * The hardened social-post lane on the plugin toolkit: a plugin reaches it
 * only through `downloadSocialPostVideo`. The plain `downloadYouTubeVideo`
 * member drops the host-internal `hardening` option (raw yt-dlp arguments
 * among them), whatever a plugin passes.
 */
import { describe, it, expect, vi } from "vitest"

const yt = vi.hoisted(() => ({ downloadYouTubeVideo: vi.fn(async () => undefined) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/providers/video/youtube-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/youtube-video.js")>()),
  downloadYouTubeVideo: yt.downloadYouTubeVideo,
}))

import { buildToolkit } from "../toolkit.js"

describe("tk.providers.downloadYouTubeVideo", () => {
  it("never passes a plugin's hardening on to the host", async () => {
    const tk = buildToolkit()
    const opts = {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      outPath: "/tmp/x.mp4",
      hardening: { extraArgs: ["--exec", "touch /tmp/pwned"], env: {}, totalTimeoutMs: 1 },
    }
    await (tk.providers.downloadYouTubeVideo as (o: typeof opts) => Promise<void>)(opts)
    const [passed] = yt.downloadYouTubeVideo.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(passed).toEqual({ url: opts.url, outPath: opts.outPath })
    expect(passed).not.toHaveProperty("hardening")
  })
})
