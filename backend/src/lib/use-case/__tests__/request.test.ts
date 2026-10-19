// @test-units-by-name looks up only the tighten-episode and episode-trailer bodies (USE_CASE_BODIES by those two types)
import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, TRAILER_INTRO_CARD_MAX_SEC, usecaseDescriptor } from "@nodaro/render-rules"

const probe = vi.hoisted(() => ({
  streams: vi.fn(async (_u: string) => ({ hasVideo: true, hasAudio: true })),
  duration: vi.fn(async (_u: string) => 3600),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaStreams: probe.streams, probeMediaDuration: probe.duration }))
import { INTRO_CARD_MIN_SEC, prepareUseCase, usecaseReviewerPresent } from "../request.js"
import { USE_CASE_BODIES, type UseCaseBody } from "../bodies.js"

const tightenEpisodeBody = USE_CASE_BODIES["tighten-episode"]
const episodeTrailerBody = USE_CASE_BODIES["episode-trailer"]

beforeEach(() => {
  probe.streams.mockReset().mockResolvedValue({ hasVideo: true, hasAudio: true })
  probe.duration.mockReset().mockResolvedValue(3600)
})
const body = (over = {}): UseCaseBody => tightenEpisodeBody.parse({ mediaUrls: ["https://r2/ep.mp4"], ...over }) as UseCaseBody
const renderOf = (r: Awaited<ReturnType<typeof prepareUseCase>>) => (r.ok ? r.graph.nodes.find((n) => n.id === "uc-render")! : null)

describe("tightenEpisodeBody", () => {
  it("takes exactly one recording (multicam is a later phase)", () => {
    expect(tightenEpisodeBody.safeParse({ mediaUrls: [] }).success).toBe(false)
    expect(tightenEpisodeBody.safeParse({ mediaUrls: ["https://a/1.mp4", "https://a/2.mp4"] }).success).toBe(false)
    expect(tightenEpisodeBody.safeParse({ mediaUrls: ["https://a/1.mp4"] }).success).toBe(true)
  })
})

describe("prepareUseCase", () => {
  it("a video recording: probed length, video chain", async () => {
    const r = await prepareUseCase("tighten-episode", body())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sources.media).toEqual({ url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 })
    expect(r.graph.nodes.find((n) => n.id === "uc-source")!.type).toBe("upload-video")
  })
  it("an audio-only file (or a video with only cover art) is an audio episode", async () => {
    probe.streams.mockResolvedValue({ hasVideo: false, hasAudio: true })
    const r = await prepareUseCase("tighten-episode", body({ output: "video", captions: true }))
    expect(r.ok && r.settings).toMatchObject({ output: "audio", captions: false })
  })
  it("unreadable media: 400 before anything else", async () => {
    probe.streams.mockRejectedValue(new Error("403 Forbidden"))
    expect(await prepareUseCase("tighten-episode", body())).toMatchObject({ ok: false, status: 400, code: "media_unreadable" })
    expect(probe.duration).not.toHaveBeenCalled()
  })
  it("no audio stream: 400 (nothing to transcribe)", async () => {
    probe.streams.mockResolvedValue({ hasVideo: true, hasAudio: false })
    expect(await prepareUseCase("tighten-episode", body())).toMatchObject({ ok: false, status: 400, code: "media_has_no_audio" })
  })
  it("longer than 180 minutes: 400", async () => {
    probe.duration.mockResolvedValue(180 * 60 + 1)
    expect(await prepareUseCase("tighten-episode", body())).toMatchObject({ ok: false, status: 400, code: "media_too_long" })
  })
  it("exactly 180 minutes runs", async () => {
    probe.duration.mockResolvedValue(180 * 60)
    expect((await prepareUseCase("tighten-episode", body())).ok).toBe(true)
  })
  it("framing on a video recording builds a Speaker View render on automatic boxes", async () => {
    const r = await prepareUseCase("tighten-episode", body({ framing: { aspect: "9:16", layout: "stacked" } }))
    expect(renderOf(r)).toMatchObject({ type: "speaker-view", data: { targetAspect: "9:16", layout: "stacked", autoRegions: true } })
  })
  it("a music bed must carry audio", async () => {
    probe.streams.mockImplementation(async (u: string) => (u.includes("bed") ? { hasVideo: false, hasAudio: false } : { hasVideo: true, hasAudio: true }))
    expect(await prepareUseCase("tighten-episode", body({ musicUrl: "https://r2/bed.mp3" }))).toMatchObject({ ok: false, status: 400, code: "music_has_no_audio" })
  })
  it("an unreadable music bed is refused the same way", async () => {
    probe.streams.mockImplementation(async (u: string) => {
      if (u.includes("bed")) throw new Error("404")
      return { hasVideo: true, hasAudio: true }
    })
    expect(await prepareUseCase("tighten-episode", body({ musicUrl: "https://r2/bed.mp3" }))).toMatchObject({ ok: false, code: "music_has_no_audio" })
  })
  it("prepareUseCase builds the type's own graph from its descriptor", async () => {
    probe.streams.mockResolvedValue({ hasVideo: true, hasAudio: true })
    probe.duration.mockResolvedValue(3600)
    const prep = await prepareUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"] })
    expect(prep.ok && prep.graph.nodeType).toBe("tighten-episode")
    expect(prep.ok && prep.sources.media).toEqual({ url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 })
  })
  it("names the node in the too-long refusal", async () => {
    probe.streams.mockResolvedValue({ hasVideo: true, hasAudio: true })
    probe.duration.mockResolvedValue(3 * 3600 + 1)
    expect(await prepareUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"] })).toMatchObject({
      ok: false, status: 400, code: "media_too_long", message: "Tighten Episode takes recordings up to 3 hours.",
    })
  })
  it("an audio-only recording runs: Tighten Episode does not need picture", async () => {
    probe.streams.mockResolvedValue({ hasVideo: false, hasAudio: true })
    expect((await prepareUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp3"] })).ok).toBe(true)
  })
  it("an unknown length (probe returned nothing usable) builds with no length", async () => {
    probe.duration.mockRejectedValue(new Error("no duration"))
    const r = await prepareUseCase("tighten-episode", body())
    expect(r.ok && r.sources.media.durationSec).toBeUndefined()
  })
})

describe("prepareUseCase: Trailer", () => {
  const trailer = (over: Record<string, unknown> = {}): UseCaseBody => episodeTrailerBody.parse({ mediaUrls: ["https://r2/ep.mp4"], ...over }) as UseCaseBody
  const card = "https://r2/card.mp4"
  it("an audio-only recording is refused: every format is a video", async () => {
    probe.streams.mockResolvedValue({ hasVideo: false, hasAudio: true })
    expect(await prepareUseCase("episode-trailer", trailer())).toMatchObject({
      ok: false, status: 400, code: "media_needs_video", message: "Trailer needs a video recording.",
    })
  })
  it("a video recording builds the trailer chain, its formats in the fixed order", async () => {
    const r = await prepareUseCase("episode-trailer", trailer({ formats: ["16:9", "9:16"] }))
    expect(r.ok && r.graph.nodeType).toBe("episode-trailer")
    expect(r.ok && r.settings).toMatchObject({ formats: ["9:16", "16:9"] })
  })
  it("an intro card that is a video plays first, its probed length on the built card", async () => {
    probe.duration.mockImplementation(async (u: string) => (u === card ? 3 : 3600))
    const r = await prepareUseCase("episode-trailer", trailer({ introCardUrl: card }))
    expect(r.ok && r.sources.introCard).toEqual({ url: card, durationSec: 3 })
    expect(r.ok && r.graph.nodes.find((n) => n.id === "uc-intro")!.data).toMatchObject({ url: card, metadata: { durationSeconds: 3 } })
    expect(r.ok && r.graph.nodes.map((n) => n.id)).toContain("uc-combine")
  })
  it("an intro card without a video stream is refused", async () => {
    probe.streams.mockImplementation(async (u: string) => (u === card ? { hasVideo: false, hasAudio: true } : { hasVideo: true, hasAudio: true }))
    expect(await prepareUseCase("episode-trailer", trailer({ introCardUrl: card }))).toMatchObject({ ok: false, status: 400, code: "intro_card_unreadable" })
  })
  it("a still image (a video stream with no length, or a frame's) is refused: the card is video only", async () => {
    for (const length of [undefined, 0, 0.04, INTRO_CARD_MIN_SEC]) {
      probe.duration.mockImplementation(async (u: string) => {
        if (u !== card) return 3600
        if (length === undefined) throw new Error("N/A")
        return length
      })
      expect(await prepareUseCase("episode-trailer", trailer({ introCardUrl: card })), String(length)).toMatchObject({ ok: false, status: 400, code: "intro_card_unreadable" })
    }
  })
  it(`an intro card longer than ${TRAILER_INTRO_CARD_MAX_SEC} seconds is refused (decided 2026-10-18); exactly ${TRAILER_INTRO_CARD_MAX_SEC} runs`, async () => {
    probe.duration.mockImplementation(async (u: string) => (u === card ? TRAILER_INTRO_CARD_MAX_SEC + 0.5 : 3600))
    expect(await prepareUseCase("episode-trailer", trailer({ introCardUrl: card }))).toMatchObject({
      ok: false, status: 400, code: "intro_card_too_long", message: "The intro card is too long. Use a card of 15 seconds or less.",
    })
    probe.duration.mockImplementation(async (u: string) => (u === card ? TRAILER_INTRO_CARD_MAX_SEC : 3600))
    expect((await prepareUseCase("episode-trailer", trailer({ introCardUrl: card }))).ok).toBe(true)
  })
  it("an unreadable intro card is refused the same way", async () => {
    probe.streams.mockImplementation(async (u: string) => {
      if (u === card) throw new Error("404")
      return { hasVideo: true, hasAudio: true }
    })
    expect(await prepareUseCase("episode-trailer", trailer({ introCardUrl: card }))).toMatchObject({ ok: false, code: "intro_card_unreadable" })
  })
})

/**
 * Several recordings and a Master audio reach prepareUseCase only once a type
 * takes them (each route's body refuses them before; none does in this phase),
 * so these call it with a body no route would parse yet.
 */
describe("prepareUseCase: every recording and the master are probed", () => {
  const a = "https://r2/a.mp4", b = "https://r2/b.mp4", master = "https://r2/master.wav"
  const several = (over: Record<string, unknown> = {}) => ({ mediaUrls: [a, b], ...over }) as UseCaseBody

  it("one recording and no master: the sources are exactly as before (no moreMedia, no masterAudio key)", async () => {
    const r = await prepareUseCase("tighten-episode", body())
    expect(r.ok && Object.keys(r.sources)).toEqual(["media"])
  })
  it("several recordings: the first is media, the rest moreMedia in order, each with its own kind and length", async () => {
    probe.streams.mockImplementation(async (u: string) => (u === b ? { hasVideo: false, hasAudio: true } : { hasVideo: true, hasAudio: true }))
    probe.duration.mockImplementation(async (u: string) => (u === b ? 1800 : 3600))
    const r = await prepareUseCase("tighten-episode", several())
    expect(r.ok && r.sources.media).toEqual({ url: a, kind: "video", durationSec: 3600 })
    expect(r.ok && r.sources.moreMedia).toEqual([{ url: b, kind: "audio", durationSec: 1800 }])
    expect(r.ok && r.sources).not.toHaveProperty("masterAudio")
  })
  it("a refusal names the recording's position when there are several; the code is unchanged", async () => {
    probe.streams.mockImplementation(async (u: string) => (u === b ? { hasVideo: true, hasAudio: false } : { hasVideo: true, hasAudio: true }))
    expect(await prepareUseCase("tighten-episode", several())).toMatchObject({ ok: false, status: 400, code: "media_has_no_audio", message: "Recording 2 has no sound to transcribe." })
    probe.streams.mockImplementation(async (u: string) => {
      if (u === b) throw new Error("403")
      return { hasVideo: true, hasAudio: true }
    })
    expect(await prepareUseCase("tighten-episode", several())).toMatchObject({ ok: false, code: "media_unreadable", message: expect.stringMatching(/^Recording 2 could not be read\./) })
    probe.streams.mockResolvedValue({ hasVideo: true, hasAudio: true })
    probe.duration.mockImplementation(async (u: string) => (u === b ? 180 * 60 + 1 : 3600))
    expect(await prepareUseCase("tighten-episode", several())).toMatchObject({ ok: false, code: "media_too_long", message: expect.stringMatching(/^Recording 2 is too long\./) })
  })
  it("a master that reads as audio rides as masterAudio; one that does not is refused", async () => {
    const r = await prepareUseCase("tighten-episode", several({ masterAudioUrl: master }))
    expect(r.ok && r.sources.masterAudio).toEqual({ url: master, kind: "audio" })
    probe.streams.mockImplementation(async (u: string) => (u === master ? { hasVideo: false, hasAudio: false } : { hasVideo: true, hasAudio: true }))
    expect(await prepareUseCase("tighten-episode", several({ masterAudioUrl: master }))).toMatchObject({
      ok: false, status: 400, code: "master_audio_unreadable", message: "The master audio could not be read as audio.",
    })
  })
  it("the settings are resolved knowing how many recordings there are and whether a master is wired", async () => {
    const spy = vi.spyOn(usecaseDescriptor("tighten-episode"), "resolveSettings")
    try {
      await prepareUseCase("tighten-episode", body())
      await prepareUseCase("tighten-episode", several({ masterAudioUrl: master }))
      expect(spy.mock.calls.map((c) => c[2])).toEqual([{ recordings: 1, masterAudio: false }, { recordings: 2, masterAudio: true }])
    } finally {
      spy.mockRestore()
    }
  })
})

describe("episodeTrailerBody", () => {
  it("an empty format list is refused, naming the reason; an unknown format too", () => {
    const empty = episodeTrailerBody.safeParse({ mediaUrls: ["https://r2/ep.mp4"], formats: [] })
    expect(empty.success).toBe(false)
    expect(JSON.stringify(empty.error?.issues)).toContain("Choose at least one format")
    expect(episodeTrailerBody.safeParse({ mediaUrls: ["https://r2/ep.mp4"], formats: ["2:1"] }).success).toBe(false)
    expect(episodeTrailerBody.safeParse({ mediaUrls: ["https://r2/ep.mp4"], formats: ["16:9"] }).success).toBe(true)
    expect(episodeTrailerBody.safeParse({ mediaUrls: ["https://r2/ep.mp4"] }).success).toBe(true)
  })
})

describe("usecaseReviewerPresent (who can review a use-case run's preview)", () => {
  const on = { ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true }
  it("a caller outside a run reviews their own run exactly when they asked for review", () => {
    expect(usecaseReviewerPresent(on, { internal: false, forwarded: undefined })).toBe(true)
    expect(usecaseReviewerPresent(TIGHTEN_EPISODE_DEFAULTS, { internal: false, forwarded: true })).toBe(false)
  })
  it("inside another run, only the parent's own answer counts", () => {
    expect(usecaseReviewerPresent(on, { internal: true, forwarded: true })).toBe(true)
    expect(usecaseReviewerPresent(on, { internal: true, forwarded: false })).toBe(false)
    expect(usecaseReviewerPresent(on, { internal: true, forwarded: undefined })).toBe(false)
    expect(usecaseReviewerPresent(on, { internal: true, forwarded: "true" })).toBe(false)
    expect(usecaseReviewerPresent(TIGHTEN_EPISODE_DEFAULTS, { internal: true, forwarded: true })).toBe(false)
  })
})
