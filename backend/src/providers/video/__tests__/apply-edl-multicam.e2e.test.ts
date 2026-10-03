/**
 * Real-ffmpeg multicam cases for the apply-edl executor (`../apply-edl.ts`) —
 * Phase-2 B1: the EDL shapes Multicam Cut sends. Split from
 * `apply-edl.e2e.test.ts`, whose harness this mirrors exactly: the same
 * ffmpeg-availability skip, the same partial mock of ONLY `downloadFile` (so
 * sources "download" from local lavfi fixtures, safeFetch untouched) and the
 * same in-memory R2 (inert here — every case renders with `checkpoint:false`).
 * The shared fixture builders and decoders live in `./apply-edl-e2e-helpers.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe } from "../ffmpeg-utils.js"
import { validateEffectiveEdl } from "../../../lib/apply-edl-plan.js"
import type { Edl } from "@nodaro/shared"
import {
  ffmpegAvailable, makeSource, trackDetail, ONE_FRAME,
  makeTimecodedCam, MASTER_TONES, masterToneAt, frameTokenRuns, contentColumns,
  decodeSound, soundModel, soundMismatches, type SoundExpect,
} from "./apply-edl-e2e-helpers.js"

// Records every ffmpeg spawn applyEdl makes (and can fail one on demand), so
// tests can pin HOW a render runs, not only what it produces.
const ff = vi.hoisted(() => ({
  calls: [] as string[][],
  failWhen: undefined as undefined | ((a: readonly string[]) => boolean),
  /** At each chunk-concat spawn: the work-dir files still present. */
  atConcat: [] as string[][],
}))
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    runFfmpeg: async (args: readonly string[], timeoutMs?: number): Promise<string> => {
      ff.calls.push([...args])
      const list = args.find((a) => a.endsWith("/chunks.txt"))
      if (list) ff.atConcat.push(await fs.readdir(dirname(list)))
      if (ff.failWhen?.(args)) throw new Error("injected ffmpeg failure")
      return actual.runFfmpeg(args, timeoutMs)
    },
    downloadFile: async (url: string, dest: string): Promise<void> => {
      const dir = process.env.APPLY_EDL_FIXTURE_DIR
      if (!dir) throw new Error("fixture dir not set")
      await fs.copyFile(join(dir, basename(new URL(url).pathname)), dest)
    },
  }
})

// In-memory R2 for the checkpoint/resume cases. Every other case renders with
// `checkpoint:false` and never imports storage.
const r2 = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  downloads: [] as string[],
  uploads: [] as string[],
  deletes: [] as string[],
  /** Simulate a run that died before its post-success cleanup. */
  keepOnDelete: false,
  reset() {
    this.objects.clear(); this.downloads.length = 0; this.uploads.length = 0; this.deletes.length = 0; this.keepOnDelete = false
  },
}))
vi.mock("../../../lib/storage.js", () => ({
  getR2ObjectSize: async (key: string) => r2.objects.get(key)?.length ?? 0,
  downloadR2ObjectToFile: async (key: string, dest: string) => {
    r2.downloads.push(key)
    await fs.writeFile(dest, r2.objects.get(key)!)
  },
  uploadFileWithKeyToR2: async (path: string, key: string) => {
    r2.uploads.push(key)
    r2.objects.set(key, await fs.readFile(path))
  },
  deleteFromR2: async (key: string) => {
    r2.deletes.push(key)
    if (!r2.keepOnDelete) r2.objects.delete(key)
  },
}))

const { applyEdl } = await import("../apply-edl.js")

describe.skipIf(!ffmpegAvailable)("applyEdl (real ffmpeg)", () => {
  let dir: string
  // Every successful render leaves its work dir (source copies + output) in
  // tmpdir; a failed one is cleaned by applyEdl itself. Collected and removed.
  const renderDirs: string[] = []
  const render = async (opts: Parameters<typeof applyEdl>[0]) => {
    const out = await applyEdl(opts)
    renderDirs.push(dirname(out.outputPath))
    return out
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "apply-edl-multicam-test-"))
    process.env.APPLY_EDL_FIXTURE_DIR = dir
    // Solid RED + a 440 Hz tone — the non-master camera of the (c) cases.
    await makeSource(join(dir, "a.mp4"), "red", 440, 6)
    // --- Multicam shapes (B1) — what Multicam Cut sends. ---
    // Two time-coded cameras (a colour per SOURCE second), each with a tone of
    // its own, and a 12 s audio-only master whose tone steps every MASTER second.
    await makeTimecodedCam(join(dir, "camP.mp4"), "RGB", 1700, 12)
    await makeTimecodedCam(join(dir, "camQ.mp4"), "YCM", 2100, 12)
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*(300+100*mod(floor(t)\\,10))*t):s=48000:d=12",
      "-c:a", "aac", join(dir, "master12.m4a"),
    ])
    // A camera with NO audio stream at all (white picture).
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=white:s=320x240:r=30:d=6",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", join(dir, "mute.mp4"),
    ])
    // Mixed geometry and rate: two 1080p30 cameras (the majority), a 16:9 720p
    // camera at 25 fps (scaled up) and a 4:3 960×720 camera (pillarboxed).
    for (const [file, colour, size, rate] of [
      ["h1080r.mp4", "red", "1920x1080", 30],
      ["h1080b.mp4", "blue", "1920x1080", 30],
      ["l720y25.mp4", "yellow", "1280x720", 25],
      ["p960m.mp4", "magenta", "960x720", 30],
    ] as const) {
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${size}:r=${rate}:d=4`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", join(dir, file),
      ])
    }
  }, 180_000)

  afterAll(async () => {
    delete process.env.APPLY_EDL_FIXTURE_DIR
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    await Promise.all(renderDirs.map((d) => fs.rm(d, { recursive: true, force: true }).catch(() => {})))
  })

  // =========================================================================
  // Multicam shapes (Phase-2 B1) — the EDLs component 3 (Multicam Cut) sends:
  // several cameras on one master clock, each with its own offsetMs, cutting
  // hard between them over one master-audio track. The cameras encode SOURCE
  // time in every frame and the master encodes MASTER time in its tone, so the
  // assertions pin WHICH SECOND of which source each frame and each 100 ms of
  // sound came from — every frame, the whole track.
  // =========================================================================
  describe("multicam shapes (B1)", () => {
    const fx = (file: string) => `https://fixtures.test/${file}`
    const MASTER = { id: "MASTER", url: fx("master12.m4a"), kind: "audio", role: "master-audio" } as const
    const camP = (offsetMs: number, id = "P") => ({ id, url: fx("camP.mp4"), kind: "video" as const, offsetMs })
    const camQ = (offsetMs: number, id = "Q") => ({ id, url: fx("camQ.mp4"), kind: "video" as const, offsetMs })
    const MUTE = { id: "MUTE", url: fx("mute.mp4"), kind: "video" } as const
    /** What each source SOUNDS like at its own second `s` (by the ids below). */
    const sourceSound = (id: string, s: number): SoundExpect =>
      id === "MASTER" ? masterToneAt(s)
        : id === "P" || id === "L" ? 1700 // camP.mp4's own tone
          : id === "Q" ? 2100 // camQ.mp4's own tone
            : id === "A" ? 440
              : id === "MUTE" ? "silence"
                : NaN
    /** Every tone a wrong read could produce: the master's AND the cameras'. */
    const CANDIDATES = [...MASTER_TONES, 440, 1700, 2100]

    const videoStream = async (path: string) => {
      const [w, h, rate, frames] = (await runFfprobe([
        "-v", "error", "-select_streams", "v:0", "-count_packets",
        "-show_entries", "stream=width,height,r_frame_rate,nb_read_packets", "-of", "csv=p=0", path,
      ])).trim().split("\n")[0]!.split(",")
      return { width: Number(w), height: Number(h), rate, frames: Number(frames) }
    }

    /** Sound: every checked window matches the D19 model, and every segment
     *  had windows checked (a skip rule cannot hollow a segment out). */
    const expectSound = async (outputPath: string, edl: Edl) => {
      const { mismatches, checkedPerSegment } = soundMismatches(await decodeSound(outputPath), soundModel(edl, sourceSound), CANDIDATES)
      expect(mismatches, "sound windows off the D19 model").toEqual([])
      expect(edl.segments.map((_, k) => checkedPerSegment[k] ?? 0).every((n) => n >= 3), `windows checked per segment ${JSON.stringify(checkedPerSegment)}`).toBe(true)
    }

    // (a) Two cameras on OPPOSITE sides of the master's origin: P starts 1.5 s
    // after it (offsetMs +1500 → source = master − 1.5 s), Q 0.5 s before it
    // (offsetMs −500 → source = master + 0.5 s). Hard cuts between them, the
    // master windows out of order (a jump forward, a jump back, a re-read of
    // an early span) so "sound at masterMs" and "sound at output time" differ.
    // No segment names `audio`, so every one sounds from the master (D19).
    //
    // Picture, frame by frame (30 fps; P cycles R,G,B and Q Y,C,M per SOURCE
    // second, so the colour flips land where the source's second boundaries do):
    //   s0 Q [1.6,3.1) → Q src [2.1,3.6): frames 63-89 M, 90-107 Y   → M27 Y18
    //   s1 P [3.1,4.3) → P src [1.6,2.8): frames 48-59 G, 60-83 B    → G12 B24
    //   s2 Q [7.2,8.4) → Q src [7.7,8.9): 231-239 C, 240-266 M        → C9 M27
    //   s3 P [5.2,6.7) → P src [3.7,5.2): 111-119 R, 120-149 G, 150-155 B → R9 G30 B6
    //   s4 Q [9.3,10.3) → Q src [9.8,10.8): 294-299 Y, 300-323 C      → Y6 C24
    //   s5 P [2.0,2.8) → P src [0.5,1.3): 15-29 R, 30-38 G            → R15 G9
    const multicam: Edl = {
      version: 1, clock: "master",
      sources: [camP(1500), camQ(-500), MASTER],
      segments: [
        { id: "s0", inMs: 1600, outMs: 3100, video: "Q" },
        { id: "s1", inMs: 3100, outMs: 4300, video: "P" },
        { id: "s2", inMs: 7200, outMs: 8400, video: "Q" },
        { id: "s3", inMs: 5200, outMs: 6700, video: "P" },
        { id: "s4", inMs: 9300, outMs: 10300, video: "Q" },
        { id: "s5", inMs: 2000, outMs: 2800, video: "P" },
      ],
    }
    const MULTICAM_RUNS = "M27 Y18 G12 B24 C9 M27 R9 G30 B6 Y6 C24 R15 G9"
    const expectMulticam = async (outputPath: string) => {
      expect(await frameTokenRuns(outputPath)).toBe(MULTICAM_RUNS)
      const d = await trackDetail(outputPath)
      expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(216) // 7.2 s
      expect(Math.abs(d.audio - 7.2), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
      await expectSound(outputPath, multicam)
    }

    it("(a) master-audio + cameras offset either side of it: each picture from its camera at masterMs − offsetMs, all sound from the master at masterMs", async () => {
      expect(validateEffectiveEdl(multicam, "video")).toEqual({ ok: true, issues: [] }) // what ingress accepts
      const { outputPath } = await render({ edl: multicam, output: "video", quality: "final", jobId: "t-b1-multicam", checkpoint: false })
      await expectMulticam(outputPath)
    }, 180_000)

    // The same edit through the chunked path: per-input seeks rebase every
    // trim, the picture chunks stream-copy concat and the sound is rendered as
    // lossless slices joined once (option B) — the offsets must survive all of it.
    it("(a) the same multicam edit rendered in chunks (seeked inputs, option B audio) is frame- and tone-identical", async () => {
      const { outputPath } = await render({
        edl: multicam, output: "video", quality: "final", jobId: "t-b1-multicam-chunked",
        checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 2,
      })
      await expectMulticam(outputPath)
    }, 180_000)

    // (b)/(e) Mixed geometry and rate in one edit: two 1080p30 cameras (the
    // majority → a 1920×1080@30 canvas), a 16:9 1280×720 camera at 25 fps
    // (scaled up to fill the canvas, resampled onto the 30 fps grid) and a 4:3
    // 960×720 camera (pillarboxed: 1440×1080 centred, 240 px black bars).
    // Fractional cuts, so each cut's frame count is the cumulative grid's
    // round(cumEnd·30) − round(cumStart·30): 18.51→19, 37.2→37, 56.49→56,
    // 75.33→75, 93.06→93, 111.51→112, 120 → 19,18,19,19,18,19,8 frames
    // (rounding each cut alone would give 19,19,19,19,18,18,8).
    const mixed: Edl = {
      version: 1, clock: "master",
      sources: [
        { id: "H1", url: fx("h1080r.mp4"), kind: "video" },
        { id: "H2", url: fx("h1080b.mp4"), kind: "video" },
        { id: "L25", url: fx("l720y25.mp4"), kind: "video" },
        { id: "P43", url: fx("p960m.mp4"), kind: "video" },
        MASTER,
      ],
      segments: [
        { id: "s0", inMs: 0, outMs: 617, video: "H1" },
        { id: "s1", inMs: 617, outMs: 1240, video: "L25" },
        { id: "s2", inMs: 1240, outMs: 1883, video: "P43" },
        { id: "s3", inMs: 1883, outMs: 2511, video: "H2" },
        { id: "s4", inMs: 2511, outMs: 3102, video: "L25" },
        { id: "s5", inMs: 3102, outMs: 3717, video: "P43" },
        { id: "s6", inMs: 3717, outMs: 4000, video: "H1" },
      ],
    }
    // Upper case = the camera fills the frame; lower case = pillarboxed.
    const MIXED_RUNS = "R19 Y18 m19 B19 Y18 m19 R8"
    const P43_FRAME = 45 // inside s2 (frames 37-55)
    const L25_FRAME = 25 // inside s1 (frames 19-36)

    it("(b) mixed 1080p30 + 720p25 + 4:3 cameras: one 1920×1080@30 canvas, each camera scaled or pillarboxed, every cut on the grid", async () => {
      const { outputPath } = await render({ edl: mixed, output: "video", quality: "final", jobId: "t-b1-mixed", checkpoint: false })
      expect(await videoStream(outputPath)).toEqual({ width: 1920, height: 1080, rate: "30/1", frames: 120 })
      expect(await frameTokenRuns(outputPath, true)).toBe(MIXED_RUNS)
      // Exact geometry: the 4:3 camera is 1440 px wide, centred; the 720p one fills the width.
      expect(await contentColumns(outputPath, P43_FRAME)).toEqual({ first: 240, last: 1679, width: 1920 })
      expect(await contentColumns(outputPath, L25_FRAME)).toEqual({ first: 0, last: 1919, width: 1920 })
      const d = await trackDetail(outputPath)
      expect(Math.abs(d.audio - 4), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
      await expectSound(outputPath, mixed)
    }, 180_000)

    // (e) A proxy of the same edit: the canvas is capped at 720p (1280×720,
    // aspect kept) — and nothing else moves: the same frame count, the same cut
    // on the same frame, the same boxing (the 4:3 camera now 960 px, 160 px bars).
    it("(e) quality:\"proxy\" caps the canvas at 720p with the same cut timing and frame counts as the final", async () => {
      const { outputPath } = await render({ edl: mixed, output: "video", quality: "proxy", jobId: "t-b1-mixed-proxy", checkpoint: false })
      expect(await videoStream(outputPath)).toEqual({ width: 1280, height: 720, rate: "30/1", frames: 120 })
      expect(await frameTokenRuns(outputPath, true)).toBe(MIXED_RUNS)
      expect(await contentColumns(outputPath, P43_FRAME)).toEqual({ first: 160, last: 1119, width: 1280 })
      expect(await contentColumns(outputPath, L25_FRAME)).toEqual({ first: 0, last: 1279, width: 1280 })
      await expectSound(outputPath, mixed)
    }, 180_000)

    // (c) A camera with NO audio stream, cut against a time-coded one over the
    // master: it renders, and the sound is the master's throughout — the
    // mute camera's segments included.
    //   s0 MUTE [1.0,2.2) → W36;  s1 Q [2.2,3.3) → Q src [2.7,3.8): M9 Y24
    //   s2 MUTE [3.3,4.4) → W33;  s3 Q [4.4,5.0) → Q src [4.9,5.5): C3 M15
    it("(c) a camera with no audio stream + a master: renders, sound from the master throughout", async () => {
      const edl: Edl = {
        version: 1, clock: "master",
        sources: [MUTE, camQ(-500), MASTER],
        segments: [
          { id: "s0", inMs: 1000, outMs: 2200, video: "MUTE" },
          { id: "s1", inMs: 2200, outMs: 3300, video: "Q" },
          { id: "s2", inMs: 3300, outMs: 4400, video: "MUTE" },
          { id: "s3", inMs: 4400, outMs: 5000, video: "Q" },
        ],
      }
      const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-b1-mute-master", checkpoint: false })
      expect(await frameTokenRuns(outputPath)).toBe("W36 M9 Y24 W33 C3 M15")
      const d = await trackDetail(outputPath)
      expect(Number(d.vframes)).toBe(120)
      expect(Math.abs(d.audio - 4), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
      await expectSound(outputPath, edl)
    }, 180_000)

    // (c) No master: each segment sounds from its own camera, and the mute
    // camera's segments are digital SILENCE of exactly their length — the
    // sound after each one (440 Hz from camera A) starts on its cut, never early
    // or late. One pass, and in chunks (the option-B audio pass renders the
    // silence into lossless slices — the anullsrc input of `buildSliceCommand`).
    const muteOwnSound: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "A", url: fx("a.mp4"), kind: "video" }, MUTE],
      segments: [
        { id: "s0", inMs: 0, outMs: 700, video: "A" },
        { id: "s1", inMs: 700, outMs: 1300, video: "MUTE" },
        { id: "s2", inMs: 1300, outMs: 2100, video: "A" },
        { id: "s3", inMs: 2100, outMs: 2500, video: "MUTE" },
        { id: "s4", inMs: 2500, outMs: 3400, video: "A" },
      ],
    }
    for (const [label, opts] of [
      ["one pass", {}],
      ["in chunks", { chunkThreshold: 1, maxSegmentsPerChunk: 2 }],
    ] as const) {
      it(`(c) no master: a segment whose camera has no audio is silence of exactly its length — later cuts on time (${label})`, async () => {
        const { outputPath } = await render({
          edl: muteOwnSound, output: "video", quality: "final", jobId: `t-b1-mute-own-${label.replace(" ", "-")}`, checkpoint: false, ...opts,
        })
        expect(await frameTokenRuns(outputPath)).toBe("R21 W18 R24 W12 R27")
        const d = await trackDetail(outputPath)
        expect(Number(d.vframes)).toBe(102)
        expect(Math.abs(d.audio - 3.4), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
        await expectSound(outputPath, muteOwnSound)
      }, 180_000)
    }

    // (d) A LATE-STARTING camera: L (the time-coded camP file) begins 4 s after
    // the master's origin (offsetMs +4000). A segment inside its range renders
    // from it — one starting exactly at its origin reads its first frame — and
    // the neighbouring shape, a segment starting 0.5 s before it exists, is
    // refused at ingress naming the segment (the honest-window rule, before
    // anything is reserved; the executor's window check refuses it too).
    //   s0 Q [2.0,3.0) → Q src [2.5,3.5): M15 Y15;   s1 L [4.0,5.3) → L src [0,1.3): R30 G9
    //   s2 Q [5.3,6.0) → Q src [5.8,6.5): M6 Y15;    s3 L [6.5,7.7) → L src [2.5,3.7): B15 R21
    const lateCam = (s1InMs: number): Edl => ({
      version: 1, clock: "master",
      sources: [camP(4000, "L"), camQ(-500), MASTER],
      segments: [
        { id: "s0", inMs: 2000, outMs: 3000, video: "Q" },
        { id: "s1", inMs: s1InMs, outMs: 5300, video: "L" },
        { id: "s2", inMs: 5300, outMs: 6000, video: "Q" },
        { id: "s3", inMs: 6500, outMs: 7700, video: "L" },
      ],
    })

    it("(d) a late-starting camera: a segment inside its range renders from it; one starting before it is refused at ingress, named", async () => {
      const inRange = lateCam(4000)
      expect(validateEffectiveEdl(inRange, "video")).toEqual({ ok: true, issues: [] })
      const { outputPath } = await render({ edl: inRange, output: "video", quality: "final", jobId: "t-b1-late-cam", checkpoint: false })
      expect(await frameTokenRuns(outputPath)).toBe("M15 Y15 R30 G9 M6 Y15 B15 R21")
      const d = await trackDetail(outputPath)
      expect(Number(d.vframes)).toBe(126)
      await expectSound(outputPath, inRange)

      expect(validateEffectiveEdl(lateCam(3500), "video")).toEqual({
        ok: false,
        issues: [
          `segment[1] "s1": starts at 3500ms on the master clock but source "L" begins at 4000ms (offsetMs) — the segment would read before the source starts`,
        ],
      })
    }, 180_000)
  })
})
