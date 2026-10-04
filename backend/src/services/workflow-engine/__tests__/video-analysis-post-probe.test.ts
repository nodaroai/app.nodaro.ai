/**
 * Video Analysis given a post's link: the orchestrator reads the post's
 * length before anything is reserved — so the run is priced by the post's
 * bucket, not the 600 s ceiling — and refuses a live or over-long post free.
 * A probe that fails refuses nothing (the ceiling prices the run), answers are
 * cached, a few probes run at once, and nothing is probed where no credits
 * are charged.
 */
import { describe, it, expect, vi } from "vitest"
import {
  POST_NO_VIDEO_MESSAGE,
  POST_UNREADABLE_MESSAGE,
  POST_VIDEO_EXPIRED_MESSAGE,
  videoAnalysisPostDuration,
  type PostProbeDeps,
} from "../video-analysis-post-probe.js"
import type { SimpleNode } from "../types.js"

vi.mock("../../../lib/queue.js", () => ({ redis: { get: vi.fn(), set: vi.fn() } }))

const REEL = "https://www.instagram.com/reel/Cabcdefghij/"
const va = (data: Record<string, unknown>): SimpleNode => ({ id: "va", type: "video-analysis", data })
const probeOf = (meta: { durationSec: number | null; title?: string | null; isLive?: boolean }) =>
  vi.fn(async () => ({ title: null, isLive: false, ...meta }))

/** An in-memory cache and the real rules, with the probe given. */
function deps(probe: PostProbeDeps["probe"], over: Partial<PostProbeDeps> = {}): PostProbeDeps {
  const store = new Map<string, string>()
  return {
    probe,
    probeFile: vi.fn(async () => {
      throw new Error("no file in this test")
    }),
    cache: { get: async (key) => store.get(key) ?? null, set: async (key, value) => store.set(key, value) },
    enabled: () => true,
    ...over,
  }
}

describe("videoAnalysisPostDuration", () => {
  it("probes a post link and answers its length in whole seconds", async () => {
    const probe = probeOf({ durationSec: 41.2 })
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probe))).toBe(42)
    expect(probe).toHaveBeenCalledWith(REEL)
  })

  it("probes a YouTube post by its plain watch link", async () => {
    const probe = probeOf({ durationSec: 30 })
    await videoAnalysisPostDuration(va({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ?si=x" }), {}, deps(probe))
    expect(probe).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  })

  it("probes a post link wired into the video input, before the node's own field", async () => {
    const probe = probeOf({ durationSec: 20 })
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }), { videoPageUrl: REEL }, deps(probe))).toBe(20)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(REEL)
  })

  it("leaves alone: a wired or typed video file, a length the run already knows, a link that is not a post, another node", async () => {
    const probe = probeOf({ durationSec: 30 })
    const d = deps(probe)
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), { videoUrl: "https://cdn.example.com/a.mp4" }, d)).toBeNull()
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL, videoUrl: "https://cdn.example.com/a.mp4" }), {}, d)).toBeNull()
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), { videoDuration: 12 }, d)).toBeNull()
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: "https://www.instagram.com/someone/" }), {}, d)).toBeNull()
    expect(await videoAnalysisPostDuration({ id: "x", type: "llm-chat", data: { youtubeUrl: REEL } }, {}, d)).toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })

  describe("a Social Search post's own video file", () => {
    const FILE = "https://scontent-sjc6-1.cdninstagram.com/o1/v/t2/clip.mp4?oh=00_sig&oe=6AC3520E"
    const fromPost = { videoUrl: FILE, videoFromSocialPost: true } as const

    it("reads the length from the file itself, not from the post", async () => {
      const probe = probeOf({ durationSec: 30 })
      const probeFile = vi.fn(async () => 26.8)
      expect(await videoAnalysisPostDuration(va({}), fromPost, deps(probe, { probeFile }))).toBe(27)
      expect(probeFile).toHaveBeenCalledWith(FILE)
      expect(probe).not.toHaveBeenCalled()
    })

    it("refuses a file past the ceiling, and one it cannot read — never priced at the ceiling", async () => {
      await expect(videoAnalysisPostDuration(va({}), fromPost, deps(probeOf({ durationSec: 1 }), { probeFile: async () => 1200 }))).rejects.toMatchObject({
        errorCode: "video_too_long",
      })
      const unreadable = vi.fn(async () => {
        throw new Error("HTTP 403")
      })
      await expect(videoAnalysisPostDuration(va({}), fromPost, deps(probeOf({ durationSec: 1 }), { probeFile: unreadable }))).rejects.toMatchObject({
        errorCode: "post_video_unreadable",
        message: POST_UNREADABLE_MESSAGE,
      })
    })

    it("answers the same file from its cache, and reads nothing where no credits are charged", async () => {
      const probeFile = vi.fn(async () => 40)
      const d = deps(probeOf({ durationSec: 1 }), { probeFile })
      await videoAnalysisPostDuration(va({}), fromPost, d)
      expect(await videoAnalysisPostDuration(va({}), fromPost, d)).toBe(40)
      expect(probeFile).toHaveBeenCalledTimes(1)
      const off = vi.fn(async () => 40)
      expect(await videoAnalysisPostDuration(va({}), fromPost, deps(probeOf({ durationSec: 1 }), { probeFile: off, enabled: () => false }))).toBeNull()
      expect(off).not.toHaveBeenCalled()
    })
  })

  describe("a Social Search post's page (no file came with it)", () => {
    const fromSearch = { videoPageUrl: REEL, videoPageFromSocialPost: true } as const

    it("is priced by the page's length when the page says it", async () => {
      expect(await videoAnalysisPostDuration(va({}), fromSearch, deps(probeOf({ durationSec: 41.2 })))).toBe(42)
    })

    it("is refused, free, when the page gives no length or cannot be read — never priced at the ceiling", async () => {
      await expect(videoAnalysisPostDuration(va({}), fromSearch, deps(probeOf({ durationSec: null })))).rejects.toMatchObject({
        errorCode: "post_video_unreadable",
      })
      const failing = vi.fn(async () => {
        throw new Error("login required")
      })
      await expect(videoAnalysisPostDuration(va({}), fromSearch, deps(failing))).rejects.toMatchObject({ errorCode: "post_video_unreadable" })
    })
  })

  it("refuses a Social Search post with no video — by name, charged or not", async () => {
    for (const enabled of [() => true, () => false]) {
      await expect(videoAnalysisPostDuration(va({}), { socialPostNoVideo: true }, deps(probeOf({ durationSec: 30 }), { enabled }))).rejects.toMatchObject({
        errorCode: "post_has_no_video",
        message: POST_NO_VIDEO_MESSAGE,
      })
    }
  })

  it("refuses a Social Search post whose video link has expired — by name, charged or not", async () => {
    const probe = probeOf({ durationSec: 30 })
    for (const enabled of [() => true, () => false]) {
      await expect(videoAnalysisPostDuration(va({}), { socialPostVideoExpired: true }, deps(probe, { enabled }))).rejects.toMatchObject({
        errorCode: "post_video_expired",
        message: POST_VIDEO_EXPIRED_MESSAGE,
      })
    }
    expect(probe).not.toHaveBeenCalled()
  })

  it("probes nothing where no credits are charged", async () => {
    const probe = probeOf({ durationSec: 30 })
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probe, { enabled: () => false }))).toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })

  it("probes on the server even when the editor sent a length for the link (that one is the person's to write)", async () => {
    const probe = probeOf({ durationSec: 500 })
    const link = "https://youtu.be/dQw4w9WgXcQ"
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: link, probedYoutube: { url: link, durationSec: 12 } }), {}, deps(probe))).toBe(500)
  })

  it("refuses a live post and an over-long one, each with its code", async () => {
    await expect(videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probeOf({ durationSec: null, isLive: true })))).rejects.toMatchObject({
      errorCode: "live_stream_not_supported",
    })
    await expect(videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probeOf({ durationSec: 1200 })))).rejects.toMatchObject({
      errorCode: "video_too_long",
    })
  })

  it("a probe that fails refuses nothing: the ceiling prices the run, or the editor's own read of the same link", async () => {
    const failing = vi.fn(async () => {
      throw new Error("HTTP Error 429: Too Many Requests")
    })
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(failing))).toBeNull()
    const link = "https://youtu.be/dQw4w9WgXcQ"
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: link, probedYoutube: { url: link, durationSec: 212.4 } }), {}, deps(failing))).toBe(213)
  })

  it("the editor's read stands in only for YouTube, the one platform it reads", async () => {
    const failing = vi.fn(async () => {
      throw new Error("timed out")
    })
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL, probedYoutube: { url: REEL, durationSec: 5 } }), {}, deps(failing))).toBeNull()
  })

  it("a post that does not say its length falls back to the ceiling (no refusal)", async () => {
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probeOf({ durationSec: null })))).toBeNull()
  })

  it("answers a link it probed a moment ago from its cache", async () => {
    const probe = probeOf({ durationSec: 41.2 })
    const d = deps(probe)
    await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, d)
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, d)).toBe(42)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("a cache that cannot answer is a miss, never a failure — however it fails", async () => {
    const probe = probeOf({ durationSec: 20 })
    const broken = { get: async () => { throw new Error("redis down") }, set: async () => { throw new Error("redis down") } }
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probe, { cache: broken }))).toBe(20)
    const throwing = { get: (): Promise<string | null> => { throw new Error("no client") }, set: (): Promise<unknown> => { throw new Error("no client") } }
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probe, { cache: throwing }))).toBe(20)
  })

  it("a cache that does not answer is given half a second", async () => {
    vi.useFakeTimers()
    try {
      const probe = probeOf({ durationSec: 20 })
      const hanging = { get: () => new Promise<string | null>(() => {}), set: () => new Promise<unknown>(() => {}) }
      const run = videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probe, { cache: hanging }))
      // Read, read again inside the slot, write: half a second each, never more.
      await vi.advanceTimersByTimeAsync(1_600)
      expect(await run).toBe(20)
      expect(probe).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("asks the cache again once it has a slot (another process may have probed the post meanwhile)", async () => {
    const probe = probeOf({ durationSec: 99 })
    const answers = [null, JSON.stringify({ durationSec: 7, title: null, isLive: false })]
    const cache = { get: async () => answers.shift() ?? null, set: async () => "OK" }
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, deps(probe, { cache }))).toBe(7)
    expect(probe).not.toHaveBeenCalled()
  })

  it("one probe per link at a time: a second run for the same post shares the first's answer", async () => {
    let release: () => void = () => {}
    const probe = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { durationSec: 33, title: null, isLive: false }
    })
    const d = deps(probe)
    const first = videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, d)
    const second = videoAnalysisPostDuration(va({ youtubeUrl: REEL }), {}, d)
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    expect(await Promise.all([first, second])).toEqual([33, 33])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("a probe that fails gives its slot back", async () => {
    const failing = vi.fn(async () => {
      throw new Error("blocked")
    })
    const d = deps(failing)
    const links = Array.from({ length: 6 }, (_, i) => `https://www.instagram.com/reel/Cfailing${i}xx/`)
    expect(await Promise.all(links.map((link) => videoAnalysisPostDuration(va({ youtubeUrl: link }), {}, d)))).toEqual(links.map(() => null))
    const after = probeOf({ durationSec: 9 })
    expect(await videoAnalysisPostDuration(va({ youtubeUrl: "https://www.instagram.com/reel/Cafterxxxxx/" }), {}, deps(after))).toBe(9)
  })

  it("waiting more than ten seconds for a slot prices the run at the ceiling", async () => {
    vi.useFakeTimers()
    try {
      const releases: Array<() => void> = []
      const hold = vi.fn(async () => {
        await new Promise<void>((resolve) => releases.push(resolve))
        return { durationSec: 10, title: null, isLive: false }
      })
      const d = deps(hold)
      const busy = Array.from({ length: 4 }, (_, i) => videoAnalysisPostDuration(va({ youtubeUrl: `https://www.instagram.com/reel/Cbusy${i}xxxx/` }), {}, d))
      await vi.advanceTimersByTimeAsync(0)
      const late = videoAnalysisPostDuration(va({ youtubeUrl: "https://www.instagram.com/reel/Clatexxxxxx/" }), {}, d)
      await vi.advanceTimersByTimeAsync(10_001)
      expect(await late).toBeNull()
      expect(hold).toHaveBeenCalledTimes(4)
      for (const release of releases) release()
      await vi.advanceTimersByTimeAsync(0)
      expect(await Promise.all(busy)).toEqual([10, 10, 10, 10])
    } finally {
      vi.useRealTimers()
    }
  })

  it("runs at most four probes at once", async () => {
    let running = 0
    let peak = 0
    const releases: Array<() => void> = []
    const probe = vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise<void>((resolve) => releases.push(resolve))
      running--
      return { durationSec: 10, title: null, isLive: false }
    })
    const d = deps(probe)
    const runs = Array.from({ length: 7 }, (_, i) => videoAnalysisPostDuration(va({ youtubeUrl: `https://www.instagram.com/reel/Cabcdefgh${i}j/` }), {}, d))
    for (let round = 0; round < 7; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      releases.shift()?.()
    }
    await Promise.all(runs)
    expect(probe).toHaveBeenCalledTimes(7)
    expect(peak).toBe(4)
  })
})

describe("the orchestrator", () => {
  it("probes a Video Analysis post link before any job row or reservation, and prices by it", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(__dirname, "..", "node-executor.ts"), "utf8")
    const probeAt = src.indexOf("await videoAnalysisPostDuration(node, resolvedInputs)")
    const insertAt = src.indexOf('insertInternalJob("orchestrator"')
    expect(probeAt).toBeGreaterThan(0)
    expect(insertAt).toBeGreaterThan(probeAt)
    expect(src).toContain("resolvedInputs = { ...resolvedInputs, videoDuration: postDurationSec }")
  })
})
