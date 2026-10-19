/**
 * `computeSpeakerMap` over real decodes, with only the network edges faked
 * (the media proxy and the download — which copies a local fixture), as
 * `audio-sync-remote.e2e.test.ts` does. Two cameras each closer to one
 * speaker: speaker A's turns are 12 dB louder on f1, speaker B's on f2.
 * Speech-band noise (300–3000 Hz) so the decode's 120 Hz high-pass never eats
 * the difference; turns alternate every 2 s over 20 s.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { basename, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"

const fx = vi.hoisted(() => ({ dir: "", noAudio: new Set<string>() }))
vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../video/ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string, dest: string) => { await fs.copyFile(join(fx.dir, basename(new URL(url).pathname)), dest) },
  }
})
vi.mock("../../../services/media-proxy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/media-proxy.js")>()
  return {
    ...actual,
    // The fixtures already are what a proxy would be: the proxy URL is the
    // source's. A picture-only file gets the proxy step's own verdict.
    ensureMediaProxy: async (url: string) => {
      if (fx.noAudio.has(basename(new URL(url).pathname))) throw new actual.MediaHasNoAudioError(url)
      return { url, key: url, kind: "audio", cached: true }
    },
  }
})

const { runFfmpeg } = await import("../../video/ffmpeg-utils.js")
const { computeSpeakerMap } = await import("../speaker-map.js")
const { resolveEditPlanSources, validateEdl } = await import("@nodaro/shared/edl")

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = isFfmpegAvailable()

const url = (name: string) => `https://fixtures.test/${name}`
const VOICE = "highpass=f=300,lowpass=f=3000"
/** Gain while A speaks (even 2 s turns) and while B speaks (odd ones). */
const gate = (a: number, b: number) => `volume='if(eq(mod(floor(t/2),2),0),${a},${b})':eval=frame`
const transcript = {
  words: Array.from({ length: 10 }, (_, k) => ({ text: `w${k}`, startMs: k * 2000 + 100, endMs: k * 2000 + 1900, speaker: k % 2 === 0 ? "A" : "B" })),
}

describe.skipIf(!ffmpegAvailable)("computeSpeakerMap (e2e, real ffmpeg, network edges faked)", () => {
  beforeAll(async () => {
    fx.dir = await fs.mkdtemp(join(tmpdir(), "speaker-map-e2e-"))
    const make = async (out: string, seed: number, filter: string, dur = 20) =>
      runFfmpeg(["-y", "-f", "lavfi", "-i", `anoisesrc=d=${dur}:c=pink:r=48000:a=0.5:s=${seed}`, "-af", `${VOICE},${filter}`, join(fx.dir, out)])
    await make("master.wav", 1, gate(1, 1))
    await make("f1.wav", 2, gate(1, 0.25)) // A's camera: B 12 dB down
    await make("f2.wav", 3, gate(0.25, 1)) // B's camera: A 12 dB down
    await make("e1.wav", 4, gate(1, 1)) // one shared mic: everyone equal
    await make("e2.wav", 5, gate(1, 1))
    // f2 started 2 s after the master: its t = 0 is master t = 2 (offsetMs +2000).
    await make("f2-long.wav", 3, gate(0.25, 1), 22)
    await runFfmpeg(["-y", "-ss", "2", "-i", join(fx.dir, "f2-long.wav"), join(fx.dir, "f2-late.wav")])
    // A camera whose audio track is there but digital silence.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "20", join(fx.dir, "silent.wav")])
    await fs.copyFile(join(fx.dir, "f1.wav"), join(fx.dir, "picture-only.mp4")) // content never read: no audio stream
    fx.noAudio.add("picture-only.mp4")
  }, 120_000)
  afterAll(async () => { await fs.rm(fx.dir, { recursive: true, force: true }).catch(() => {}) })

  it("each speaker goes to the camera that hears them 12 dB louder; the master is no one's camera; the edit names them", async () => {
    const r = await computeSpeakerMap({
      sources: [
        { id: "m", url: url("master.wav"), kind: "audio" },
        { id: "f1", url: url("f1.wav"), kind: "video" },
        { id: "f2", url: url("f2.wav"), kind: "video" },
      ],
      transcript,
      masterSourceId: "m",
      marginDb: 3,
    })
    expect(r.speakerMap).toEqual({ A: "f1", B: "f2" })
    expect(r.confidence.A!.marginDb).toBeGreaterThan(9)
    expect(r.confidence.B!.marginDb).toBeGreaterThan(9)
    expect(r.notes).toEqual([])
    expect(r.edl).toBeDefined()
    expect(validateEdl(r.edl!).issues).toEqual([])
    expect(r.edl!.sources.map((s) => [s.id, s.role, s.speakers ?? []])).toEqual([["m", "master-audio", []], ["f1", "camera", ["A"]], ["f2", "camera", ["B"]]])
    expect(r.edl!.segments).toHaveLength(1)
    expect(Math.abs(r.edl!.segments[0]!.outMs - 20_000)).toBeLessThanOrEqual(50)
  }, 120_000)

  it("one shared microphone (equal levels on every camera): no clear camera, a note per speaker, the run completes", async () => {
    const r = await computeSpeakerMap({
      sources: [{ id: "e1", url: url("e1.wav"), kind: "video" }, { id: "e2", url: url("e2.wav"), kind: "video" }],
      transcript,
      marginDb: 3,
    })
    expect(r.speakerMap).toEqual({ A: "", B: "" })
    expect(r.notes).toHaveLength(2)
    for (const n of r.notes) expect(n).toMatch(/no clear camera.*wide shot/)
  }, 120_000)

  it("a source with no audio track is no candidate and a note — never a failure", async () => {
    const r = await computeSpeakerMap({
      sources: [
        { id: "f1", url: url("f1.wav"), kind: "video" },
        { id: "pic", url: url("picture-only.mp4"), kind: "video" },
        { id: "f2", url: url("f2.wav"), kind: "video" },
      ],
      transcript,
      marginDb: 3,
    })
    expect(r.speakerMap).toEqual({ A: "f1", B: "f2" })
    expect(r.notes).toEqual(['"pic": has no audio track, so it cannot be matched to a speaker by sound.'])
  }, 120_000)

  it("a camera whose audio track is silent is no candidate and a note naming it — never a failure", async () => {
    const r = await computeSpeakerMap({
      sources: [
        { id: "f1", url: url("f1.wav"), kind: "video" },
        { id: "mute", url: url("silent.wav"), kind: "video" },
        { id: "f2", url: url("f2.wav"), kind: "video" },
      ],
      transcript,
      marginDb: 3,
    })
    expect(r.speakerMap).toEqual({ A: "f1", B: "f2" })
    expect(r.notes).toEqual(['"mute": its sound is silent, so it cannot be matched to a speaker by sound.'])
  }, 120_000)

  it("a wide shot with no audio track was never a candidate: no note for it", async () => {
    const r = await computeSpeakerMap({
      sources: [
        { id: "f1", url: url("f1.wav"), kind: "video" },
        { id: "f2", url: url("f2.wav"), kind: "video" },
        { id: "pic", url: url("picture-only.mp4"), kind: "video" },
      ],
      transcript,
      wideSourceId: "pic",
      marginDb: 3,
    })
    expect(r.speakerMap).toEqual({ A: "f1", B: "f2" })
    expect(r.notes).toEqual([])
  }, 120_000)

  it("a measured offset moves each turn onto the camera's own clock (and the transcript may arrive as its JSON string)", async () => {
    const sources = [{ id: "f1", url: url("f1.wav"), kind: "video" as const }, { id: "f2", url: url("f2-late.wav"), kind: "video" as const }]
    const synced = await computeSpeakerMap({
      sources,
      transcript: JSON.stringify(transcript),
      offsets: JSON.stringify({ version: 1, reference: "f1", offsets: [{ sourceId: "f1", offsetMs: 0 }, { sourceId: "f2", offsetMs: 2000 }] }),
      marginDb: 3,
    })
    expect(synced.speakerMap).toEqual({ A: "f1", B: "f2" })
    expect(synced.edl!.sources.find((s) => s.id === "f2")!.offsetMs).toBe(2000)
    // Without the offset, f2 is read 2 s off — a turn later — and no camera leads.
    const unsynced = await computeSpeakerMap({ sources, transcript, marginDb: 3 })
    expect(unsynced.speakerMap).toEqual({ A: "", B: "" })
  }, 120_000)

  // Audio Sync's reference may be any recording: here f2 (the late camera), so
  // the master reads −2000 and f1 −2000. Rebased onto the master's clock, f1 is
  // at 0 and f2 at +2000 — the edit's clock source at 0, as every planner needs.
  const againstCamera = { version: 1, reference: "f2", offsets: [{ sourceId: "m", offsetMs: -2000 }, { sourceId: "f1", offsetMs: -2000 }, { sourceId: "f2", offsetMs: 0 }] }
  it("offsets measured against a camera are rebased onto the master: the right map, and an edit whose clock is at 0", async () => {
    const r = await computeSpeakerMap({
      sources: [
        { id: "m", url: url("master.wav"), kind: "audio" },
        { id: "f1", url: url("f1.wav"), kind: "video" },
        { id: "f2", url: url("f2-late.wav"), kind: "video" },
      ],
      transcript,
      offsets: againstCamera,
      masterSourceId: "m",
      marginDb: 3,
    })
    expect(r.speakerMap).toEqual({ A: "f1", B: "f2" })
    expect(r.edl!.sources.map((s) => [s.id, s.offsetMs ?? 0])).toEqual([["m", 0], ["f1", 0], ["f2", 2000]])
    expect(validateEdl(r.edl!).issues).toEqual([])
    expect(resolveEditPlanSources(r.edl!.sources)).toMatchObject({ ok: true })
  }, 120_000)

  it("with no master, the first recording is the clock the camera-referenced offsets are rebased onto", async () => {
    const r = await computeSpeakerMap({
      sources: [{ id: "f1", url: url("f1.wav"), kind: "video" }, { id: "f2", url: url("f2-late.wav"), kind: "video" }],
      transcript,
      offsets: againstCamera,
      marginDb: 3,
    })
    expect(r.speakerMap).toEqual({ A: "f1", B: "f2" })
    expect(r.edl!.sources.map((s) => [s.id, s.offsetMs ?? 0])).toEqual([["f1", 0], ["f2", 2000]])
    expect(resolveEditPlanSources(r.edl!.sources)).toMatchObject({ ok: true })
  }, 120_000)
})
