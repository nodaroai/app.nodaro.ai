import { describe, it, expect, vi } from "vitest"
import { fetchVideoLinksForRun, type VideoLinkFetchDeps } from "../video-link-fetch.js"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const TIKTOK = "https://www.tiktok.com/@someone/video/7676964064458738952"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"
const AUDIO = "https://cdn.nodaro.ai/audios/cover-src-1.mp3"

const link = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  type: "youtube-video",
  data: { label: "Episode", youtubeUrl: YT, ...data },
})
const node = (id: string, type: string) => ({ id, type, data: {} as Record<string, unknown> })
const edge = (source: string, target: string) => ({ source, target })

function deps(over: Partial<VideoLinkFetchDeps> = {}): VideoLinkFetchDeps & {
  probe: ReturnType<typeof vi.fn>
  downloadVideo: ReturnType<typeof vi.fn>
  downloadAudio: ReturnType<typeof vi.fn>
} {
  return {
    probe: vi.fn().mockResolvedValue({ durationSec: 120, title: "T", isLive: false }),
    downloadVideo: vi.fn().mockResolvedValue({ videoUrl: FILE, thumbnailUrl: "https://cdn.nodaro.ai/t.png" }),
    downloadAudio: vi.fn().mockResolvedValue(AUDIO),
    ...over,
  } as never
}

const run = (
  nodes: Array<ReturnType<typeof link> | ReturnType<typeof node>>,
  edges: Array<{ source: string; target: string }>,
  d: VideoLinkFetchDeps,
) => fetchVideoLinksForRun({ nodes, edges, userId: "u1" }, d)

describe("fetching a Video URL node's link on the server — the card's rules, before any node that needs the file runs", () => {
  it("a short YouTube video downloads whole at up to 1080 rows, and the file is bound to the link it came from", async () => {
    const d = deps()
    const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
    expect(d.probe).toHaveBeenCalledWith(YT)
    expect(d.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ url: YT, userId: "u1", maxHeight: 1080 }))
    expect(d.downloadVideo.mock.calls[0]![0].section).toBeUndefined()
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error("unreachable")
    const patch = result.patches.get("src")!
    expect(patch.data).toMatchObject({ downloadedVideoUrl: FILE, downloadedFromUrl: YT })
    // Only what the run lock admits is pinned for a continued run (Render final).
    expect(patch.pin).toEqual({ downloadedVideoUrl: FILE, downloadedFromUrl: YT })
  })

  it("another platform downloads whole, with no probe and no quality cap", async () => {
    const d = deps()
    const result = await run([link("src", { youtubeUrl: TIKTOK }), node("va", "video-analysis")], [edge("src", "va")], d)
    expect(d.probe).not.toHaveBeenCalled()
    expect(d.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ url: TIKTOK }))
    expect(d.downloadVideo.mock.calls[0]![0].maxHeight).toBeUndefined()
    expect(result.ok).toBe(true)
  })

  it("a YouTube video of 4 minutes or more is refused before anything runs, naming the length and the way out", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 5530, title: null, isLive: false }) })
    const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
    expect(d.downloadVideo).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, reason: "refused" })
    if (result.ok || result.reason !== "refused") throw new Error("unreachable")
    expect(result.message).toContain('"Episode"')
    expect(result.message).toContain("1:32:10")
    expect(result.message).toContain("sectionStartSec")
  })

  it("exactly 4 minutes is long; an unknown length is long too (an episode is never fetched whole on its own)", async () => {
    for (const durationSec of [240, null]) {
      const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec, title: null, isLive: false }) })
      const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
      expect(result, String(durationSec)).toMatchObject({ ok: false, reason: "refused" })
      expect(d.downloadVideo).not.toHaveBeenCalled()
    }
  })

  it("239 seconds is short", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 239, title: null, isLive: false }) })
    expect((await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)).ok).toBe(true)
  })

  it("the node's own range is the part downloaded, exactly, with no probe — long video or short", async () => {
    const d = deps()
    const result = await run(
      [link("src", { sectionStartSec: 600, sectionEndSec: 1200 }), node("va", "video-analysis")],
      [edge("src", "va")],
      d,
    )
    expect(d.probe).not.toHaveBeenCalled()
    expect(d.downloadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ url: YT, maxHeight: 1080, section: { startSec: 600, endSec: 1200, exact: true } }),
    )
    if (!result.ok) throw new Error("unreachable")
    expect(result.patches.get("src")!.data.downloadedSection).toEqual({ startSec: 600, endSec: 1200 })
  })

  it("a range that is not a range (backwards, negative, not numbers) is not one — the length rule decides", async () => {
    for (const range of [
      { sectionStartSec: 90, sectionEndSec: 30 },
      { sectionStartSec: -5, sectionEndSec: 30 },
      { sectionStartSec: "0", sectionEndSec: "30" },
      { sectionStartSec: 10 },
    ]) {
      const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 5530, title: null, isLive: false }) })
      const result = await run([link("src", range), node("va", "video-analysis")], [edge("src", "va")], d)
      expect(result, JSON.stringify(range)).toMatchObject({ ok: false, reason: "refused" })
    }
  })

  it("a stored 'download it whole' on a long video is not honoured — node data is not trusted to start a long download", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 5530, title: null, isLive: false }) })
    const result = await run([link("src", { downloadMode: "whole" }), node("va", "video-analysis")], [edge("src", "va")], d)
    expect(result).toMatchObject({ ok: false, reason: "refused" })
    expect(d.downloadVideo).not.toHaveBeenCalled()
  })

  it("a live stream cannot be downloaded", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: null, title: null, isLive: true }) })
    const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
    expect(result).toMatchObject({ ok: false, reason: "refused" })
    if (result.ok || result.reason !== "refused") throw new Error("unreachable")
    expect(result.message).toMatch(/live/i)
  })

  it("a failed download refuses the run with the reason, first line only", async () => {
    const d = deps({ downloadVideo: vi.fn().mockRejectedValue(new Error("Video unavailable: this video is private\n  at spawn…")) })
    const result = await run([link("src", { youtubeUrl: TIKTOK }), node("va", "video-analysis")], [edge("src", "va")], d)
    if (result.ok || result.reason !== "refused") throw new Error("unreachable")
    expect(result.message).toContain('"Episode"')
    expect(result.message).toContain("this video is private")
    expect(result.message).not.toContain("at spawn")
  })

  describe("a link SAVED in the workflow is fetched too (decided 2026-10-08), whenever the run needs the file", () => {
    it("a saved post link, with no request in sight, is downloaded for the node that reads the file", async () => {
      const d = deps()
      const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
      expect(d.downloadVideo).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ ok: true })
    })

    it("a saved file that belongs to the saved link is used as it is — nothing is fetched", async () => {
      const d = deps()
      const result = await run(
        [link("src", { downloadedVideoUrl: FILE, downloadedFromUrl: YT }), node("va", "video-analysis")],
        [edge("src", "va")],
        d,
      )
      expect(d.probe).not.toHaveBeenCalled()
      expect(d.downloadVideo).not.toHaveBeenCalled()
      if (!result.ok) throw new Error("unreachable")
      expect(result.patches.size).toBe(0)
    })

    it("a saved file made for ANOTHER link than the one the node holds is not that link's file — it is fetched again", async () => {
      const d = deps()
      await run(
        [link("src", { downloadedVideoUrl: FILE, downloadedFromUrl: TIKTOK }), node("va", "video-analysis")],
        [edge("src", "va")],
        d,
      )
      expect(d.downloadVideo).toHaveBeenCalledTimes(1)
    })

    it("a saved link whose readers are not part of the run is not fetched", async () => {
      const d = deps()
      const result = await fetchVideoLinksForRun(
        { nodes: [link("src"), node("va", "video-analysis")], edges: [edge("src", "va")], scopeIds: [], userId: "u1" },
        d,
      )
      expect(d.downloadVideo).not.toHaveBeenCalled()
      expect(result).toMatchObject({ ok: true })
    })

    it("a saved link that is not a post (a direct file, any other page) is passed through untouched", async () => {
      const d = deps()
      await run([link("src", { youtubeUrl: "https://cdn.example.com/clip.mp4" }), node("va", "video-analysis")], [edge("src", "va")], d)
      expect(d.downloadVideo).not.toHaveBeenCalled()
    })

    it("a saved long YouTube link with no saved part is refused like a requested one", async () => {
      const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 5530, title: null, isLive: false }) })
      const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
      expect(result).toMatchObject({ ok: false, reason: "refused" })
      expect(d.downloadVideo).not.toHaveBeenCalled()
    })

    it("a saved link with a saved part downloads exactly that part", async () => {
      const d = deps()
      await run(
        [link("src", { sectionStartSec: 600, sectionEndSec: 1200 }), node("va", "video-analysis")],
        [edge("src", "va")],
        d,
      )
      expect(d.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ section: { startSec: 600, endSec: 1200, exact: true } }))
    })
  })

  describe("a long or unreadable post video with no part chosen is refused before anything runs or is charged (decided 2026-10-08)", () => {
    it.each([
      ["long", 5530],
      ["unreadable", null],
    ])("a %s video: the message names both ends of the part, and says nothing ran and nothing was charged", async (_name, durationSec) => {
      const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec, title: null, isLive: false }) })
      const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
      if (result.ok || result.reason !== "refused") throw new Error("unreachable")
      expect(result.message).toContain("sectionStartSec")
      expect(result.message).toContain("sectionEndSec")
      expect(result.message).toMatch(/nothing (ran|was run)/i)
      expect(result.message).toMatch(/nothing was charged/i)
      expect(d.downloadVideo).not.toHaveBeenCalled()
    })
  })

  describe("audio only — when every node that reads the link takes its sound or its page address", () => {
    it("Transcribe alone: only the sound is fetched — no probe, no video, no part asked for, however long the video is", async () => {
      const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 99999, title: null, isLive: false }) })
      const result = await run([link("src"), node("tx", "transcribe")], [edge("src", "tx")], d)
      expect(d.probe).not.toHaveBeenCalled()
      expect(d.downloadVideo).not.toHaveBeenCalled()
      expect(d.downloadAudio).toHaveBeenCalledWith(YT, expect.objectContaining({ userId: "u1" }))
      if (!result.ok) throw new Error("unreachable")
      const patch = result.patches.get("src")!
      expect(patch.data).toMatchObject({ downloadedAudioUrl: AUDIO, audioDownloadStatus: "completed" })
      // The audio track is not one of the fields the run lock admits: never pinned.
      expect(patch.pin).toEqual({})
    })

    it("Transcribe beside a node that watches the video: the video is downloaded", async () => {
      const d = deps()
      await run([link("src"), node("tx", "transcribe"), node("va", "video-analysis")], [edge("src", "tx"), edge("src", "va")], d)
      expect(d.downloadVideo).toHaveBeenCalledTimes(1)
      expect(d.downloadAudio).not.toHaveBeenCalled()
    })

    it("only nodes that take the page link (Dubbing, Content Recipe): nothing is fetched", async () => {
      const d = deps()
      const result = await run([link("src"), node("dub", "dubbing"), node("rec", "content-recipe")], [edge("src", "dub"), edge("src", "rec")], d)
      expect(d.downloadVideo).not.toHaveBeenCalled()
      expect(d.downloadAudio).not.toHaveBeenCalled()
      expect(result).toMatchObject({ ok: true })
    })
  })

  describe("what is left alone", () => {
    it("a link that already has its file, a link of a kind that is not downloaded, and an empty node", async () => {
      const d = deps()
      const result = await run(
        [
          link("have", { downloadedVideoUrl: FILE, downloadedFromUrl: YT }),
          link("direct", { youtubeUrl: "https://cdn.example.com/ep.mp4" }),
          link("plain", { youtubeUrl: "https://example.com/stream/ep-12" }),
          link("empty", { youtubeUrl: "" }),
          node("va", "video-analysis"),
        ],
        ["have", "direct", "plain", "empty"].map((id) => edge(id, "va")),
        d,
      )
      expect(d.probe).not.toHaveBeenCalled()
      expect(d.downloadVideo).not.toHaveBeenCalled()
      expect(result).toMatchObject({ ok: true })
      if (!result.ok) throw new Error("unreachable")
      expect(result.patches.size).toBe(0)
    })

    it("a file that belongs to a DIFFERENT link does not count as the file (it is fetched again)", async () => {
      const d = deps()
      await run(
        [link("src", { downloadedVideoUrl: FILE, downloadedFromUrl: "https://youtu.be/otherVideo01" }), node("va", "video-analysis")],
        [edge("src", "va")],
        d,
      )
      expect(d.downloadVideo).toHaveBeenCalledTimes(1)
    })

    it("a link that feeds nothing in the run is not fetched", async () => {
      const d = deps()
      await run([link("src"), node("va", "video-analysis")], [], d)
      expect(d.downloadVideo).not.toHaveBeenCalled()
    })

    it("a host outside the allowlist that merely looks like one is never handed to the downloader", async () => {
      const d = deps()
      const result = await run(
        [link("src", { youtubeUrl: "https://youtube.com.attacker.example/watch?v=aqz-KE-bpKQ" }), node("va", "video-analysis")],
        [edge("src", "va")],
        d,
      )
      expect(d.downloadVideo).not.toHaveBeenCalled()
      expect(result).toMatchObject({ ok: true })
    })
  })

  it("several links are fetched, at most two at a time", async () => {
    let active = 0
    let peak = 0
    const d = deps({
      downloadVideo: vi.fn().mockImplementation(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return { videoUrl: FILE }
      }),
    })
    const ids = ["a", "b", "c", "d"]
    const result = await run(
      [...ids.map((id) => link(id, { youtubeUrl: `${TIKTOK}${id}` })), node("va", "video-analysis")],
      ids.map((id) => edge(id, "va")),
      d,
    )
    expect(result.ok).toBe(true)
    expect(d.downloadVideo).toHaveBeenCalledTimes(4)
    expect(peak).toBe(2)
  })

  it("a refusal of one link stops the others from starting", async () => {
    const d = deps({ downloadVideo: vi.fn().mockRejectedValue(new Error("private")) })
    const ids = ["a", "b", "c", "d"]
    const result = await run(
      [...ids.map((id) => link(id, { youtubeUrl: `${TIKTOK}${id}` })), node("va", "video-analysis")],
      ids.map((id) => edge(id, "va")),
      d,
    )
    expect(result).toMatchObject({ ok: false, reason: "refused" })
    expect(d.downloadVideo.mock.calls.length).toBeLessThan(4)
  })

  it("a stop of the run before it starts fetches nothing and reports a cancel, not a failure", async () => {
    const d = deps()
    const controller = new AbortController()
    controller.abort()
    const result = await fetchVideoLinksForRun(
      { nodes: [link("src"), node("va", "video-analysis")], edges: [edge("src", "va")], userId: "u1", signal: controller.signal },
      d,
    )
    expect(result).toEqual({ ok: false, reason: "cancelled" })
    expect(d.downloadVideo).not.toHaveBeenCalled()
  })

  it("reports each fetch as it starts and ends, for the run's progress", async () => {
    const events: string[] = []
    const d = deps()
    await fetchVideoLinksForRun(
      {
        nodes: [link("src"), node("va", "video-analysis")],
        edges: [edge("src", "va")],
        userId: "u1",
        onFetch: (id, phase) => events.push(`${id}:${phase}`),
      },
      d,
    )
    expect(events).toEqual(["src:start", "src:end"])
  })
})

describe("a file this execution (or the one it continues) already fetched is reused, not fetched again (decided 2026-10-08)", () => {
  const recordedVideo = {
    link: YT,
    data: { downloadedVideoUrl: FILE, downloadedFromUrl: YT, downloadStatus: "completed", downloadedSection: null },
  }
  const withRecord = (nodes: Parameters<typeof run>[0], edges: Parameters<typeof run>[1], d: VideoLinkFetchDeps, recorded: Record<string, unknown>, extra: object = {}) =>
    fetchVideoLinksForRun({ nodes, edges, userId: "u1", recorded: recorded as never, ...extra }, d)

  it("a recorded video for the node's link: nothing is probed or downloaded, and the patch carries the recorded fields", async () => {
    const d = deps()
    const result = await withRecord([link("src"), node("va", "video-analysis")], [edge("src", "va")], d, { src: recordedVideo })
    expect(d.probe).not.toHaveBeenCalled()
    expect(d.downloadVideo).not.toHaveBeenCalled()
    if (!result.ok) throw new Error("unreachable")
    const patch = result.patches.get("src")!
    expect(patch.data).toMatchObject({ downloadedVideoUrl: FILE, downloadedFromUrl: YT, downloadStatus: "completed" })
    expect(patch.link).toBe(YT)
    expect(patch.reused).toBe(true)
    expect(patch.pin).toEqual({ downloadedVideoUrl: FILE, downloadedFromUrl: YT })
  })

  it("a recorded track for the node's link serves a run that only needs the sound", async () => {
    const d = deps()
    const result = await withRecord([link("src"), node("tx", "transcribe")], [edge("src", "tx")], d, {
      src: { link: YT, data: { downloadedAudioUrl: AUDIO, audioDownloadStatus: "completed" } },
    })
    expect(d.downloadAudio).not.toHaveBeenCalled()
    if (!result.ok) throw new Error("unreachable")
    expect(result.patches.get("src")).toMatchObject({ data: { downloadedAudioUrl: AUDIO }, reused: true, pin: {} })
  })

  it("a recorded track does not stand in for the video (and the other way round): the missing half is fetched", async () => {
    const d = deps()
    const result = await withRecord([link("src"), node("va", "video-analysis")], [edge("src", "va")], d, {
      src: { link: YT, data: { downloadedAudioUrl: AUDIO } },
    })
    expect(d.downloadVideo).toHaveBeenCalledTimes(1)
    if (!result.ok) throw new Error("unreachable")
    expect(result.patches.get("src")?.reused).toBeUndefined()
  })

  it("a record made for ANOTHER link is never used — the node's link changed since", async () => {
    const d = deps()
    await withRecord([link("src", { youtubeUrl: TIKTOK }), node("va", "video-analysis")], [edge("src", "va")], d, { src: recordedVideo })
    expect(d.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ url: TIKTOK }))
  })

  it("a recorded file cut for another part is not reused: the continuation asked for a different part", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 5530, title: null, isLive: false }) })
    const recordedPart = { link: YT, data: { ...recordedVideo.data, downloadedSection: { startSec: 600, endSec: 1200 } } }
    // Same part: reused.
    await withRecord([link("src", { sectionStartSec: 600, sectionEndSec: 1200 }), node("va", "video-analysis")], [edge("src", "va")], d, { src: recordedPart })
    expect(d.downloadVideo).not.toHaveBeenCalled()
    // A different part: fetched.
    await withRecord([link("src", { sectionStartSec: 0, sectionEndSec: 300 }), node("va", "video-analysis")], [edge("src", "va")], d, { src: recordedPart })
    expect(d.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ section: { startSec: 0, endSec: 300, exact: true } }))
  })

  it("a whole-video record is not reused for a run that now names a part, nor a cut one for a run that names none", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 120, title: null, isLive: false }) })
    await withRecord([link("src", { sectionStartSec: 10, sectionEndSec: 20 }), node("va", "video-analysis")], [edge("src", "va")], d, { src: recordedVideo })
    expect(d.downloadVideo).toHaveBeenCalledTimes(1)
    d.downloadVideo.mockClear()
    const cut = { link: YT, data: { ...recordedVideo.data, downloadedSection: { startSec: 600, endSec: 1200 } } }
    await withRecord([link("src"), node("va", "video-analysis")], [edge("src", "va")], d, { src: cut })
    expect(d.downloadVideo).toHaveBeenCalledTimes(1)
  })

  it("a fresh fetch reports the link it was made for, so it can be recorded", async () => {
    const d = deps()
    const result = await run([link("src"), node("va", "video-analysis")], [edge("src", "va")], d)
    if (!result.ok) throw new Error("unreachable")
    expect(result.patches.get("src")?.link).toBe(YT)
    expect(result.patches.get("src")?.reused).toBeUndefined()
  })
})

describe("the 'nothing was charged' line is true only for a run that charged nothing before (decided 2026-10-08)", () => {
  const refusedFor = async (extra: object) => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 5530, title: null, isLive: false }) })
    const result = await fetchVideoLinksForRun(
      { nodes: [link("src"), node("va", "video-analysis")], edges: [edge("src", "va")], userId: "u1", ...extra },
      d,
    )
    if (result.ok || result.reason !== "refused") throw new Error("unreachable")
    return result.message
  }

  it("a first run says nothing ran and nothing was charged", async () => {
    expect(await refusedFor({})).toMatch(/nothing ran and nothing was charged/i)
  })

  it("a continuation (Render final) was preceded by a charged preview: it says this step did not run and nothing MORE was charged", async () => {
    const message = await refusedFor({ continued: true })
    expect(message).not.toMatch(/nothing was charged/i)
    expect(message).toMatch(/nothing more was charged/i)
    expect(message).toMatch(/this step did not run/i)
    expect(message).toContain("sectionStartSec")
    expect(message).toContain("sectionEndSec")
  })
})
