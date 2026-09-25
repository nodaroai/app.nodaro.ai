/**
 * `audioSync` over remote sources, with only the network edges faked (the
 * media proxy and the download — which copies a local fixture): everything in
 * between is the real decode and correlation. Nothing probes a source URL
 * directly: a self-hosted install's own-storage URL is on a private address the
 * URL guard refuses (Community E2E caught exactly that).
 *
 * A source with no audio track (a picture-only camera file) is its own row at
 * confidence 0 with a note — it used to fail the whole 2–6-source job with the
 * proxy's raw "Output file does not contain any stream". The reference is the
 * clock, so a reference without audio fails the job, naming it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { basename, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"

const fx = vi.hoisted(() => ({ dir: "", noAudio: new Set<string>() }))
vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../video/ffmpeg-utils.js")>()
  return {
    ...actual,
    probeMediaStreams: async () => { throw new Error("audio-sync must not probe a source URL") },
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
const { audioSync } = await import("../audio-sync.js")
const { DeterministicJobError } = await import("../../../lib/deterministic-job-error.js")

const GATE = "volume='if(gt(random(0),0.55),1,0.06)':eval=frame"
const url = (name: string) => `https://fixtures.test/${name}`

describe("audioSync over remote sources (network edges faked)", () => {
  beforeAll(async () => {
    fx.dir = await fs.mkdtemp(join(tmpdir(), "audio-sync-remote-"))
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "anoisesrc=d=60:c=pink:r=48000:a=0.5:s=3", "-af", GATE, join(fx.dir, "master.wav")])
    await runFfmpeg(["-y", "-ss", "2.5", "-i", join(fx.dir, "master.wav"), "-af", "lowpass=f=3000,volume=0.3", join(fx.dir, "camA.wav")])
    await fs.copyFile(join(fx.dir, "camA.wav"), join(fx.dir, "picture-only.mp4")) // content never read: no audio stream
    fx.noAudio.add("picture-only.mp4")
  }, 120_000)
  afterAll(async () => { await fs.rm(fx.dir, { recursive: true, force: true }).catch(() => {}) })

  it("a source with no audio track is a confidence-0 row with a note — the others are still aligned", async () => {
    const r = await audioSync([
      { id: "master", url: url("master.wav") },
      { id: "pic", url: url("picture-only.mp4") },
      { id: "camA", url: url("camA.wav") },
    ])
    expect(r.offsets.map((o) => o.sourceId)).toEqual(["master", "pic", "camA"]) // input order kept
    const by = Object.fromEntries(r.offsets.map((o) => [o.sourceId, o]))
    expect(by.pic).toEqual({ sourceId: "pic", offsetMs: 0, confidence: 0, driftMsPerHour: null })
    expect(Math.abs(by.camA!.offsetMs - 2500)).toBeLessThanOrEqual(1)
    expect(r.notes.some((n) => n.includes('"pic"') && n.includes("no audio track"))).toBe(true)
  }, 120_000)

  it("only the reference has sound: every other source is a noted row, not a failure", async () => {
    const r = await audioSync([
      { id: "master", url: url("master.wav") },
      { id: "pic", url: url("picture-only.mp4") },
    ])
    expect(r.offsets).toEqual([
      { sourceId: "master", offsetMs: 0, confidence: 1, driftMsPerHour: 0 },
      { sourceId: "pic", offsetMs: 0, confidence: 0, driftMsPerHour: null },
    ])
  }, 60_000)

  it("a reference with no audio fails the job, naming it (deterministic: no retry)", async () => {
    await expect(audioSync([
      { id: "pic", url: url("picture-only.mp4") },
      { id: "master", url: url("master.wav") },
    ])).rejects.toBeInstanceOf(DeterministicJobError)
  }, 60_000)
})
