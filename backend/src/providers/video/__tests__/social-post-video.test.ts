/**
 * The hardened social-post lane: only one post on a platform we read is ever
 * fetched (a YouTube link rebuilt as its plain watch link), yt-dlp is held to
 * that platform's extractors (never the generic one) and to one video, live
 * streams and over-long videos stop before the download, the probe runs held
 * the same way through the download's own proxy chain, and the child process
 * never sees the server's secrets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const yt = vi.hoisted(() => ({
  downloadYouTubeVideo: vi.fn(async () => undefined),
  runYtDlpCapture: vi.fn(async () => JSON.stringify({ duration: 31.5, title: "a reel", is_live: false })),
}))
vi.mock("../youtube-video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../youtube-video.js")>()),
  downloadYouTubeVideo: yt.downloadYouTubeVideo,
  runYtDlpCapture: yt.runYtDlpCapture,
}))
const api = vi.hoisted(() => ({ ytDataApiProbe: vi.fn(async () => null as null | { durationSec: number; title: string; isLive: boolean }) }))
vi.mock("../youtube-data-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../youtube-data-api.js")>()),
  ytDataApiProbe: api.ytDataApiProbe,
}))
const chain = vi.hoisted(() => ({ attempts: [null] as Array<string | null> }))
vi.mock("../yt-proxy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../yt-proxy.js")>()),
  resolveAttemptChain: () => chain.attempts,
}))

import { SOCIAL_VIDEO_HOSTS } from "../../../lib/url-validator.js"
import { YtUrlNotAllowedError } from "../youtube-video.js"
import { YtDlpHaltError } from "../ytdlp-process.js"
import {
  SOCIAL_HOSTS_COVERED,
  SOCIAL_POST_MAX_BYTES,
  downloadSocialPostVideo,
  probeSocialPostVideo,
  socialPostArgs,
  socialPostOf,
  ytDlpChildEnv,
} from "../social-post-video.js"

beforeEach(() => {
  vi.clearAllMocks()
  chain.attempts = [null]
  api.ytDataApiProbe.mockResolvedValue(null)
  yt.runYtDlpCapture.mockResolvedValue(JSON.stringify({ duration: 31.5, title: "a reel", is_live: false }))
})

describe("socialPostOf — one post on a platform we read, nothing else", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://www.tiktok.com/@someone/video/7300000000000000000", "tiktok"],
    ["https://vm.tiktok.com/ZMabcdef/", "tiktok"],
    ["https://vt.tiktok.com/ZSabcdef/", "tiktok"],
    ["https://www.tiktok.com/t/ZTabcdef/", "tiktok"],
    ["https://www.instagram.com/reel/Cabcdefghij/", "instagram"],
    ["https://www.instagram.com/p/Cabcdefghij/", "instagram"],
    ["https://www.instagram.com/reels/Cabcdefghij/", "instagram"],
    ["https://x.com/someone/status/1800000000000000000", "x"],
    ["https://twitter.com/someone/status/1800000000000000000", "x"],
    ["https://x.com/i/status/1800000000000000000", "x"],
    ["https://www.facebook.com/watch/?v=1234567890", "facebook"],
    ["https://www.facebook.com/reel/1234567890", "facebook"],
    ["https://www.facebook.com/someone/videos/1234567890/", "facebook"],
  ])("reads %s as a %s post", (link, platform) => {
    expect(socialPostOf(link)?.platform).toBe(platform)
  })

  it.each([
    ["https://youtu.be/dQw4w9WgXcQ?si=share"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456&index=2"],
  ])("rebuilds the YouTube link %s as its plain watch link", (link) => {
    expect(socialPostOf(link)?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  })

  it.each([
    ["a channel", "https://www.youtube.com/@somechannel/videos"],
    ["a playlist", "https://www.youtube.com/playlist?list=PL123456"],
    ["a YouTube id that is not one", "https://youtu.be/abc123"],
    ["a profile", "https://www.tiktok.com/@someone"],
    ["a photo post", "https://www.tiktok.com/@someone/photo/7300000000000000000"],
    ["an Instagram profile", "https://www.instagram.com/someone/"],
    ["a story", "https://www.instagram.com/stories/someone/3300000000000000000/"],
    ["an X profile", "https://x.com/someone"],
    ["a Facebook share short link", "https://www.facebook.com/share/v/AbCdEf/"],
    ["an fb.watch short link", "https://fb.watch/abcDEF123/"],
    ["another host", "https://example.com/watch?v=dQw4w9WgXcQ"],
    ["a look-alike host", "https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ"],
    ["credentials in the link", "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a port", "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ"],
    ["another scheme", "file:///etc/passwd"],
    ["not a link", "dQw4w9WgXcQ"],
  ])("refuses %s", (_label, link) => {
    expect(socialPostOf(link)).toBeNull()
  })

  it("has a rule, or a stated reason for none, for every social host", () => {
    expect([...SOCIAL_HOSTS_COVERED].sort()).toEqual([...SOCIAL_VIDEO_HOSTS].sort())
  })
})

describe("socialPostArgs — the platform's own extractors, one video, inside the length cap", () => {
  it("names the extractors exactly, never the generic one, reads one video and stops a live or over-long one", () => {
    const args = socialPostArgs("tiktok", 600)
    expect(args).toContain("--ignore-config")
    expect(args[args.indexOf("--use-extractors") + 1]).toBe("TikTok,vm.tiktok")
    expect(args.join(" ")).not.toMatch(/generic|default|\ball\b/)
    expect(args[args.indexOf("--playlist-items") + 1]).toBe("1")
    expect(args[args.indexOf("--break-match-filters") + 1]).toBe("!is_live & duration <=? 600")
  })
})

describe("ytDlpChildEnv — yt-dlp never sees the server's secrets", () => {
  it("keeps what it needs to run and nothing else", () => {
    const env = ytDlpChildEnv({ PATH: "/usr/bin", HOME: "/home/app", SUPABASE_SERVICE_ROLE_KEY: "secret", KIE_API_KEY: "secret", YTDLP_PROXY_POOL: "http://u:p@proxy" })
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/app", LANG: "C.UTF-8" })
  })
})

describe("the fetch", () => {
  it("refuses a link that is not a post before anything spawns", async () => {
    await expect(downloadSocialPostVideo({ url: "https://www.tiktok.com/@someone", outPath: "/tmp/x.mp4", maxDurationSec: 600 })).rejects.toBeInstanceOf(YtUrlNotAllowedError)
    await expect(probeSocialPostVideo("https://fb.watch/abc/")).rejects.toBeInstanceOf(YtUrlNotAllowedError)
    expect(yt.downloadYouTubeVideo).not.toHaveBeenCalled()
    expect(yt.runYtDlpCapture).not.toHaveBeenCalled()
  })

  it("downloads a post through the hardened lane: its extractors, the cap, a minimal environment, one deadline", async () => {
    await downloadSocialPostVideo({ url: "https://www.instagram.com/reel/Cabcdefghij/", outPath: "/tmp/x.mp4", maxDurationSec: 180, maxFilesizeBytes: 200 * 1024 * 1024 })
    const [opts] = yt.downloadYouTubeVideo.mock.calls[0] as unknown as [{ maxFilesizeBytes: number; hardening: { extraArgs: string[]; env: Record<string, string>; totalTimeoutMs: number } }]
    expect(opts.hardening.extraArgs).toEqual(socialPostArgs("instagram", 180))
    expect(Object.keys(opts.hardening.env).sort()).toEqual(Object.keys(ytDlpChildEnv()).sort())
    expect(opts.hardening.totalTimeoutMs).toBeGreaterThan(0)
    expect(opts.maxFilesizeBytes).toBe(200 * 1024 * 1024)
  })

  it("caps the size even when the caller names no cap, or a larger one", async () => {
    await downloadSocialPostVideo({ url: "https://www.instagram.com/reel/Cabcdefghij/", outPath: "/tmp/x.mp4", maxDurationSec: 180 })
    await downloadSocialPostVideo({ url: "https://www.instagram.com/reel/Cabcdefghij/", outPath: "/tmp/x.mp4", maxDurationSec: 180, maxFilesizeBytes: 50 * 1024 * 1024 * 1024 })
    for (const [opts] of yt.downloadYouTubeVideo.mock.calls as unknown as Array<[{ maxFilesizeBytes: number }]>) {
      expect(opts.maxFilesizeBytes).toBe(SOCIAL_POST_MAX_BYTES)
    }
  })

  it("downloads a YouTube post by its plain watch link", async () => {
    await downloadSocialPostVideo({ url: "https://youtu.be/dQw4w9WgXcQ?list=PL1", outPath: "/tmp/x.mp4", maxDurationSec: 180 })
    const [opts] = yt.downloadYouTubeVideo.mock.calls[0] as unknown as [{ url: string }]
    expect(opts.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  })
})

describe("the probe", () => {
  it("prints three fields for one video, with its extractors, a minimal environment and one deadline", async () => {
    expect(await probeSocialPostVideo("https://www.tiktok.com/@someone/video/7300000000000000000")).toEqual({ durationSec: 31.5, title: "a reel", isLive: false })
    const [args, opts] = yt.runYtDlpCapture.mock.calls[0] as unknown as [string[], { env: Record<string, string>; totalTimeoutMs: number; maxBytes: number }]
    expect(args[args.indexOf("--use-extractors") + 1]).toBe("TikTok,vm.tiktok")
    expect(args[args.indexOf("--playlist-items") + 1]).toBe("1")
    expect(args[args.indexOf("--print") + 1]).toBe("%(.{duration,is_live,title})j")
    expect(args).not.toContain("--dump-json")
    expect(args).toContain("--skip-download")
    expect(args).toContain("--ignore-no-formats-error")
    expect(opts.env).toEqual(ytDlpChildEnv())
    expect(opts.totalTimeoutMs).toBeGreaterThan(0)
    expect(opts.maxBytes).toBeLessThanOrEqual(64 * 1024)
  })

  it.each([
    ["a warning before the answer", 'WARNING: [TikTok] slow\n{"duration": 12, "is_live": false, "title": "t"}\n', { durationSec: 12, title: "t", isLive: false }],
    ["fields the page does not state", '{"duration": "NA", "is_live": "NA", "title": "NA"}\n', { durationSec: null, title: "NA", isLive: false }],
    ["an empty answer object", "{}\n", { durationSec: null, title: null, isLive: false }],
    ["a live post", '{"duration": null, "is_live": true, "title": "live"}', { durationSec: null, title: "live", isLive: true }],
  ])("reads %s", async (_label, printed, expected) => {
    yt.runYtDlpCapture.mockResolvedValue(printed)
    expect(await probeSocialPostVideo("https://www.tiktok.com/@someone/video/7300000000000000000")).toEqual(expected)
  })

  it("an answer that is not one fails the probe (the caller prices at the ceiling)", async () => {
    yt.runYtDlpCapture.mockResolvedValue("NA\n")
    await expect(probeSocialPostVideo("https://www.tiktok.com/@someone/video/7300000000000000000")).rejects.toThrow(/no answer/)
  })

  it("asks YouTube's API first, and spawns nothing when it answers", async () => {
    api.ytDataApiProbe.mockResolvedValue({ durationSec: 42, title: "a short", isLive: false })
    expect(await probeSocialPostVideo("https://youtu.be/dQw4w9WgXcQ")).toEqual({ durationSec: 42, title: "a short", isLive: false })
    expect(api.ytDataApiProbe).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ", expect.anything())
    expect(yt.runYtDlpCapture).not.toHaveBeenCalled()
  })

  it("without an API answer, probes YouTube held like any post: its extractor, the plain link, a minimal environment", async () => {
    await probeSocialPostVideo("https://youtu.be/dQw4w9WgXcQ")
    const [args, opts] = yt.runYtDlpCapture.mock.calls[0] as unknown as [string[], { env: Record<string, string> }]
    expect(args[args.indexOf("--use-extractors") + 1]).toBe("youtube")
    expect(args.at(-1)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(opts.env).toEqual(ytDlpChildEnv())
  })

  it("tries the download's own proxy chain in turn", async () => {
    chain.attempts = [null, "http://proxy-a.example:8080"]
    yt.runYtDlpCapture.mockRejectedValueOnce(new Error("HTTP Error 429: Too Many Requests"))
    expect(await probeSocialPostVideo("https://www.instagram.com/reel/Cabcdefghij/")).toMatchObject({ durationSec: 31.5 })
    const second = yt.runYtDlpCapture.mock.calls[1] as unknown as [string[]]
    expect(second[0][second[0].indexOf("--proxy") + 1]).toBe("http://proxy-a.example:8080")
  })

  it("stops at a halt — no other proxy is tried", async () => {
    chain.attempts = [null, "http://proxy-a.example:8080"]
    yt.runYtDlpCapture.mockRejectedValueOnce(new YtDlpHaltError("yt-dlp aborted", "aborted"))
    await expect(probeSocialPostVideo("https://www.instagram.com/reel/Cabcdefghij/")).rejects.toBeInstanceOf(YtDlpHaltError)
    expect(yt.runYtDlpCapture).toHaveBeenCalledTimes(1)
  })
})
