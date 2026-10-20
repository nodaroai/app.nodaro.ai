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
  it("takes one to six recordings, a Master audio and the Cameras settings (decided 2026-10-17)", () => {
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://a/${i + 1}.mp4`)
    expect(tightenEpisodeBody.safeParse({ mediaUrls: [] }).success).toBe(false)
    expect(tightenEpisodeBody.safeParse({ mediaUrls: urls(1) }).success).toBe(true)
    expect(tightenEpisodeBody.safeParse({ mediaUrls: urls(2) }).success).toBe(true)
    expect(tightenEpisodeBody.safeParse({ mediaUrls: urls(6), masterAudioUrl: "https://a/m.wav", cameras: { wide: 2, synced: true, speakerCameras: { "1": 2 } } }).success).toBe(true)
    expect(tightenEpisodeBody.safeParse({ mediaUrls: urls(7) }).success).toBe(false)
    // The Cameras settings are checked by a run that reads them (prepareUseCase), never by the body.
    expect(tightenEpisodeBody.safeParse({ mediaUrls: urls(1), cameras: "anything" }).success).toBe(true)
  })
  it("Chapters still takes exactly one recording", () => {
    expect(USE_CASE_BODIES["episode-chapters"].safeParse({ mediaUrls: ["https://a/1.mp4", "https://a/2.mp4"] }).success).toBe(false)
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
 * Several recordings and a Master audio: Tighten's body takes them (decided
 * 2026-10-17); these call prepareUseCase with the body itself.
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
    // Its probed length rides on it: the plan's clock, Edit Plan quoted and held on it.
    expect(r.ok && r.sources.masterAudio).toEqual({ url: master, kind: "audio", durationSec: 3600 })
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

describe("prepareUseCase on several recordings (decided 2026-10-17)", () => {
  const multi = (over: Record<string, unknown> = {}) =>
    tightenEpisodeBody.parse({ mediaUrls: ["https://r2/c1.mp4", "https://r2/c2.mp4", "https://r2/c3.mp4"], ...over }) as UseCaseBody

  it("seven in all → too_many_recordings, before any length probe", async () => {
    const r = await prepareUseCase("tighten-episode", tightenEpisodeBody.parse({ mediaUrls: Array.from({ length: 6 }, (_, i) => `https://r2/c${i + 1}.mp4`), masterAudioUrl: "https://r2/m.wav" }) as UseCaseBody)
    expect(r).toMatchObject({ ok: false, status: 400, code: "too_many_recordings" })
    expect(probe.duration).not.toHaveBeenCalled()
  })
  it("two sound-only recordings → recordings_two_audio_only", async () => {
    probe.streams.mockImplementation(async (u: string) => ({ hasVideo: !/c[12]\.mp4/.test(u), hasAudio: true }))
    expect(await prepareUseCase("tighten-episode", multi())).toMatchObject({ ok: false, status: 400, code: "recordings_two_audio_only" })
    expect(probe.duration).not.toHaveBeenCalled()
  })
  it("Cameras settings that are not valid refuse a run on several recordings (invalid_cameras), before any probe", async () => {
    expect(await prepareUseCase("tighten-episode", multi({ cameras: { wide: 7 } }))).toMatchObject({ ok: false, status: 400, code: "invalid_cameras" })
    expect(await prepareUseCase("tighten-episode", multi({ cameras: "two" }))).toMatchObject({ ok: false, code: "invalid_cameras" })
    expect(probe.streams).not.toHaveBeenCalled()
    // None (null) is the defaults.
    expect(await prepareUseCase("tighten-episode", multi({ cameras: null }))).toMatchObject({ ok: true })
  })
  it("a one-recording run ignores whatever Cameras settings it is sent: exactly the run without them (decided 2026-10-19)", async () => {
    const plain = await prepareUseCase("tighten-episode", body())
    for (const cameras of [{ wide: 7 }, "two", 5, [], { speakerCameras: "x" }]) {
      expect(await prepareUseCase("tighten-episode", body({ cameras })), JSON.stringify(cameras)).toEqual(plain)
    }
  })
  it("a wide camera past the last recording → wide_camera_out_of_range", async () => {
    expect(await prepareUseCase("tighten-episode", multi({ cameras: { wide: 4 } }))).toMatchObject({ ok: false, status: 400, code: "wide_camera_out_of_range" })
  })
  it("recording 2 has no sound → media_has_no_audio, naming it", async () => {
    probe.streams.mockImplementation(async (u: string) => ({ hasVideo: true, hasAudio: !u.includes("c2") }))
    expect(await prepareUseCase("tighten-episode", multi())).toMatchObject({ ok: false, code: "media_has_no_audio", message: "Recording 2 has no sound to transcribe." })
  })
  it("an unreadable Master audio → master_audio_unreadable", async () => {
    probe.streams.mockImplementation(async (u: string) => {
      if (u.includes("m.wav")) throw new Error("404")
      return { hasVideo: true, hasAudio: true }
    })
    expect(await prepareUseCase("tighten-episode", multi({ masterAudioUrl: "https://r2/m.wav" }))).toMatchObject({ ok: false, code: "master_audio_unreadable" })
  })
  it("a Master audio longer than the type takes → media_too_long, naming it, before any row", async () => {
    probe.duration.mockImplementation(async (u: string) => (u.includes("m.wav") ? 180 * 60 + 1 : 3600))
    expect(await prepareUseCase("tighten-episode", multi({ masterAudioUrl: "https://r2/m.wav" }))).toMatchObject({
      ok: false, status: 400, code: "media_too_long", message: expect.stringMatching(/^The master audio is too long\./),
    })
  })
  it("three cameras + master: the multicam graph; every recording and the master probed for length", async () => {
    const r = await prepareUseCase("tighten-episode", multi({ masterAudioUrl: "https://r2/m.wav", cameras: { wide: 3 } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.graph.nodes.map((n) => n.type)).toEqual(expect.arrayContaining(["audio-sync", "speaker-map", "camera-switch"]))
    expect(r.sources).toMatchObject({ moreMedia: [{ url: "https://r2/c2.mp4" }, { url: "https://r2/c3.mp4" }], masterAudio: { url: "https://r2/m.wav", kind: "audio", durationSec: 3600 } })
    expect(probe.duration).toHaveBeenCalledTimes(4)
  })
  it("one recording: P1's sources object exactly (no new keys)", async () => {
    const r = await prepareUseCase("tighten-episode", body())
    expect(r.ok && Object.keys(r.sources)).toEqual(["media"])
  })
  it("the run's kind is every recording's: a sound-only recording first beside a camera is a video run, also for a type that needs video", async () => {
    probe.streams.mockImplementation(async (u: string) => ({ hasVideo: !u.includes("c1"), hasAudio: true }))
    const spy = vi.spyOn(usecaseDescriptor("episode-trailer"), "resolveSettings")
    try {
      const r = await prepareUseCase("episode-trailer", { mediaUrls: ["https://r2/c1.mp4", "https://r2/c2.mp4"] } as UseCaseBody)
      expect(r).toMatchObject({ ok: true })
      expect(spy.mock.calls[0]![1]).toBe("video")
    } finally {
      spy.mockRestore()
    }
  })
  describe("a Master audio that is one of the recordings is none (decided 2026-10-19)", () => {
    it("one camera + the same file as master: exactly the one-recording run, the master never probed", async () => {
      const plain = await prepareUseCase("tighten-episode", body())
      probe.streams.mockClear()
      const same = await prepareUseCase("tighten-episode", body({ masterAudioUrl: "https://r2/ep.mp4" }))
      expect(same).toEqual(plain)
      expect(probe.streams.mock.calls.map((c) => c[0])).toEqual(["https://r2/ep.mp4"])
    })
    it("two cameras + camera 2's file as master: the run with no master (no Audio Sync of a file against itself)", async () => {
      const cams = ["https://r2/c1.mp4", "https://r2/c2.mp4"]
      const none = await prepareUseCase("tighten-episode", tightenEpisodeBody.parse({ mediaUrls: cams }) as UseCaseBody)
      const same = await prepareUseCase("tighten-episode", tightenEpisodeBody.parse({ mediaUrls: cams, masterAudioUrl: cams[1] }) as UseCaseBody)
      expect(same).toEqual(none)
      expect(same.ok && same.sources).not.toHaveProperty("masterAudio")
    })
    it("one sound-only recording + its own file as master is not two sound-only recordings", async () => {
      probe.streams.mockImplementation(async (u: string) => ({ hasVideo: !u.includes("c1"), hasAudio: true }))
      const r = await prepareUseCase("tighten-episode", multi({ masterAudioUrl: "https://r2/c1.mp4" }))
      expect(r.ok).toBe(true)
    })
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
  it("takes one to six recordings, a Master audio and the Cameras settings (decided 2026-10-17)", () => {
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://r2/c${i + 1}.mp4`)
    expect(episodeTrailerBody.safeParse({ mediaUrls: urls(6), masterAudioUrl: "https://r2/m.wav", cameras: { wide: 2 } }).success).toBe(true)
    expect(episodeTrailerBody.safeParse({ mediaUrls: urls(7) }).success).toBe(false)
    expect(episodeTrailerBody.safeParse({ mediaUrls: [] }).success).toBe(false)
  })
})

describe("prepareUseCase: Trailer on several recordings (decided 2026-10-17)", () => {
  const cams = ["https://r2/c1.mp4", "https://r2/c2.mp4", "https://r2/c3.mp4"]
  const multi = (over: Record<string, unknown> = {}) => episodeTrailerBody.parse({ mediaUrls: cams, ...over }) as UseCaseBody

  it("three cameras + master: the trailer's multicam graph, every recording and the master probed", async () => {
    const r = await prepareUseCase("episode-trailer", multi({ masterAudioUrl: "https://r2/m.wav", cameras: { wide: 3 } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.graph.nodeType).toBe("episode-trailer")
    expect(r.graph.nodes.map((n) => n.type)).toEqual(expect.arrayContaining(["audio-sync", "speaker-map", "camera-switch", "social-media-format"]))
    expect(r.settings).toMatchObject({ cameras: { wide: 3, synced: false, speakerCameras: {} } })
    expect(probe.duration).toHaveBeenCalledTimes(4)
  })
  it("every recording sound only: refused as one audio recording is (every format is a video)", async () => {
    probe.streams.mockResolvedValue({ hasVideo: false, hasAudio: true })
    expect(await prepareUseCase("episode-trailer", episodeTrailerBody.parse({ mediaUrls: cams.slice(0, 1) }) as UseCaseBody)).toMatchObject({ code: "media_needs_video", message: "Trailer needs a video recording." })
    // Two sound-only recordings are refused first for what they are.
    expect(await prepareUseCase("episode-trailer", multi())).toMatchObject({ ok: false, code: "recordings_two_audio_only" })
  })
  it("one recording: the sources and settings exactly as before (no `cameras`), whatever Cameras settings it is sent", async () => {
    const one = episodeTrailerBody.parse({ mediaUrls: cams.slice(0, 1) }) as UseCaseBody
    const plain = await prepareUseCase("episode-trailer", one)
    expect(plain.ok && Object.keys(plain.sources)).toEqual(["media"])
    expect(plain.ok && "cameras" in plain.settings).toBe(false)
    expect(await prepareUseCase("episode-trailer", { ...one, cameras: { wide: 7 } } as UseCaseBody)).toEqual(plain)
  })
  it("an intro card rides beside several recordings", async () => {
    probe.duration.mockImplementation(async (u: string) => (u.includes("card") ? 4 : 3600))
    const r = await prepareUseCase("episode-trailer", multi({ introCardUrl: "https://r2/card.mp4" }))
    expect(r.ok && r.sources.introCard).toEqual({ url: "https://r2/card.mp4", durationSec: 4 })
    expect(r.ok && r.graph.nodes.some((n) => n.id === "uc-combine")).toBe(true)
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
