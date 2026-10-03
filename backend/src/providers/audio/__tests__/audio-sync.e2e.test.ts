/**
 * Real-ffmpeg e2e for `runAudioSyncOnFiles` (audio-sync.ts): cameras cut from
 * ONE synthetic "conversation" at known offsets must come back at those offsets
 * (the spec asks ±20 ms; the fine pass should land within a millisecond), each
 * treated like a real second microphone — its own level, EQ and noise floor.
 *
 * The master is pink noise gated on and off at random per audio frame (~21 ms),
 * so its onsets never repeat: a clean correlation peak, unlike a periodic tone.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe } from "../../video/ffmpeg-utils.js"
import { buildProxyArgs } from "../../../services/media-proxy.js"
import { runAudioSyncOnFiles, AUDIO_SYNC_DRIFT_WARN_MS } from "../audio-sync.js"

const GATE = "volume='if(gt(random(0),0.55),1,0.06)':eval=frame"
// A second mic in the same room: quieter, duller, with its own hiss.
const CAMERA_MIC = "lowpass=f=3000,volume=0.3"

describe("runAudioSyncOnFiles (e2e, real ffmpeg)", () => {
  let dir: string
  const p = (name: string) => join(dir, name)
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "audio-sync-e2e-"))
    // 120 s master at 48 kHz.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "anoisesrc=d=120:c=pink:r=48000:a=0.5:s=7", "-af", GATE, p("master.wav")])
    const withHiss = async (out: string, pre: string[], filter: string, dur: number, rate = 48_000) =>
      runFfmpeg([
        "-y", ...pre,
        "-f", "lavfi", "-i", `anoisesrc=d=${dur}:c=white:r=${rate}:a=0.01:s=11`,
        "-filter_complex", `[0:a]${filter},aresample=${rate}[m];[m][1:a]amix=inputs=2:duration=first:normalize=0[out]`,
        "-map", "[out]", "-ar", String(rate), out,
      ])
    // camA started 7.5 s AFTER the master: its t=0 is master t=7.5 → +7500.
    await withHiss(p("camA.m4a"), ["-ss", "7.5", "-i", p("master.wav")], CAMERA_MIC, 120)
    // camB started 40 s BEFORE the master: 40 s of room tone, then the master → −40000.
    await withHiss(p("camB.wav"), ["-i", p("master.wav")], `${CAMERA_MIC},adelay=40000:all=1`, 170)
    // camC recorded at 44.1 kHz, started 3.25 s after the master → +3250.
    await withHiss(p("camC.wav"), ["-ss", "3.25", "-i", p("master.wav")], CAMERA_MIC, 120, 44_100)
    // A camera whose mic was off.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "60", p("silent.wav")])
  }, 120_000)
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })
  // A camera across the room, heard through a physical room response: the
  // direct sound, then a dense diffuse tail decaying over ~0.3 s whose total
  // energy is ~11 dB OVER the direct sound's (DRR ≈ −11 dB). The source is
  // SPEECH-BAND (100–800 Hz) — a narrow band has a broad correlation peak the
  // reverb can drag, which broadband noise does not: measured here, plain
  // correlation reads 7478 (22 ms late, the review's case) and GCC-PHAT 7500.
  const roomCamera = async () => {
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "anoisesrc=d=120:c=pink:r=48000:a=0.5:s=7", "-af", `highpass=f=100,lowpass=f=800,${GATE}`, p("voice.wav")])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "aevalsrc='if(eq(n\\,0)\\,1\\,0)+0.145*(random(0)*2-1)*exp(-t/0.08)*gte(n\\,144)':s=48000:d=0.5",
      p("ir.wav"),
    ])
    await runFfmpeg([
      "-y", "-ss", "7.5", "-i", p("voice.wav"), "-i", p("ir.wav"),
      "-filter_complex", "[0:a][1:a]afir=dry=10:wet=10,lowpass=f=3000,volume=0.3", p("far.wav"),
    ])
  }

  it("recovers each camera's offset against the master within a millisecond — both signs, 44.1 kHz too", async () => {
    const r = await runAudioSyncOnFiles([
      { id: "master", path: p("master.wav") },
      { id: "camA", path: p("camA.m4a") },
      { id: "camB", path: p("camB.wav") },
      { id: "camC", path: p("camC.wav") },
    ])
    expect(r.version).toBe(1)
    expect(r.reference).toBe("master")
    const by = Object.fromEntries(r.offsets.map((o) => [o.sourceId, o]))
    expect(by.master).toEqual({ sourceId: "master", offsetMs: 0, confidence: 1, driftMsPerHour: 0 })
    for (const [id, want] of [["camA", 7500], ["camB", -40_000], ["camC", 3250]] as const) {
      expect(Math.abs(by[id]!.offsetMs - want), `${id}: ${JSON.stringify(by[id])}`).toBeLessThanOrEqual(1)
      expect(by[id]!.confidence, id).toBeGreaterThanOrEqual(0.5)
    }
    expect(r.notes).toEqual([])
  }, 180_000)

  it("measures against any chosen reference — offsets flip sign and compose", async () => {
    const r = await runAudioSyncOnFiles([
      { id: "master", path: p("master.wav") },
      { id: "camA", path: p("camA.m4a") },
    ], "camA")
    const by = Object.fromEntries(r.offsets.map((o) => [o.sourceId, o]))
    expect(by.camA!.offsetMs).toBe(0)
    expect(Math.abs(by.master!.offsetMs - -7500)).toBeLessThanOrEqual(1)
  }, 120_000)

  it("a silent camera is a low-confidence result with a note, never a failure", async () => {
    const r = await runAudioSyncOnFiles([
      { id: "master", path: p("master.wav") },
      { id: "silent", path: p("silent.wav") },
    ])
    const silent = r.offsets.find((o) => o.sourceId === "silent")!
    expect(silent.confidence).toBeLessThan(0.5)
    expect(r.notes.some((n) => n.includes('"silent"'))).toBe(true)
  }, 120_000)

  it("measures clock drift and warns past a frame — without correcting it (decided 2026-09-25)", async () => {
    // 8 minutes, the camera's clock EXACTLY 100 ppm fast (asetrate takes whole
    // hertz: 20000 → 20002): +360 ms per hour, 48 ms over the overlap.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "anoisesrc=d=480:c=pink:r=20000:a=0.5:s=5", "-af", GATE, p("long.wav")])
    await runFfmpeg(["-y", "-i", p("long.wav"), "-af", "asetrate=20002,aresample=20000,lowpass=f=3000,volume=0.3", p("fast.wav")])
    const r = await runAudioSyncOnFiles([
      { id: "master", path: p("long.wav") },
      { id: "fast", path: p("fast.wav") },
    ])
    const fast = r.offsets.find((o) => o.sourceId === "fast")!
    expect(fast.driftMsPerHour, JSON.stringify(fast)).not.toBeNull()
    expect(Math.abs(fast.driftMsPerHour! - 360), JSON.stringify(fast)).toBeLessThan(40)
    // The offset is taken at the MIDDLE of the overlap: ≈ 100 ppm × 240 s = 24 ms.
    expect(Math.abs(fast.offsetMs - 24), JSON.stringify(fast)).toBeLessThanOrEqual(3)
    expect(48).toBeGreaterThan(AUDIO_SYNC_DRIFT_WARN_MS)
    expect(r.notes.some((n) => n.includes('"fast"') && n.includes("drifts"))).toBe(true)
  }, 300_000)

  // Review of #1641: a fixed ±100 ms fine search lost the start/end windows of a
  // long drifting pair (the docs' own example — 100 ppm over 40 minutes — came
  // back 87 ms / 173 ms/h at confidence 0). The middle window is now searched
  // across the whole drift and the ends are predicted from it.
  it("measures a realistic drift over a long overlap: 100 ppm across 45 minutes", async () => {
    // Exactly 100 ppm (asetrate takes whole hertz: 20000 → 20002).
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "anoisesrc=d=2700:c=pink:r=20000:a=0.5:s=9", "-af", GATE, p("ep.wav")])
    await runFfmpeg(["-y", "-i", p("ep.wav"), "-af", "asetrate=20002,aresample=20000,lowpass=f=3000,volume=0.3", p("ep-fast.wav")])
    const r = await runAudioSyncOnFiles([
      { id: "master", path: p("ep.wav") },
      { id: "fast", path: p("ep-fast.wav") },
    ])
    const fast = r.offsets.find((o) => o.sourceId === "fast")!
    // +360 ms per hour; the offset at the middle of a 45-minute overlap ≈ 100 ppm × 1350 s = 135 ms.
    expect(Math.abs(fast.driftMsPerHour! - 360), JSON.stringify(fast)).toBeLessThan(5)
    expect(Math.abs(fast.offsetMs - 135), JSON.stringify(fast)).toBeLessThanOrEqual(2)
    // Three windows on one line to a fraction of a millisecond: full confidence,
    // however much the drift smeared the coarse peak.
    expect(fast.confidence, JSON.stringify(fast)).toBeGreaterThanOrEqual(0.9)
  }, 300_000)

  // Review of #1641: a camera far from the speaker hears more reverb than
  // voice, which dragged the plain correlation's peak toward the reflections
  // (23 ms late at full confidence). GCC-PHAT keeps the direct path.
  it("is not pulled toward the room's reverb — a camera that hears more reflection than voice", async () => {
    await roomCamera()
    const r = await runAudioSyncOnFiles([
      { id: "voice", path: p("voice.wav") },
      { id: "far", path: p("far.wav") },
    ])
    const far = r.offsets.find((o) => o.sourceId === "far")!
    // The offset is right; the confidence is low (reflections are secondary
    // PHAT peaks) — the safe way round: "check by ear", never a wrong answer
    // at full confidence.
    expect(Math.abs(far.offsetMs - 7500), JSON.stringify(far)).toBeLessThanOrEqual(3)
  }, 180_000)

  // Review of #1641: a video whose AUDIO starts after its picture (a stream-copy
  // trim, a late camera mic) — apply-edl reads it on the container clock, but
  // the proxy dropped the leading gap, so the offset landed on no clock
  // (−86 ms for a true −500). The proxy now pads the gap (recipe v2).
  it("measures a video whose audio starts after its picture on the SOURCE's clock, through the real proxy", async () => {
    // Camera audio = the master from 7.5 s, placed 0.5 s into the container:
    // container time c ↔ master c + 7.0 → +7000 (dropping the gap reads +7500).
    await runFfmpeg(["-y", "-ss", "7.5", "-i", p("master.wav"), "-t", "60", "-af", CAMERA_MIC, p("late-src.wav")])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=black:s=64x48:r=30:d=61", "-itsoffset", "0.5", "-i", p("late-src.wav"),
      "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-c:a", "aac", p("late.mp4"),
    ])
    const audioStart = Number((await runFfprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=start_time", "-of", "csv=p=0", p("late.mp4")])).trim().split(",")[0])
    expect(audioStart, "the fixture's audio really starts late").toBeGreaterThan(0.4)
    await runFfmpeg(buildProxyArgs("audio", p("late.mp4"), p("late-proxy.m4a"), 15))
    const r = await runAudioSyncOnFiles([
      { id: "master", path: p("master.wav") },
      { id: "late", path: p("late-proxy.m4a") },
    ])
    const late = r.offsets.find((o) => o.sourceId === "late")!
    expect(Math.abs(late.offsetMs - 7000), JSON.stringify(late)).toBeLessThanOrEqual(2)
  }, 180_000)

  it("refuses fewer than two or more than six sources, duplicate ids, and an unknown reference", async () => {
    const one = [{ id: "a", path: p("master.wav") }]
    await expect(runAudioSyncOnFiles(one)).rejects.toThrow(/2–6 sources/)
    await expect(runAudioSyncOnFiles([...one, ...one])).rejects.toThrow(/unique/)
    await expect(runAudioSyncOnFiles([...one, { id: "b", path: p("camA.m4a") }], "zzz")).rejects.toThrow(/not one of the sources/)
  })
})
