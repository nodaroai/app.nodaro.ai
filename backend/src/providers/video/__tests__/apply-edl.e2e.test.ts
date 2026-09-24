/**
 * Real-ffmpeg integration test for the apply-edl executor (`../apply-edl.ts`).
 *
 * Follows the still-to-video.e2e / characterization precedent: a synchronous
 * ffmpeg-availability check so a machine without the binary skips cleanly (CI
 * installs ffmpeg), and a partial mock of ONLY `downloadFile` so the executor
 * "downloads" its sources from local lavfi fixtures instead of the network
 * (safeFetch's SSRF guard stays untouched).
 *
 * The synthetic sources encode BOTH channels the render must keep straight:
 *   - source A: solid RED  + a 440 Hz tone
 *   - source B: solid BLUE + an 880 Hz tone
 *   - source C: solid GREEN + a 660 Hz tone, with a +1000 ms master offset
 * so a colour probe verifies SEGMENT ORDER, a Goertzel tone probe verifies
 * AUDIO CONTINUITY + order, and the offset source verifies the D19 sign.
 *
 * The multicam shapes (Phase-2 B1) live in `apply-edl-multicam.e2e.test.ts`;
 * the fixture builders and decoders both files use, in `apply-edl-e2e-helpers.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe, probeStreamEnds } from "../ffmpeg-utils.js"
import type { Edl } from "@nodaro/shared"
import {
  ffmpegAvailable, mp3EncoderAvailable, makeSource, probeDurationSec, colourOfFrame, probeColor,
  frameRuns, probeTone, trackDetail, ONE_FRAME,
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

const { applyEdl, resolveChunksForOutput } = await import("../apply-edl.js")

describe.skipIf(!ffmpegAvailable)("applyEdl (real ffmpeg)", () => {
  let dir: string
  let srcA: string, srcB: string, srcC: string, srcVbr: string, srcArt: string, srcLive: string
  let srcLowFps: string, srcV6A3: string, srcV3A6: string, srcOff15: string, srcTs: string, srcTsJoined: string, srcTsRestart: string, srcRotated: string
  let srcCamA30: string, srcCamB24: string, srcMaster: string, srcSweep: string
  // Every successful render leaves its work dir (source copies + output) in
  // tmpdir; a failed one is cleaned by applyEdl itself. Collected and removed.
  const renderDirs: string[] = []
  const render = async (opts: Parameters<typeof applyEdl>[0]) => {
    const out = await applyEdl(opts)
    renderDirs.push(dirname(out.outputPath))
    return out
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "apply-edl-test-"))
    process.env.APPLY_EDL_FIXTURE_DIR = dir
    srcA = join(dir, "a.mp4"); srcB = join(dir, "b.mp4"); srcC = join(dir, "c.mp4")
    srcVbr = join(dir, "vbr.mp3"); srcArt = join(dir, "art.mp3"); srcLive = join(dir, "live.mkv")
    srcLowFps = join(dir, "lowfps.mp4"); srcV6A3 = join(dir, "v6a3.mp4"); srcV3A6 = join(dir, "v3a6.mp4")
    srcOff15 = join(dir, "off15.mp4"); srcTs = join(dir, "cam.ts"); srcTsJoined = join(dir, "joined.ts"); srcTsRestart = join(dir, "restart.ts"); srcRotated = join(dir, "rotated.mp4")
    srcCamA30 = join(dir, "camA30.mp4"); srcCamB24 = join(dir, "camB24.mp4"); srcMaster = join(dir, "master.m4a")
    srcSweep = join(dir, "sweep.mp4")
    await makeSource(srcA, "red", 440, 6)
    await makeSource(srcB, "blue", 880, 6)
    await makeSource(srcC, "green", 660, 6)
    // A 30 s VBR mp3 with NO Xing/Info header — its container under-reports.
    if (mp3EncoderAvailable) {
      await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=30", "-c:a", "libmp3lame", "-q:a", "9", "-write_xing", "0", srcVbr])
      // The same, with embedded cover art (an ID3 `attached_pic` video stream —
      // what almost every real podcast mp3 carries). Mapping that "video" into
      // a `-c copy -f null` pass made ffmpeg 8.1 report N/A, so the file went
      // unmeasured; the per-track probe must skip cover art and measure the sound.
      const cover = join(dir, "cover.png")
      await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=1:d=1", "-frames:v", "1", cover])
      await runFfmpeg(["-y", "-i", srcVbr, "-i", cover, "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "png", "-disposition:v", "attached_pic", "-id3v2_version", "3", "-write_xing", "0", srcArt])
    }
    // A 1 fps still-image video (an audiogram) with a 10 s sound track. With
    // B-frames the muxer's clock (`-c copy -f null` out_time) trails the real
    // picture end by the reorder delay in FRAME SPACING — seconds at 1 fps —
    // so a single-number probe refused a segment that ends where the picture
    // really ends. Per-track packet ends read 10 s for both.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:r=1:d=10",
      "-f", "lavfi", "-i", "sine=f=440:r=48000:d=10",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", srcLowFps,
    ])
    // Tracks of DIFFERENT lengths in one file (no -shortest): picture 6 s +
    // sound 3 s, and picture 3 s + sound 6 s. One number per file cannot
    // describe either; the render reads each track to its own end.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=6", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", srcV6A3,
    ])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=3", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", srcV3A6,
    ])
    // A 6 s source whose timestamps START at 1.5 s (`-output_ts_offset`, what
    // a .ts remux, an offset MKV or an mp4 with an initial empty edit look
    // like). Without -copyts the ffmpeg CLI shifts it back to 0 before `trim`
    // sees a frame, so a probe on the file's absolute clock read it 7.5 s long.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=6", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-output_ts_offset", "1.5", srcOff15,
    ])
    // An MPEG-TS remux with a large timestamp offset — a broadcast/OBS-style
    // container that re-anchors to the earliest MAPPED stream, so
    // format.start_time is NOT the render's zero. The probe must SKIP it
    // (both tracks unmeasured) rather than measure against the wrong clock.
    await runFfmpeg(["-y", "-i", srcA, "-c", "copy", "-muxdelay", "0", "-output_ts_offset", "3600", "-f", "mpegts", srcTs])
    // Three 6 s TS remuxes (red, blue, red) joined BYTE FOR BYTE — what `cat`-ed
    // recordings, a reconnecting stream dump or joined DVD VOBs look like. The
    // timestamps jump back at each join, so ffprobe's duration (last minus first
    // timestamp) declares ~6 s while the render plays all 18 s straight through.
    const tsRed = join(dir, "part-red.ts"), tsBlue = join(dir, "part-blue.ts")
    await runFfmpeg(["-y", "-i", srcA, "-c", "copy", "-f", "mpegts", tsRed])
    await runFfmpeg(["-y", "-i", srcB, "-c", "copy", "-f", "mpegts", tsBlue])
    const [red, blue] = await Promise.all([fs.readFile(tsRed), fs.readFile(tsBlue)])
    await fs.writeFile(srcTsJoined, Buffer.concat([red, blue, red]))
    // A recording whose clock RESTARTED more than 60 s below its first
    // timestamp (a broadcast/DVR capture, then an encoder restart at ~0):
    // libavformat takes the drop for a 33-bit wrap and adds 2^33 ticks, so the
    // join reads as one ~26.5 h FORWARD step and the container declares ~25 h.
    const tsLate = join(dir, "part-late.ts")
    await runFfmpeg(["-y", "-i", srcA, "-c", "copy", "-output_ts_offset", "3600", "-f", "mpegts", tsLate])
    await fs.writeFile(srcTsRestart, Buffer.concat([await fs.readFile(tsLate), blue]))
    // A 29.97 fps phone clip shot in portrait: its display-matrix side data
    // makes ffprobe append an empty csv field ("30000/1001,"), which read as
    // 30000 fps and laid the whole edit on a 60 fps canvas.
    const ntsc = join(dir, "ntsc.mp4")
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30000/1001:d=4", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", ntsc])
    await runFfmpeg(["-y", "-display_rotation", "90", "-i", ntsc, "-c", "copy", srcRotated])
    // A 6 s live-muxed Matroska (what a MediaRecorder writes) — no duration element.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=6",
      "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      "-f", "matroska", "-live", "1", srcLive,
    ])
    // A multicam pair whose frame rates DIFFER — a 30 fps camera and a 24 fps
    // camera — plus one continuous master-audio track. This is the shape of a
    // real two-cam podcast: the picture cuts between cameras while the sound
    // runs unbroken off the master. `pickTargetFps` sees {30, 24} and picks 30,
    // so every 24 fps segment is resampled to the 30 fps canvas. Resampling each
    // segment's DURATION independently rounds it to the output frame grid, and
    // over many fractional cuts that rounding accumulates into A/V drift against
    // the sample-exact audio — Track 0.14. 60 s each so a ~55 s, 90-cut edit fits.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=60",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", srcCamA30,
    ])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=60",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", srcCamB24,
    ])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=f=330:r=48000:d=60", "-c:a", "aac", srcMaster,
    ])
    // Cameras whose picture STOPS early: green ends at 7.0 s, yellow at 18.8 s —
    // a window reaching past them within SOURCE_END_TOLERANCE_SEC is accepted.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=green:s=320x240:r=30:d=7", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "camD7.mp4")])
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=yellow:s=320x240:r=30:d=18.8", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "camC18.mp4")])
    // A camera whose SOUND stops early: 6 s of magenta picture, 3 s of 660 Hz.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=magenta:s=320x240:r=30:d=6", "-f", "lavfi", "-i", "sine=f=660:r=48000:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(dir, "shortsound.mp4"),
    ])
    // Content that ENCODES TIME, so a read from the wrong second is visible (the
    // other fixtures are solid colours and constant tones, blind to it): the hue
    // turns 60°/s, and the tone steps 400→900 Hz every 2 s (12 s cycle).
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=160x120:r=30:d=60,hue=h=60*t",
      "-f", "lavfi", "-i", "aevalsrc=sin(2*PI*(400+100*mod(floor(t/2)\\,6))*t):s=48000:d=60",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-shortest", srcSweep,
    ])
  }, 180_000)

  afterAll(async () => {
    delete process.env.APPLY_EDL_FIXTURE_DIR
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    await Promise.all(renderDirs.map((d) => fs.rm(d, { recursive: true, force: true }).catch(() => {})))
  })

  // Three cut segments A→B→A (each 2 s) → a 6 s output whose colour and tone
  // flip red/440 → blue/880 → red/440 at 1 s / 3 s / 5 s.
  const threeSegmentEdl = (): Edl => ({
    version: 1,
    clock: "master",
    sources: [
      { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
      { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 2000, video: "A", audio: "A" },
      { id: "s1", inMs: 0, outMs: 2000, video: "B", audio: "B" },
      { id: "s2", inMs: 2000, outMs: 4000, video: "A", audio: "A" },
    ],
  })

  // A window past the source's end FAILS naming the segment — never a silently
  // shortened render (the EDL, the reserve and the caption remap all describe
  // the longer cut). The fixtures are 6 s long.
  it("fails, naming the segment and source, when a window runs past the media", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "A", url: "https://fixtures.test/a.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 9000, video: "A", audio: "A" }],
    }
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-overrun", checkpoint: false }))
      .rejects.toThrow(/segment\[0\] "s0" ends at 9\.00s on source "A"/)
  })

  // Inside the tolerance the segment keeps its FULL window: the picture holds its
  // last frame and the sound continues as silence past the 6 s source, so the
  // delivered length is the EDL's 6.4 s (a shorter segment would pull every later
  // cut ahead of the continuous audio in a longer edit).
  it("tolerates a sub-second overrun (track skew) and renders the full window, holding the last frame", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "A", url: "https://fixtures.test/a.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 6400, video: "A", audio: "A" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-overrun-ok", checkpoint: false })
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(Math.round(6.4 * 30))
    expect(Math.abs(d.audio - 6.4), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
    expect(colourOfFrame(await probeColor(outputPath, 6.3))).toBe("red") // the held last frame
  })

  // The probe reads on the render's clock: a source whose timestamps start at
  // 1.5 s is 6 s long to `trim`, not 7.5. Without subtracting the file's
  // start_time an overrun of up to 1.5 s (an hour, for a broadcast TS) passed
  // the check and the render came out short.
  it("measures a source whose timestamps start late on the render's clock — an overrun is refused, a full cut renders", async () => {
    const sources: Edl["sources"] = [{ id: "CAM", url: "https://fixtures.test/off15.mp4", kind: "video" }]
    const over: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 7300, video: "CAM", audio: "CAM" }] }
    await expect(applyEdl({ edl: over, output: "video", quality: "final", jobId: "t-off-over", checkpoint: false }))
      .rejects.toThrow(/source "CAM", but its (video|audio) track is only 6\.\d\ds long/)
    const full: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM", audio: "CAM" }] }
    const { outputPath } = await render({ edl: full, output: "video", quality: "final", jobId: "t-off-full", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)
  })

  // An MPEG-TS/PS container re-anchors timestamps to the earliest mapped
  // stream, so format.start_time is not the render's clock. The probe must not
  // measure against it (that would refuse correct edits or pass bad ones) — it
  // marks both tracks unmeasured, so the window check skips the source.
  it("marks an MPEG-TS source's tracks unmeasured, carrying the container's declared length as a coarse bound", async () => {
    const ends = await probeStreamEnds(srcTs)
    expect(ends.video.state).toBe("unmeasured")
    expect(ends.audio.state).toBe("unmeasured")
    const declared = ends.video.state === "unmeasured" ? ends.video.declaredEndSec : undefined
    expect(declared).toBeGreaterThan(5.5) // the 6 s fixture, offset by 3600 s
    expect(declared).toBeLessThan(6.6)
  })

  // Before: a segment running past an MPEG-TS source's end was not checked and,
  // with every read held past its source's end, rendered a frozen last frame
  // over silence for however long the overrun was — completed and billed. Now
  // the declared length bounds it: far past it fails the job (refunded, not
  // retried); inside the tolerance it renders its full window.
  it("refuses a segment running far past an MPEG-TS source's declared length; renders one inside the tolerance", async () => {
    const sources: Edl["sources"] = [{ id: "TS", url: "https://fixtures.test/cam.ts", kind: "video" }]
    const over: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 90_000, video: "TS", audio: "TS" }] }
    await expect(applyEdl({ edl: over, output: "video", quality: "final", jobId: "t-ts-over", checkpoint: false }))
      .rejects.toThrow(/segment\[0\] "s0" ends at 90\.00s on source "TS", but that file declares only 6\.\d\ds/)
    const inside: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 9_000, video: "TS", audio: "TS" }] }
    const { outputPath } = await render({ edl: inside, output: "video", quality: "final", jobId: "t-ts-inside", checkpoint: false })
    expect(await probeDurationSec(outputPath)).toBeCloseTo(9, 0)
  })

  // A TS whose timestamps jump back DECLARES less than it plays (ffprobe's
  // duration is last-minus-first timestamp): the byte-joined red|blue|red file
  // declares ~6 s of 18 s. Refusing against that declaration failed a correct
  // paid edit; the probe attaches the bound only for monotonic timestamps, so
  // this edit renders — all of it, with the joined parts' real content.
  it("renders a rotated 29.97 fps phone clip at its own rate, not on a 60 fps canvas", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "PH", url: "https://fixtures.test/rotated.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 3_000, video: "PH", audio: "PH" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-rotated", checkpoint: false })
    const out = (await runFfprobe(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=r_frame_rate,nb_read_packets", "-of", "csv=p=0", outputPath])).trim()
    const [rate, packets] = out.split("\n")[0]!.split(",")
    expect(rate).toMatch(/^(30000\/1001|2997\/100)$/)
    expect(Number(packets)).toBeGreaterThanOrEqual(89)
    expect(Number(packets)).toBeLessThanOrEqual(91)
  })

  it("never bounds a TS whose clock restarted (an unwrapped forward jump) by its multi-hour declared length", async () => {
    expect(await probeDurationSec(srcTsRestart)).toBeGreaterThan(3600) // precondition: the container really over-states it
    const ends = await probeStreamEnds(srcTsRestart)
    expect(ends.video).toMatchObject({ state: "unmeasured", reason: expect.stringMatching(/forward by more than 10 s/) })
    expect(ends.video).not.toHaveProperty("declaredEndSec")
  })

  it("never bounds a TS whose timestamps jump back (joined recordings) by its declared length — renders its real content", async () => {
    expect(await probeDurationSec(srcTsJoined)).toBeLessThan(7) // precondition: the container really under-states it
    const ends = await probeStreamEnds(srcTsJoined)
    expect(ends.video).toMatchObject({ state: "unmeasured", reason: expect.stringMatching(/timestamps jump/) })
    expect(ends.video).not.toHaveProperty("declaredEndSec")
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "TSJ", url: "https://fixtures.test/joined.ts", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 17_000, video: "TSJ", audio: "TSJ" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-ts-joined", checkpoint: false })
    // The canvas is the source's own 320×240 — a TS answer repeats each stream
    // under its program, which once read as height 1080 (a 320×1080 canvas).
    const dims = (await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", outputPath])).trim()
    expect(dims).toBe("320x240")
    expect(await probeDurationSec(outputPath)).toBeCloseTo(17, 0)
    const isBlue = (c: { r: number; g: number; b: number }) => c.b > 150 && c.r < 100 && c.g < 100
    expect(colourOfFrame(await probeColor(outputPath, 3))).toBe("red")
    expect(isBlue(await probeColor(outputPath, 9))).toBe(true) // the second part, not a frozen first-part frame
    expect(colourOfFrame(await probeColor(outputPath, 15))).toBe("red")
    expect(await probeTone(outputPath, 9, [440, 880])).toBe(880)
    expect(await probeTone(outputPath, 15, [440, 880])).toBe(440)
  })

  // The window check measures each source's REAL stream end, not the length
  // its container declares. Two containers that lie, both of which render
  // fine and both of which reach this executor from ordinary uploads:
  //   - an mp3 without a Xing/Info header (a re-cut / ad-stitched podcast
  //     file): ffprobe extrapolates from bitrate and UNDER-reports — a 30 s
  //     VBR encode declares ~27.85 s, and the gap grows with the file;
  //   - a live-muxed Matroska/WebM (a browser MediaRecorder recording):
  //     no duration element at all (`N/A`).
  // A check that trusted the declaration refused the first (a correct edit,
  // "source is only 27.85s long") and threw on the second, after reserve.
  it.skipIf(!mp3EncoderAvailable)("renders an edit to the real end of a VBR mp3 whose container under-reports its length", async () => {
    // Precondition — the fixture must actually lie, or this proves nothing.
    expect(await probeDurationSec(srcVbr)).toBeLessThan(29)
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "MIC", url: "https://fixtures.test/vbr.mp3", kind: "audio", role: "master-audio" }],
      segments: [{ id: "s0", inMs: 0, outMs: 30_000 }],
    }
    const { outputPath } = await render({ edl, output: "audio", quality: "final", jobId: "t-vbr", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(29.5)
    expect(dur).toBeLessThan(30.6)
  })

  it("renders from a live-muxed recording whose container declares no duration at all", async () => {
    // Precondition — the container really has nothing to declare.
    expect(Number.isNaN(await probeDurationSec(srcLive))).toBe(true)
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/live.mkv", kind: "video" }],
      segments: [{ id: "s0", inMs: 1000, outMs: 5000, video: "CAM", audio: "CAM" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-live", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(3.7)
    expect(dur).toBeLessThan(4.4)
  })

  // Track 0.14 — A/V drift on a MIXED-FPS multicam cut. Ninety fractional-length
  // cuts alternate a 30 fps and a 24 fps camera over one continuous master-audio
  // track (`role:"master-audio"`, so every segment's sound comes from it). The
  // 24 fps segments are resampled to the 30 fps canvas; a per-segment `fps`
  // filter resamples each cut's DURATION independently and the frame rounding
  // accumulates — this exact edit drifts +0.44 s (13 frames) on the old render,
  // while the sample-exact audio chain stays put. The fix lays the video on ONE
  // cumulative frame grid (each cut gets round(cumEnd·F)−round(cumStart·F)
  // frames), so the counts telescope to round(totalDur·F) and the video end
  // lands within a frame of the audio (measured +0.003 s). Per-track packet
  // ends (`probeStreamEnds`), not the container.
  const MULTICAM_SOURCES: Edl["sources"] = [
    { id: "A", url: "https://fixtures.test/camA30.mp4", kind: "video" },
    { id: "B", url: "https://fixtures.test/camB24.mp4", kind: "video" },
    { id: "MASTER", url: "https://fixtures.test/master.m4a", kind: "audio", role: "master-audio" },
  ]
  const alternatingCuts = (n: number, segMs: number): Edl["segments"] =>
    Array.from({ length: n }, (_, k) => ({
      id: `s${k}`, inMs: k * segMs, outMs: (k + 1) * segMs, video: k % 2 === 0 ? "A" : "B",
    }))

  // Exact output frames for a uniform-cut edit on the 30 fps canvas. The two real
  // guards are FRAME COUNT (a video graph that overflows on a cloud runner drops
  // frames while |video−audio| still looks fine — 60 in one graph dropped 74) and
  // the AUDIO END landing on the true total (the audio is rendered in one pass and
  // muxed on, so it is sample-exact — not chunk-concatenated). |video−audio| is
  // NOT asserted: a stream-copy concat leaves the container's video end a frame
  // long, which is a metadata artifact, not desync.
  const expectedFrames = (nCuts: number, segMs: number): number => Math.round((nCuts * segMs / 1000) * 30)

  it("renders every frame of a 90-cut mixed-fps multicam edit — no drop, audio on time (Track 0.14)", async () => {
    // 90 cuts is past the single-video-filtergraph cliff (a 90-wide graph drops
    // ~629 frames on the CI runner), so this exercises the auto-chunking to
    // VIDEO_FILTERGRAPH_MAX_SEGMENTS + the single-pass audio mux as well as the
    // grid: EXACTLY round(totalDur·30) frames, and audio landing on the total.
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments: alternatingCuts(90, 617) }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-av-drift", checkpoint: false })
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(expectedFrames(90, 617))
    expect(Math.abs(d.audio - 90 * 0.617), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
  }, 120_000)

  // The grid is GLOBAL, not per chunk: forced into ~5 chunks (threshold 20,
  // 20 segs/chunk), each chunk starts its frame count from its global output
  // position, so the stream-copy concat of the chunks holds round(totalDur·F)
  // frames end to end, and the single-pass audio still lands on the total.
  it("keeps the grid continuous across render chunks (Track 0.14)", async () => {
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments: alternatingCuts(90, 617) }
    const { outputPath } = await render({
      edl, output: "video", quality: "final", jobId: "t-av-drift-chunked",
      checkpoint: false, chunkThreshold: 20, maxSegmentsPerChunk: 20,
    })
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(expectedFrames(90, 617))
    expect(Math.abs(d.audio - 90 * 0.617), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
  }, 120_000)

  // A cut shorter than half a frame rounds to zero frames on the grid: it must
  // be DROPPED from the video chain (feeding a zero-frame stream to concat is an
  // error), while its audio still plays and the neighbours' frame counts absorb
  // the rounding — the render still succeeds and stays on grid.
  it("drops a sub-frame cut from the video chain without drifting (Track 0.14)", async () => {
    const segments: Edl["segments"] = [
      { id: "s0", inMs: 0, outMs: 2000, video: "A" },
      { id: "s1", inMs: 2000, outMs: 2010, video: "B" }, // 10 ms → 0 frames at 30 fps
      { id: "s2", inMs: 2010, outMs: 4010, video: "A" },
    ]
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-av-drift-zero", checkpoint: false })
    const d = await trackDetail(outputPath)
    // s0 (60f) + s1 (0f, dropped) + s2 (60f) = round(4.010·30) = 120 frames.
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(Math.round(4.010 * 30))
    expect(d.drift).toBeLessThan(ONE_FRAME)
  }, 120_000)

  // A crossfade makes its chunk take the per-segment `fps` path, which does not
  // land on the frame grid (~0.4 s over 30 mixed-fps cuts). Before option B the
  // next chunk's own audio re-synced at the seam; with ONE continuous audio
  // track nothing would, so the chunk's END is held to the grid. Chunks close at
  // hard cuts every 30 segments ([0-29] [30-59] [60-89]); the crossfade INTO
  // segment 61 sits at chunk 2's local index 1 — the one spot a crossfade
  // renders today (a crossfade after a cut inside a chunk renders too since Track 0.15).
  it("holds a crossfade chunk's end to the frame grid — no offset carried past it (Track 0.14)", async () => {
    const segments = alternatingCuts(90, 617).map((s, i) =>
      i === 61 ? { ...s, transition: { type: "crossfade" as const, durationMs: 300 } } : s,
    )
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-av-drift-xfade", checkpoint: false })
    const d = await trackDetail(outputPath)
    const totalSec = 90 * 0.617 - 0.3
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(Math.round(totalSec * 30))
    expect(Math.abs(d.audio - totalSec), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
  }, 180_000)

  // Past 200 segments the audio pass renders in slices of at most 100 (one audio
  // graph over every segment grows ~N^3 in cost and its argv passes Linux's
  // 128 KiB limit near 800). The slices are lossless PCM, joined sample-exactly
  // and encoded to AAC once — so the audio still ends on the true total.
  it("a >200-cut edit renders its audio in lossless slices joined once — every frame, audio on time (Track 0.14)", async () => {
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments: alternatingCuts(250, 200) }
    ff.calls.length = 0
    ff.atConcat.length = 0
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-av-drift-250", checkpoint: false })
    // One PCM slice per AUDIO-plan chunk (3 for 250 cuts) — never one
    // whole-timeline audio graph, whose cost grows ~N³.
    expect(ff.calls.filter((a) => a.includes("pcm_f32le"))).toHaveLength(resolveChunksForOutput(edl.segments, "audio").length)
    expect(resolveChunksForOutput(edl.segments, "audio").length).toBeGreaterThan(1)
    // Scratch disk: the sources die at their last read (the audio pass), before
    // the chunk concat — never alongside the chunks, the picture, the PCM and
    // the output at the mux (~40 GB on a 3-hour 1080p render).
    expect(ff.atConcat.at(-1)?.some((f) => f.startsWith("src-"))).toBe(false)
    expect(ff.atConcat.at(-1)?.some((f) => f.startsWith("audio-") && f.endsWith(".wav"))).toBe(true)
    // Every graph goes to ffmpeg as a FILE — never on argv (Linux E2BIG at 128 KiB).
    expect(ff.calls.some((a) => a.includes("-filter_complex"))).toBe(false)
    expect(ff.calls.filter((a) => a.includes("-/filter_complex")).length).toBeGreaterThan(0)
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(expectedFrames(250, 200))
    expect(Math.abs(d.audio - 250 * 0.2), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
  }, 240_000)

  // Resume safety. A checkpoint is found only under a hash of the exact command
  // that renders it, so an object left by a different plan — here the names the
  // pre-fix code wrote (`chunk-<c>.mp4`, 100-segment chunks WITH audio), i.e. an
  // attempt that started before a deploy — is simply never read. Before the
  // fix it was spliced in: 156 s of scrambled picture over 100 s of audio,
  // completed, billed, and its checkpoints deleted.
  it("never splices a checkpoint rendered for another plan into the render (resume across a deploy)", async () => {
    r2.reset()
    const jobId = "t-resume-stale"
    const wrongPicture = await fs.readFile(srcCamA30)
    for (let c = 0; c < 3; c++) r2.objects.set(`apply-edl-cache/${jobId}/chunk-${c}.mp4`, wrongPicture)
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments: alternatingCuts(90, 617) }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId, checkpoint: true })
    const d = await trackDetail(outputPath)
    expect(r2.downloads).toEqual([])
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(expectedFrames(90, 617))
    expect(Math.abs(d.audio - 90 * 0.617)).toBeLessThan(ONE_FRAME)
    // This run's own checkpoints (fingerprinted) were uploaded, then deleted
    // once the final output existed; the foreign objects were never touched.
    expect(r2.uploads).toHaveLength(3)
    expect(r2.uploads.every((k) => /^apply-edl-cache\/t-resume-stale\/chunk-\d+-[0-9a-f]{16}\.mp4$/.test(k))).toBe(true)
    expect([...r2.deletes].sort()).toEqual([...r2.uploads].sort())
    expect([...r2.objects.keys()].sort()).toEqual([0, 1, 2].map((c) => `apply-edl-cache/${jobId}/chunk-${c}.mp4`))
  }, 180_000)

  it("a retry on a fresh work dir resumes every chunk (the key ignores per-run paths) and renders the same edit", async () => {
    r2.reset()
    r2.keepOnDelete = true // the first attempt "dies" before its cleanup
    const jobId = "t-resume-fresh"
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments: alternatingCuts(90, 617) }
    await render({ edl, output: "video", quality: "final", jobId, checkpoint: true })
    const firstUploads = [...r2.uploads]
    expect(firstUploads).toHaveLength(3)
    r2.downloads.length = 0
    r2.uploads.length = 0
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId, checkpoint: true })
    expect([...r2.downloads].sort()).toEqual([...firstUploads].sort())
    expect(r2.uploads).toEqual([]) // nothing re-rendered
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(expectedFrames(90, 617))
    expect(Math.abs(d.audio - 90 * 0.617)).toBeLessThan(ONE_FRAME)
    r2.reset()
  }, 180_000)

  it("keeps every checkpoint when the audio mux fails, so the retry resumes instead of re-rendering", async () => {
    r2.reset()
    const jobId = "t-resume-muxfail"
    const edl: Edl = { version: 1, clock: "master", sources: MULTICAM_SOURCES, segments: alternatingCuts(90, 617) }
    ff.failWhen = (a) => a.includes("1:a:0") // the final join/encode/mux
    try {
      await expect(applyEdl({ edl, output: "video", quality: "final", jobId, checkpoint: true })).rejects.toThrow(/injected/)
    } finally {
      ff.failWhen = undefined
    }
    const firstUploads = [...r2.uploads]
    expect(firstUploads).toHaveLength(3)
    expect(r2.deletes).toEqual([])
    r2.uploads.length = 0
    await render({ edl, output: "video", quality: "final", jobId, checkpoint: true })
    expect([...r2.downloads].sort()).toEqual([...firstUploads].sort())
    expect(r2.uploads).toEqual([])
    r2.reset()
  }, 180_000)

  // A/V SYNC IN TIME, not just in length. The colour at 0.1 s after a cut and
  // 0.1 s before the next one must both be that segment's camera: a picture
  // shifted by more than ~0.1 s either way shows a neighbour instead.
  const colourOf = (c: { r: number; g: number; b: number }): string =>
    c.r > 150 && c.g > 150 && c.b < 100 ? "yellow"
      : c.r > 150 && c.g < 100 && c.b < 100 ? "red"
      : c.b > 150 && c.r < 100 && c.g < 100 ? "blue"
      : c.g > 90 && c.r < 100 && c.b < 100 ? "green"
      : `?(${c.r},${c.g},${c.b})`
  const expectCutOnTime = async (path: string, k: number, segSec: number, colour: string) => {
    expect(colourOf(await probeColor(path, k * segSec + 0.1)), `segment ${k} start`).toBe(colour)
    expect(colourOf(await probeColor(path, (k + 1) * segSec - 0.1)), `segment ${k} end`).toBe(colour)
  }
  const withShortCams: Edl["sources"] = [
    ...MULTICAM_SOURCES,
    { id: "D", url: "https://fixtures.test/camD7.mp4", kind: "video" },
    { id: "D2", url: "https://fixtures.test/camD7.mp4", kind: "video", offsetMs: -500 },
    { id: "C", url: "https://fixtures.test/camC18.mp4", kind: "video" },
  ] as Edl["sources"]

  // A camera that stops a beat early. Segment 11 ([6.787, 7.404] s) reads camera
  // D, whose picture ends at 7.0 s — inside the tolerance, so accepted. Its
  // picture holds D's last frame to the end of its window; every later cut —
  // inside chunk 0 and in the later chunks — stays on time against the single
  // continuous audio. (Before, the segment came up ~12 frames short and, under
  // option B, every later cut played 0.4 s ahead of the sound.)
  it("a picture that ends inside the tolerance holds its last frame — every later cut stays on time (Track 0.14)", async () => {
    const segments = alternatingCuts(90, 617).map((s, i) => (i === 11 ? { ...s, video: "D" } : s))
    const edl: Edl = { version: 1, clock: "master", sources: withShortCams, segments }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-short-cam", checkpoint: false })
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(expectedFrames(90, 617))
    expect(Math.abs(d.audio - 90 * 0.617)).toBeLessThan(ONE_FRAME)
    await expectCutOnTime(outputPath, 11, 0.617, "green") // incl. the frozen tail past 7.0 s
    await expectCutOnTime(outputPath, 12, 0.617, "red") // chunk 0, right after the short read
    await expectCutOnTime(outputPath, 13, 0.617, "blue")
    await expectCutOnTime(outputPath, 81, 0.617, "blue") // chunk 2
  }, 180_000)

  // The same camera read through an offset that puts the WHOLE window past its
  // last frame ([7.287, 7.904] s, still inside the tolerance): nothing to trim,
  // the held source supplies its frozen last frame for the full window.
  it("a window that starts past the picture's end renders its frozen last frame — nothing shifts (Track 0.14)", async () => {
    const segments = alternatingCuts(90, 617).map((s, i) => (i === 11 ? { ...s, video: "D2" } : s))
    const edl: Edl = { version: 1, clock: "master", sources: withShortCams, segments }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-past-end", checkpoint: false })
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(expectedFrames(90, 617))
    await expectCutOnTime(outputPath, 11, 0.617, "green")
    await expectCutOnTime(outputPath, 12, 0.617, "red")
    await expectCutOnTime(outputPath, 13, 0.617, "blue")
    await expectCutOnTime(outputPath, 81, 0.617, "blue")
  }, 180_000)

  // A crossfade whose OUTGOING side runs out: segment 30 ([18.51, 19.127] s)
  // reads camera C, which ends at 18.8 s, and crossfades into 31 (local index 1
  // of chunk 1). The short outgoing input used to make xfade emit timestamps
  // that did not advance, which the encoder dropped (538 of 547 frames).
  it("a crossfade out of a picture that ends inside the tolerance still ends its chunk on the grid (Track 0.14)", async () => {
    const segments = alternatingCuts(90, 617).map((s, i) =>
      i === 30 ? { ...s, video: "C" } : i === 31 ? { ...s, transition: { type: "crossfade" as const, durationMs: 300 } } : s,
    )
    const edl: Edl = { version: 1, clock: "master", sources: withShortCams, segments }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-xfade-short", checkpoint: false })
    const d = await trackDetail(outputPath)
    const totalSec = 90 * 0.617 - 0.3
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(Math.round(totalSec * 30))
    expect(Math.abs(d.audio - totalSec)).toBeLessThan(ONE_FRAME)
    // chunk 2 (segments 60-89) sits 0.3 s earlier on the timeline (the crossfade)
    expect(colourOf(await probeColor(outputPath, 81 * 0.617 - 0.3 + 0.1))).toBe("blue")
    expect(colourOf(await probeColor(outputPath, 82 * 0.617 - 0.3 - 0.1))).toBe("blue")
  }, 180_000)

  // The same for SOUND. No master track: each cut's sound is its own camera's.
  // Camera SS's sound stops at 3.0 s; the cut reading it at [3.24, 3.6] s is
  // inside the tolerance, so accepted — its sound is padded with silence to the
  // full window, and the cuts after it (in later chunks) are heard on time.
  it("a sound that ends inside the tolerance pads with silence — every later cut is heard on time (Track 0.14)", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [
        { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
        { id: "SS", url: "https://fixtures.test/shortsound.mp4", kind: "video" },
      ],
      // 11 cuts of 360 ms over [0, 3.96): even → A (440 Hz), odd → SS (660 Hz).
      // Cut 9 = [3.24, 3.6) reads SS past its 3.0 s sound. (360 ms keeps the
      // frame total off a .5 rounding tie.)
      segments: Array.from({ length: 11 }, (_, k) => ({
        id: `c${k}`, inMs: k * 360, outMs: (k + 1) * 360, video: k % 2 === 0 ? "A" : "SS", audio: k % 2 === 0 ? "A" : "SS",
      })),
    }
    const { outputPath } = await render({
      edl, output: "video", quality: "final", jobId: "t-short-sound", checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 4,
    })
    const d = await trackDetail(outputPath)
    expect(Number(d.vframes), `frames ${JSON.stringify(d)}`).toBe(Math.round(11 * 0.36 * 30))
    expect(Math.abs(d.audio - 11 * 0.36), `audio end ${JSON.stringify(d)}`).toBeLessThan(ONE_FRAME)
    // Cut 10 (A, 440 Hz) after the padded cut 9 — and in the next chunk — is heard on time.
    expect(await probeTone(outputPath, 10 * 0.36 - 0.02, [440, 660])).toBe(440)
    expect(await probeTone(outputPath, 8 * 0.36 - 0.02, [440, 660])).toBe(440)
  }, 180_000)

  // Input seeking reads each source from its window, not from t=0. A read from
  // the wrong second is invisible on solid-colour fixtures, so this one uses
  // content that encodes time (hue 60°/s, tone stepping every 2 s) and checks
  // the rendered picture AND sound against the source time each window names —
  // windows out of order, deep in the file, one past the 2 s seek margin.
  it("seeked reads land on the right source second — picture and sound (Track 0.14)", async () => {
    const windows = [[41.3, 42.1], [25.2, 26.0], [52.7, 53.5], [3.1, 3.9]] as const
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "S", url: "https://fixtures.test/sweep.mp4", kind: "video" }],
      segments: windows.map(([a, b], k) => ({ id: `w${k}`, inMs: a * 1000, outMs: b * 1000, video: "S", audio: "S" })),
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-seek-sweep", checkpoint: false })
    const hueOf = ({ r, g, b }: { r: number; g: number; b: number }): number => {
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
      if (d === 0) return 0
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return (h * 60 + 360) % 360
    }
    const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
    for (let k = 0; k < windows.length; k++) {
      const outAt = k * 0.8 + 0.4 // mid-window on the output timeline
      const srcAt = windows[k][0] + 0.4
      const hue = hueOf(await probeColor(outputPath, outAt))
      // hue=h=60*t rotates red's hue by 60°/s; a 2 s misread would be 120° off.
      expect(hueGap(hue, (60 * srcAt) % 360), `window ${k}: hue ${hue.toFixed(0)} vs ${((60 * srcAt) % 360).toFixed(0)}`).toBeLessThan(25)
      const want = 400 + 100 * (Math.floor(srcAt / 2) % 6)
      expect(await probeTone(outputPath, outAt - 0.2, [400, 500, 600, 700, 800, 900]), `window ${k} tone`).toBe(want)
    }
  }, 180_000)

  it("still fails an overrun on a live-muxed recording — the real end is measured, not skipped", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/live.mkv", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 9000, video: "CAM", audio: "CAM" }],
    }
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-live-overrun", checkpoint: false }))
      .rejects.toThrow(/segment\[0\] "s0" ends at 9\.00s on source "CAM", but its video track is only 6\.\d\ds long/)
  })

  it.skipIf(!mp3EncoderAvailable)("measures a podcast mp3 with embedded cover art — an overrun on it is refused, a full-length cut renders", async () => {
    // Preconditions — the fixture really carries cover art AND lies about its length.
    const listing = JSON.parse(await runFfprobe(["-v", "error", "-show_entries", "stream=codec_type:stream_disposition=attached_pic", "-of", "json", srcArt])) as { streams: Array<{ codec_type: string; disposition?: { attached_pic?: number } }> }
    expect(listing.streams.some((st) => st.codec_type === "video" && st.disposition?.attached_pic === 1)).toBe(true)
    expect(await probeDurationSec(srcArt)).toBeLessThan(29)
    const sources: Edl["sources"] = [{ id: "MIC", url: "https://fixtures.test/art.mp3", kind: "audio", role: "master-audio" }]
    const over: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 40_000 }] }
    // Refused ⇒ the sound track WAS measured (an unmeasured file would render short, silently).
    await expect(applyEdl({ edl: over, output: "audio", quality: "final", jobId: "t-art-overrun", checkpoint: false }))
      .rejects.toThrow(/source "MIC", but its audio track is only 30\.\d\ds long/)
    const full: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 30_000 }] }
    const { outputPath } = await render({ edl: full, output: "audio", quality: "final", jobId: "t-art", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(29.5)
    expect(dur).toBeLessThan(30.6)
  })

  it.skipIf(!mp3EncoderAvailable)("refuses a picture taken from a file whose only 'video' is cover art — never renders a still", async () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "POD", url: "https://fixtures.test/art.mp3", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "POD" }],
    }
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-cover-only", checkpoint: false }))
      .rejects.toThrow(/segment\[0\] "s0" takes its picture from source "POD", but that source has no video track/)
  })

  it("renders a 1 fps still-image video to its full length — the picture's PTS end, not the muxer's clock — and refuses beyond it", async () => {
    // Precondition — the fixture has B-frame reordering, which is what made the
    // muxer's clock read seconds short. Without it this case proves nothing.
    const bf = (await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=has_b_frames", "-of", "csv=p=0", srcLowFps])).trim()
    expect(Number(bf)).toBeGreaterThan(0)
    const over: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/lowfps.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 12_000, video: "CAM", audio: "CAM" }],
    }
    // Refused naming 10 s ⇒ the track was MEASURED at its real end (not skipped, not 8 s).
    await expect(applyEdl({ edl: over, output: "video", quality: "final", jobId: "t-lowfps-over", checkpoint: false }))
      .rejects.toThrow(/video track is only 10\.\d\ds long/)
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/lowfps.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 10_000, video: "CAM", audio: "CAM" }],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-lowfps", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(9.5)
    expect(dur).toBeLessThan(10.6)
  })

  it("a file whose picture outlasts its sound: refused on the AUDIO track for a video render, unless the sound comes from a longer source", async () => {
    const own: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "CAM", url: "https://fixtures.test/v6a3.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM", audio: "CAM" }],
    }
    await expect(applyEdl({ edl: own, output: "video", quality: "final", jobId: "t-v6a3-own", checkpoint: false }))
      .rejects.toThrow(/source "CAM", but its audio track is only 3\.\d\ds long/)
    const mic: Edl = {
      version: 1, clock: "master",
      sources: [
        { id: "CAM", url: "https://fixtures.test/v6a3.mp4", kind: "video" },
        { id: "MIC", url: "https://fixtures.test/a.mp4", kind: "audio", role: "master-audio" },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM" }],
    }
    const { outputPath } = await render({ edl: mic, output: "video", quality: "final", jobId: "t-v6a3-mic", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)
  })

  it("a file whose sound outlasts its picture: an audio-only cut renders to the sound's end, a video render is refused on the VIDEO track", async () => {
    const sources: Edl["sources"] = [{ id: "CAM", url: "https://fixtures.test/v3a6.mp4", kind: "video" }]
    const edl: Edl = { version: 1, clock: "master", sources, segments: [{ id: "s0", inMs: 0, outMs: 6000, video: "CAM", audio: "CAM" }] }
    const { outputPath } = await render({ edl, output: "audio", quality: "final", jobId: "t-v3a6-audio", checkpoint: false })
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)
    await expect(applyEdl({ edl, output: "video", quality: "final", jobId: "t-v3a6-video", checkpoint: false }))
      .rejects.toThrow(/source "CAM", but its video track is only 3\.\d\ds long/)
  })

  it("renders segment order (colour) + audio continuity (tone) + duration", async () => {
    const edl = threeSegmentEdl()
    const { outputPath, durationMs } = await render({ edl, output: "video", quality: "final", jobId: "t-order", checkpoint: false })
    expect(durationMs).toBe(6000)
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(5.7)
    expect(dur).toBeLessThan(6.4)

    const c1 = await probeColor(outputPath, 1)
    expect(c1.r).toBeGreaterThan(c1.b + 40)
    const c3 = await probeColor(outputPath, 3)
    expect(c3.b).toBeGreaterThan(c3.r + 40)
    const c5 = await probeColor(outputPath, 5)
    expect(c5.r).toBeGreaterThan(c5.b + 40)

    expect(await probeTone(outputPath, 1, [440, 880])).toBe(440)
    expect(await probeTone(outputPath, 3, [440, 880])).toBe(880)
    expect(await probeTone(outputPath, 5, [440, 880])).toBe(440)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("chunked render equals single-pass (same duration, colour and tone at every boundary)", async () => {
    const edl = threeSegmentEdl()
    const single = await render({ edl, output: "video", quality: "final", jobId: "t-single", checkpoint: false })
    // Force one chunk PER segment (all boundaries are hard cuts → chunkable),
    // with checkpointing off so no R2 is touched.
    const chunked = await render({ edl, output: "video", quality: "final", jobId: "t-chunked", checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 1 })

    expect(chunked.durationMs).toBe(single.durationMs)
    const [ds, dc] = [await probeDurationSec(single.outputPath), await probeDurationSec(chunked.outputPath)]
    expect(Math.abs(ds - dc)).toBeLessThan(0.3)

    for (const t of [1, 3, 5]) {
      const cs = await probeColor(single.outputPath, t)
      const cc = await probeColor(chunked.outputPath, t)
      // Same dominant channel at each boundary.
      expect(Math.sign(cs.r - cs.b)).toBe(Math.sign(cc.r - cc.b))
      expect(await probeTone(chunked.outputPath, t, [440, 880])).toBe(await probeTone(single.outputPath, t, [440, 880]))
    }
    await fs.rm(single.outputPath, { force: true })
    await fs.rm(chunked.outputPath, { force: true })
  }, 180_000)

  it("applies the D19 source offset (masterMs = sourceMs + offsetMs)", async () => {
    // Source C is GREEN/660 with a +1000 ms offset: a segment on master
    // [1000,3000] maps to source time [0,2000], so the render shows green.
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "C", url: "https://fixtures.test/c.mp4", kind: "video", offsetMs: 1000 }],
      segments: [{ id: "s0", inMs: 1000, outMs: 3000, video: "C", audio: "C" }],
    }
    const { outputPath, durationMs } = await render({ edl, output: "video", quality: "final", jobId: "t-offset", checkpoint: false })
    expect(durationMs).toBe(2000)
    const c = await probeColor(outputPath, 1)
    expect(c.g).toBeGreaterThan(c.r + 30)
    expect(c.g).toBeGreaterThan(c.b + 30)
    expect(await probeTone(outputPath, 1, [440, 660, 880])).toBe(660)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("renders an audio-only cut (no video graph)", async () => {
    const edl = threeSegmentEdl()
    const { outputPath, durationMs } = await render({ edl, output: "audio", quality: "final", jobId: "t-audio", checkpoint: false })
    expect(durationMs).toBe(6000)
    // No video stream on an audio-only render.
    const vstreams = await runFfprobe(["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_type", "-of", "csv=p=0", outputPath])
    expect(vstreams.trim()).toBe("")
    expect(await probeTone(outputPath, 1, [440, 880])).toBe(440)
    expect(await probeTone(outputPath, 3, [440, 880])).toBe(880)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  // Track 0.15: a hard cut joined with `concat` leaves the chain on concat's
  // microsecond timebase, while every segment (and every xfade output) is on
  // 1/fps — so a crossfade that FOLLOWS a cut inside one chunk handed xfade two
  // different timebases and the render failed (all three retries). Hard cuts
  // plus one dissolve is an ordinary edit shape.
  it("renders cut, cut, then a crossfade — frame count, picture and the dissolve all on time (Track 0.15)", async () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [
        { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
        { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
        { id: "C", url: "https://fixtures.test/c.mp4", kind: "video" },
      ],
      segments: [
        { id: "s0", inMs: 0, outMs: 2000, video: "A", audio: "A" },
        { id: "s1", inMs: 0, outMs: 2000, video: "B", audio: "B" },
        { id: "s2", inMs: 0, outMs: 2000, video: "A", audio: "A" },
        { id: "s3", inMs: 0, outMs: 2000, video: "C", audio: "C", transition: { type: "crossfade", durationMs: 500 } },
      ],
    }
    // 4 × 2000 − 500 overlap = 7500 ms → 225 frames at 30 fps.
    const { outputPath, durationMs } = await render({ edl, output: "video", quality: "final", jobId: "t-cut-xfade", checkpoint: false })
    expect(durationMs).toBe(7500)
    // Every frame: 60 red (s0), 60 blue (s1 — the hard cuts land exactly on
    // frames 60 and 120), then s2 red into the 0.5 s dissolve (frames 165-180,
    // whose early frames still read red and late ones green) and green (s3) to
    // the end — 225 frames in all, no frame dropped at either cut.
    const runs = await frameRuns(outputPath)
    expect(runs.startsWith("R60 B60 R"), runs).toBe(true)
    const tail = runs.split(" ").slice(2) // s2 red, the dissolve, s3 green
    const lens = tail.map((r) => Number(r.slice(1)))
    expect(tail[tail.length - 1]!.startsWith("G"), runs).toBe(true)
    expect(lens[0]!, runs).toBeGreaterThanOrEqual(45) // pure s2 until the dissolve starts
    expect(lens[0]!, runs).toBeLessThanOrEqual(60)
    expect(lens[lens.length - 1]!, runs).toBeGreaterThanOrEqual(45) // pure s3 after it ends
    expect(runs.split(" ").reduce((n, run) => n + Number(run.slice(1)), 0), runs).toBe(225)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  // The degenerate joins a crossfade chunk must keep frame-exact (review of
  // #1597): a bare `fps` after `concat` resampled concat's own timestamps,
  // which are wrong next to a zero-frame sliver or a one-frame input, and
  // dropped a real frame there — every later cut one frame early, hidden by a
  // clone at the chunk's end. Dev renders the first shape correctly.
  it("a crossfade, then a hard cut to a zero-frame sliver: the next cut still lands on its grid frame (Track 0.15)", async () => {
    const sources: Edl["sources"] = [
      { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
      { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
      { id: "C", url: "https://fixtures.test/c.mp4", kind: "video" },
    ]
    const edl: Edl = {
      version: 1, clock: "master", sources,
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" },
        { id: "s1", inMs: 0, outMs: 1000, video: "B", audio: "B", transition: { type: "crossfade", durationMs: 300 } },
        { id: "s2", inMs: 505, outMs: 515, video: "C", audio: "C" }, // 10 ms: holds no source frame
        { id: "s3", inMs: 0, outMs: 1000, video: "A", audio: "A" },
      ],
    }
    // 1000 + 1000 − 300 + 10 + 1000 = 2710 ms → 81 frames; s3 starts at
    // 1.71 s → frame round(51.3) = 51, so the last run is exactly 30 red.
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-xfade-sliver", checkpoint: false })
    const runs = await frameRuns(outputPath)
    expect(runs.endsWith(" R30"), runs).toBe(true)
    expect(runs.split(" ").reduce((n, run) => n + Number(run.slice(1)), 0), runs).toBe(81)
    expect(runs, "no green frame from the sliver").not.toMatch(/G/)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("a one-frame first segment, a hard cut, then a crossfade: the first frame is kept (Track 0.15)", async () => {
    const sources: Edl["sources"] = [
      { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
      { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
      { id: "C", url: "https://fixtures.test/c.mp4", kind: "video" },
    ]
    const edl: Edl = {
      version: 1, clock: "master", sources,
      segments: [
        { id: "s0", inMs: 0, outMs: 30, video: "A", audio: "A" }, // one frame at 30 fps
        { id: "s1", inMs: 0, outMs: 1000, video: "B", audio: "B" },
        { id: "s2", inMs: 0, outMs: 1000, video: "C", audio: "C", transition: { type: "crossfade", durationMs: 300 } },
      ],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-1f-first", checkpoint: false })
    const runs = await frameRuns(outputPath)
    expect(runs.startsWith("R1 B"), runs).toBe(true)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  // Track 0.16: a crossfade's offset counted NOMINAL seconds while each
  // segment's `fps` output rounds (a sliver or one-frame segment rounds UP),
  // so after short segments the joined picture ran long and xfade cut real
  // frames off the segment before the dissolve. Offsets are now whole frames
  // of the accumulated picture on the global grid.
  it("short segments before a crossfade: every segment keeps its grid frames and the dissolve starts on its frame (Track 0.16)", async () => {
    const sources: Edl["sources"] = [
      { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
      { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
      { id: "C", url: "https://fixtures.test/c.mp4", kind: "video" },
    ]
    const edl: Edl = {
      version: 1, clock: "master", sources,
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" }, //   frames  0-30  red
        { id: "s1", inMs: 0, outMs: 40, video: "B", audio: "B" }, //     frame  30     blue
        { id: "s2", inMs: 0, outMs: 40, video: "C", audio: "C" }, //     frame  31     green
        { id: "s3", inMs: 0, outMs: 1000, video: "A", audio: "A" }, //   frames 32-62  red
        { id: "s4", inMs: 0, outMs: 1000, video: "B", audio: "B", transition: { type: "crossfade", durationMs: 300 } },
        //  s4 starts at 1.78 s → frame 53; the dissolve spans frames 53-62; blue to frame 83
      ],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-short-then-xfade", checkpoint: false })
    const runs = await frameRuns(outputPath, true)
    const parts = runs.split(" ")
    expect(parts.slice(0, 3).join(" "), runs).toBe("R30 B1 G1")
    expect(parts[3], runs).toMatch(/^R2[12]$/) // s3's 21 pure frames (+ at most the dissolve's untouched first frame)
    expect(runs.split(" ").reduce((n, run) => n + Number(run.slice(1)), 0), runs).toBe(83)
    expect(parts[parts.length - 1], runs).toMatch(/^B2[01]$/)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("a crossfade shorter than one frame is a clean cut on the grid (Track 0.16)", async () => {
    const sources: Edl["sources"] = [
      { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
      { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
    ]
    const edl: Edl = {
      version: 1, clock: "master", sources,
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" },
        { id: "s1", inMs: 0, outMs: 1000, video: "B", audio: "B", transition: { type: "crossfade", durationMs: 10 } },
      ],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-subframe-xfade", checkpoint: false })
    expect(await frameRuns(outputPath, true)).toBe("R30 B30")
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("a crossfade into a zero-frame sliver drops the sliver and cuts cleanly to the next segment (Track 0.16)", async () => {
    const sources: Edl["sources"] = [
      { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
      { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
      { id: "C", url: "https://fixtures.test/c.mp4", kind: "video" },
    ]
    const edl: Edl = {
      version: 1, clock: "master", sources,
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" },
        { id: "s1", inMs: 505, outMs: 515, video: "C", audio: "C", transition: { type: "crossfade", durationMs: 9 } },
        { id: "s2", inMs: 0, outMs: 1000, video: "B", audio: "B" },
      ],
    }
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-xfade-into-sliver", checkpoint: false })
    expect(await frameRuns(outputPath, true)).toBe("R30 B30")
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("renders a cut then a crossfade on a fractional 29.97 fps canvas, ending exactly on the grid (Track 0.15)", async () => {
    const src = [{ id: "N", url: "https://fixtures.test/ntsc.mp4", kind: "video" as const }]
    const edl: Edl = {
      version: 1, clock: "master", sources: src,
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "N", audio: "N" },
        { id: "s1", inMs: 1000, outMs: 2000, video: "N", audio: "N" },
        { id: "s2", inMs: 2000, outMs: 3000, video: "N", audio: "N", transition: { type: "crossfade", durationMs: 500 } },
      ],
    }
    // 3000 − 500 = 2500 ms → round(2.5 × 29.97) = 75 frames.
    const { outputPath } = await render({ edl, output: "video", quality: "final", jobId: "t-cut-xfade-ntsc", checkpoint: false })
    const out = (await runFfprobe(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=r_frame_rate,nb_read_packets", "-of", "csv=p=0", outputPath])).trim().split("\n")[0]!.split(",")
    expect(out[0]).toMatch(/^(30000\/1001|2997\/100)$/)
    expect(Number(out[1])).toBe(75)
    await fs.rm(outputPath, { force: true })
  }, 120_000)

  it("renders a crossfade boundary (D17: the timeline is overlap-compressed)", async () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [
        { id: "A", url: "https://fixtures.test/a.mp4", kind: "video" },
        { id: "B", url: "https://fixtures.test/b.mp4", kind: "video" },
      ],
      segments: [
        { id: "s0", inMs: 0, outMs: 3000, video: "A", audio: "A" },
        { id: "s1", inMs: 0, outMs: 3000, video: "B", audio: "B", transition: { type: "crossfade", durationMs: 1000 } },
      ],
    }
    // 3000 + 3000 − 1000 overlap = 5000 ms.
    const { outputPath, durationMs } = await render({ edl, output: "video", quality: "final", jobId: "t-xfade", checkpoint: false })
    expect(durationMs).toBe(5000)
    const dur = await probeDurationSec(outputPath)
    expect(dur).toBeGreaterThan(4.6)
    expect(dur).toBeLessThan(5.4)
    await fs.rm(outputPath, { force: true })
  }, 120_000)
})
