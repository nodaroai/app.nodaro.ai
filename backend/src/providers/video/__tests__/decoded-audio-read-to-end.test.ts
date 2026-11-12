// @test-reads-none reads only the audio files it makes with ffmpeg in a temp dir
/**
 * Read to its end, or refused (decided 2026-11-12), in the order the lane
 * checks: past the cap first, then a decode clearly shorter than the length
 * the file states, then damage the demuxer reports, then the demuxer's "Error
 * during demuxing" — forgiven when nothing was lost. And gaps in the timeline
 * play as silence. Real files through the real ffmpeg; each damaged file is
 * first shown to lose audio (or to log the line), so a build that reads it
 * differently fails here instead of passing for nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodedAudioArgs, isAudioReadStopped, localInputArgs, CALLER_AUDIO_FORMATS, measureDecodedAudio } from "../decoded-audio-length.js"
import { damageCluster, insertWebmDuration, restateFlac, setOpusPreSkip } from "./fixtures/media-edits.js"

const encoders = (() => {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] }).toString()
  } catch {
    return undefined
  }
})()
const hasFfmpeg = encoders !== undefined && encoders.includes("libmp3lame")
const hasOpus = encoders?.includes("libopus") ?? false
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args], { stdio: "ignore" })
const REAL_MEDIA_TIMEOUT_MS = 60_000

/** The lane's decode alone, none of its checks: the seconds it decodes (gaps filled) and what its stderr says. */
async function laneDecode(f: string, capSec = 300): Promise<{ seconds: number; demuxError: boolean; stderr: string }> {
  const pcm = `${f}.lane.pcm`
  const run = spawnSync("ffmpeg", decodedAudioArgs(f, pcm, capSec), { encoding: "utf8" })
  const seconds = (await stat(pcm).catch(() => ({ size: 0 }))).size / 4 / 44_100
  await rm(pcm, { force: true })
  return { seconds, demuxError: /Error during demuxing/.test(run.stderr ?? ""), stderr: run.stderr ?? "" }
}

/** What decodes with no gap filled: the audio the file actually holds. */
async function rawSeconds(f: string): Promise<number> {
  const pcm = `${f}.raw.pcm`
  spawnSync("ffmpeg", ["-nostdin", "-v", "error", ...localInputArgs(CALLER_AUDIO_FORMATS), "-i", f, "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100", "-f", "s16le", "-y", pcm])
  const seconds = (await stat(pcm).catch(() => ({ size: 0 }))).size / 4 / 44_100
  await rm(pcm, { force: true })
  return seconds
}

/** Write `bytes` to `name` in `dir`. */
const put = async (dir: string, name: string, bytes: Buffer) => {
  const f = join(dir, name)
  await writeFile(f, bytes)
  return f
}

describe.skipIf(!hasFfmpeg)("read to its end, or refused (real ffmpeg)", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decoded-audio-read-to-end-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const make = (name: string, ...args: string[]) => {
    const f = join(dir, name)
    ffmpeg(...args, f)
    return f
  }
  /** A file ffmpeg writes live to a pipe, as a recorder streams one: no index, no Duration. */
  const makeLive = (name: string, format: string, ...args: string[]) => {
    const f = join(dir, name)
    const fd = openSync(f, "w")
    try {
      execFileSync("ffmpeg", ["-nostdin", "-v", "error", ...args, "-f", format, "pipe:1"], { stdio: ["ignore", fd, "ignore"] })
    } finally {
      closeSync(fd)
    }
    return f
  }
  /** `src` stream-copied with its timestamps rewritten (`setts`). */
  const retime = (name: string, src: string, ts: string) => make(name, "-i", src, "-c:a", "copy", "-bsf:a", `setts=ts=${ts}`)
  const measured = async (f: string, capSec = 300) => {
    const length = await measureDecodedAudio(f, { capSec })
    return length && !length.overCap ? length.seconds : length?.overCap ? "over" : undefined
  }
  const refused = async (f: string) => isAudioReadStopped(await measureDecodedAudio(f, { capSec: 300 }).catch((e: unknown) => e))

  describe("1. past the cap comes first", () => {
    it("a chained Ogg whose join is just past the cap is over the cap, not stopped part-way", async () => {
      const a = make("cap-a.ogg", "-f", "lavfi", "-i", "sine=f=300:r=44100:d=5.1", "-ac", "2", "-strict", "experimental", "-c:a", "vorbis")
      const b = make("cap-b.ogg", "-f", "lavfi", "-i", "sine=f=300:r=22050:d=2", "-ac", "2", "-strict", "experimental", "-c:a", "vorbis")
      const f = await put(dir, "cap-chain.ogg", Buffer.concat([await readFile(a), await readFile(b)]))
      expect(await laneDecode(f, 5)).toMatchObject({ demuxError: true })
      expect(await measureDecodedAudio(f, { capSec: 5 })).toEqual({ overCap: true })
      // Under a cap past the join, the same file is refused: it stops after its first link.
      expect(await refused(f)).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a file that states more than the cap but decodes less is stopped part-way, not over the cap", async () => {
      const flac = make("over-state.flac", "-f", "lavfi", "-i", "sine=f=300:r=44100:d=8", "-c:a", "flac")
      const f = await put(dir, "states-16.flac", restateFlac(await readFile(flac), 2))
      expect(isAudioReadStopped(await measureDecodedAudio(f, { capSec: 10 }).catch((e: unknown) => e))).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  describe("2. clearly shorter than the length the file states: refused", () => {
    it.each([
      ["a FLAC", "cut.flac", ["-c:a", "flac"], 0.6],
      ["an M4A (index first)", "cut.m4a", ["-c:a", "aac", "-movflags", "+faststart"], 0.6],
      ["an MKA", "cut.mka", ["-c:a", "flac"], 0.6],
      ["a TTA", "cut.tta", ["-c:a", "tta"], 0.6],
      ["a WMA", "cut.wma", ["-c:a", "wmav2"], 0.97],
      ["an AIFF", "cut.aiff", ["-c:a", "pcm_s16be"], 0.97],
    ])("%s cut off part-way (it states 20 s): refused", async (_label, name, codec, keep) => {
      const whole = await readFile(make(`whole-${name}`, "-f", "lavfi", "-i", "sine=f=440:r=44100:d=20", "-ac", "2", ...codec))
      const f = await put(dir, name, whole.subarray(0, Math.floor(whole.length * keep)))
      expect(await rawSeconds(f)).toBeLessThan(19.5)
      expect(await refused(f)).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a lying header can only refuse its own file: a FLAC stating half what it holds is measured on what it decodes (10 s); one stating double is refused", async () => {
      const flac = await readFile(make("lie.flac", "-f", "lavfi", "-i", "sine=f=300:r=44100:d=10", "-c:a", "flac"))
      const half = await put(dir, "lie-half.flac", restateFlac(flac, 0.5))
      expect(await measureDecodedAudio(half, { capSec: 300 })).toEqual({ overCap: false, samples: 441_000, seconds: 10 })
      const double = await put(dir, "lie-double.flac", restateFlac(flac, 2))
      expect(await refused(double)).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  describe("3. damage the demuxer reports: refused, though the jump it leaves would fill", () => {
    /** A 10 s Matroska file in 2 s clusters, its second cluster damaged: that cluster is dropped, with a structure error logged. */
    const damaged = async (name: string, ...args: string[]) => {
      const f = await put(dir, name, damageCluster(await readFile(make(`whole-${name}`, ...args, "-cluster_time_limit", "2000")), 1))
      expect(await rawSeconds(f)).toBeLessThan(9)
      const lane = await laneDecode(f)
      expect(lane.seconds).toBeGreaterThan(9.9) // the gap the lost cluster leaves is filled…
      return f
    }

    it("a 10 s MKA (FLAC) with one damaged cluster", async () => {
      const f = await damaged("cluster.mka", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=10", "-ac", "2", "-c:a", "flac")
      const err = await measureDecodedAudio(f, { capSec: 300 }).catch((e: unknown) => e)
      expect(isAudioReadStopped(err)).toBe(true) // …so the damage line refuses it
      expect(String(err)).toMatch(/reports damage/)
    }, REAL_MEDIA_TIMEOUT_MS)

    it.skipIf(!hasOpus)("a 10 s WebM (Opus) with one damaged cluster", async () => {
      const f = await damaged("cluster.webm", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=10", "-ac", "2", "-c:a", "libopus")
      expect(await refused(f)).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("an Ogg (Vorbis) with a corrupted page: its checksum fails", async () => {
      const ogg = await readFile(make("page.ogg", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=10", "-ac", "2", "-strict", "experimental", "-c:a", "vorbis"))
      const page = ogg.indexOf("OggS", ogg.length >> 1)
      ogg.fill(0x55, page + 40, page + 340)
      const f = await put(dir, "page-damaged.ogg", ogg)
      expect(await rawSeconds(f)).toBeLessThan(9.6)
      expect((await laneDecode(f)).stderr).toMatch(/CRC mismatch!/)
      expect(await refused(f)).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)

    describe("zero padding after the audio is not damage", () => {
      /** A 10 s live FLAC-in-Matroska recording, as a recorder streams one. */
      const live = async (name: string) => readFile(makeLive(name, "matroska", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=10", "-c:a", "flac"))

      it.each([4096, 512])("a live recording recovered with %i zero bytes after its last cluster: every sample decoded, accepted", async (zeros) => {
        const f = await put(dir, `live+zeros${zeros}.mka`, Buffer.concat([await live(`live-z${zeros}.mka`), Buffer.alloc(zeros)]))
        // The demuxer reports the padding as an invalid element — after all the audio has decoded.
        expect((await laneDecode(f)).stderr).toMatch(/invalid as first byte of an EBML number/)
        expect(await measureDecodedAudio(f, { capSec: 300 })).toEqual({ overCap: false, samples: 441_000, seconds: 10 })
      }, REAL_MEDIA_TIMEOUT_MS)

      it.each([
        ["zero bytes", 0x00],
        ["non-zero junk", 0x55],
      ])("a damaged cluster followed by %s is still refused", async (_label, fill) => {
        const whole = await readFile(make(`dz-${fill}.mka`, "-f", "lavfi", "-i", "sine=f=440:r=44100:d=10", "-ac", "2", "-c:a", "flac", "-cluster_time_limit", "2000"))
        const f = await put(dir, `damaged+${fill}.mka`, Buffer.concat([damageCluster(whole, 1), Buffer.alloc(4096, fill)]))
        expect(await rawSeconds(f)).toBeLessThan(9)
        expect(await refused(f)).toBe(true)
      }, REAL_MEDIA_TIMEOUT_MS)
    })
  })

  describe("4. the demuxer's error is forgiven only when nothing was lost", () => {
    const adts = async (name: string) => readFile(make(name, "-f", "lavfi", "-i", "sine=f=440:r=44100:d=10", "-ac", "2", "-c:a", "aac", "-f", "adts"))

    it.each([
      ["3 stray zero bytes after its last frame", (a: Buffer) => Buffer.concat([a, Buffer.alloc(3)])],
      ["6 stray 0xFF bytes after its last frame", (a: Buffer) => Buffer.concat([a, Buffer.alloc(6, 0xff)])],
      ["a cut inside its last frame's header", (a: Buffer) => a.subarray(0, a.lastIndexOf(Buffer.from([0xff, 0xf1])) + 4)],
    ])("an ADTS AAC with %s: the line is logged, every frame decoded, accepted", async (label, shape) => {
      const f = await put(dir, `adts-${label.length}.aac`, shape(await adts(`adts-src-${label.length}.aac`)))
      expect((await laneDecode(f)).demuxError).toBe(true)
      expect(await measured(f)).toBeGreaterThan(9.9)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a complete WavPack with an ID3v1 tag after its audio: the line is logged, it decoded the 10 s it states, accepted", async () => {
      const wv = await readFile(make("tag.wv", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=10", "-ac", "2", "-c:a", "wavpack"))
      const id3v1 = Buffer.alloc(128)
      id3v1.write("TAG", 0, "latin1")
      const f = await put(dir, "tagged.wv", Buffer.concat([wv, id3v1]))
      expect((await laneDecode(f)).demuxError).toBe(true)
      expect(await measureDecodedAudio(f, { capSec: 300 })).toEqual({ overCap: false, samples: 441_000, seconds: 10 })
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  describe("gaps in the timeline play as silence", () => {
    let src = ""
    beforeAll(() => {
      src = make("gap-src.mka", "-f", "lavfi", "-i", "sine=f=220:r=48000:d=20", "-c:a", "flac")
    })

    it("a 2 s jump at 5 s: measured 22 s, silence included — and the 22 s the file states no longer refuse it", async () => {
      const f = retime("gap2.mka", src, "if(gt(PTS*TB\\,5)\\,PTS+2/TB\\,PTS)")
      expect(await rawSeconds(f)).toBeCloseTo(20, 1)
      expect(await measured(f)).toBeCloseTo(22, 1)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a 0.3 s gap every 2 s (2.7 s in all): measured 22.7 s", async () => {
      const f = retime("gaps03.mka", src, "PTS+floor(PTS*TB/2)*0.3/TB")
      expect(await measured(f)).toBeCloseTo(22.7, 1)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a 40 ms gap every second (0.76 s in all): small gaps add up and are filled — within 0.1 s of the 20.76 s it states", async () => {
      const f = retime("gaps40ms.mka", src, "PTS+floor(PTS*TB)*0.04/TB")
      const seconds = await measured(f)
      expect(seconds).toBeGreaterThan(20.66)
      expect(seconds).toBeLessThanOrEqual(20.77)
    }, REAL_MEDIA_TIMEOUT_MS)

    it.each([
      ["a step back of 1 s at 5 s (an overlap)", "back1.mka", "if(gt(PTS*TB\\,5)\\,PTS-1/TB\\,PTS)"],
      ["a restart at 0 after 10 s", "reset.mka", "if(gt(PTS*TB\\,10)\\,PTS-10/TB\\,PTS)"],
    ])("%s drops nothing: exactly the samples the file holds", async (_label, name, ts) => {
      const f = retime(name, src, ts)
      const raw = await rawSeconds(f)
      expect(raw).toBeCloseTo(20, 1)
      expect(await measured(f)).toBeCloseTo(raw, 6)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a 3-hour jump in a Matroska file fills to past the cap: over the cap", async () => {
      const f = retime("huge.mka", src, "if(gt(PTS*TB\\,5)\\,PTS+3*3600/TB\\,PTS)")
      expect(await measureDecodedAudio(f, { capSec: 300 })).toEqual({ overCap: true })
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  /** Honest shapes the checks must not refuse. Each: name, how to make it, the seconds it plays. */
  const honest: Array<[string, string, string[], number]> = [
    ["an MKA whose audio starts 1 s in", "offset.mka", ["-itsoffset", "1", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=8", "-c:a", "flac"], 8],
    ["an MP4 whose audio starts 1 s into its video (an edit list)", "edit.mp4", ["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=10", "-itsoffset", "1", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=8", "-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-c:a", "aac"], 8],
    ["an MKV whose audio starts 6 s after its video (past ffprobe's analysis)", "late6.mkv", ["-f", "lavfi", "-i", "testsrc=s=160x120:r=10:d=20", "-itsoffset", "6", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=10", "-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-c:a", "flac"], 10],
    ["an MKV whose video runs longer than its audio", "long-video.mkv", ["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=10", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=6", "-c:v", "mpeg4", "-c:a", "flac"], 6],
    ["an MP4 whose video runs longer than its audio", "long-video.mp4", ["-f", "lavfi", "-i", "testsrc=s=160x120:r=25:d=10", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=6", "-c:v", "mpeg4", "-c:a", "aac"], 6],
    ["a WMV whose audio is shorter than its video", "short-audio.wmv", ["-f", "lavfi", "-i", "testsrc=s=160x120:r=10:d=20", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=12", "-c:v", "wmv2", "-c:a", "wmav2"], 12],
    ["a WMV whose audio starts 3 s after its video", "late-audio.wmv", ["-f", "lavfi", "-i", "testsrc=s=160x120:r=10:d=20", "-itsoffset", "3", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=15", "-map", "0:v", "-map", "1:a", "-c:v", "wmv2", "-c:a", "wmav2"], 15],
    ["an M4A whose first audio track is the shorter", "two.m4a", ["-f", "lavfi", "-i", "sine=f=300:r=48000:d=6", "-f", "lavfi", "-i", "sine=f=500:r=48000:d=10", "-map", "0", "-map", "1", "-c:a", "aac"], 6],
    ["an MKA whose first audio track is the shorter", "two.mka", ["-f", "lavfi", "-i", "sine=f=300:r=48000:d=6", "-f", "lavfi", "-i", "sine=f=500:r=48000:d=10", "-map", "0", "-map", "1", "-c:a", "flac"], 6],
    ["a WMA", "a.wma", ["-f", "lavfi", "-i", "sine=f=300:r=44100:d=10", "-c:a", "wmav2"], 10],
  ]
  it.each(honest)("%s is measured, not refused", async (_label, name, args, seconds) => {
    expect(await measured(make(name, ...args))).toBeCloseTo(seconds, 0)
  }, REAL_MEDIA_TIMEOUT_MS)

  it("a FLAC that states no sample count is measured on what it decodes", async () => {
    const f = await put(dir, "no-count.flac", restateFlac(await readFile(make("count.flac", "-f", "lavfi", "-i", "sine=f=300:r=44100:d=10", "-c:a", "flac")), 0))
    expect(await measureDecodedAudio(f, { capSec: 300 })).toEqual({ overCap: false, samples: 441_000, seconds: 10 })
  }, REAL_MEDIA_TIMEOUT_MS)

  it("a live Matroska recording whose app patched in a Duration longer than its audio is measured on its audio", async () => {
    const live = makeLive("live.mka", "matroska", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=10", "-c:a", "flac")
    const f = await put(dir, "patched.mka", insertWebmDuration(await readFile(live), 12_000))
    expect(await measured(f)).toBeCloseTo(10, 1)
  }, REAL_MEDIA_TIMEOUT_MS)

  describe.skipIf(!hasOpus)("Ogg Opus", () => {
    let base = ""
    beforeAll(() => {
      base = make("base.ogg", "-f", "lavfi", "-i", "sine=f=220:r=48000:d=30", "-c:a", "libopus")
    })

    it("a capture that began 5 s into its stream (its first granule is not 0) is measured", async () => {
      expect(await measured(make("copyts.ogg", "-copyts", "-ss", "5", "-i", base, "-c", "copy"))).toBeCloseTo(25, 1)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a pre-skip of 1 s (RFC 7845 allows it) is measured on what it plays", async () => {
      const f = await put(dir, "preskip.ogg", setOpusPreSkip(await readFile(base), 48_000))
      expect(await measured(f)).toBeCloseTo(29, 1)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a live WebM recording whose app patched in a Duration longer than its audio is measured on its audio", async () => {
      const live = makeLive("live.webm", "webm", "-f", "lavfi", "-i", "sine=f=220:r=48000:d=20", "-c:a", "libopus")
      const f = await put(dir, "patched.webm", insertWebmDuration(await readFile(live), 21_000))
      expect(await measured(f)).toBeCloseTo(20, 1)
    }, REAL_MEDIA_TIMEOUT_MS)
  })
})
