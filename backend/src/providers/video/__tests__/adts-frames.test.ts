// @test-reads-none reads only the files it writes to a temp dir
/**
 * The stray bytes after an ADTS file's last frame (decided 2026-11-12): fewer
 * than 10 make ffmpeg's ADTS demuxer stop with an error after every frame has
 * decoded, so a file whose frames run back to back to within them lost
 * nothing. Built from synthetic frames (a 7-byte header naming its length,
 * then zeros), so each shape is exact.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ADTS_DEMUX_TAIL_BYTES, adtsStrayTailBytes } from "../adts-frames.js"

/** One ADTS frame of `bytes` bytes: a header naming that length, then zeros. */
function frame(bytes: number): Buffer {
  const f = Buffer.alloc(bytes)
  f[0] = 0xff
  f[1] = 0xf1
  f[2] = 0x50
  f[3] = 0x80 | ((bytes >> 11) & 0x03)
  f[4] = (bytes >> 3) & 0xff
  f[5] = ((bytes & 0x07) << 5) | 0x1f
  f[6] = 0xfc
  return f
}

/** An ID3v2.4 tag with `body` bytes of zeros. */
function id3(body: number): Buffer {
  const h = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, (body >> 21) & 0x7f, (body >> 14) & 0x7f, (body >> 7) & 0x7f, body & 0x7f])
  return Buffer.concat([h, Buffer.alloc(body)])
}

const frames = (n: number, bytes = 371) => Buffer.concat(Array.from({ length: n }, () => frame(bytes)))

describe("adtsStrayTailBytes", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "adts-frames-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const tail = async (name: string, ...parts: Buffer[]) => {
    const f = join(dir, name)
    await writeFile(f, Buffer.concat(parts))
    return adtsStrayTailBytes(f)
  }

  it("the demuxer's tail error comes from fewer than 10 bytes after the last frame", () => {
    expect(ADTS_DEMUX_TAIL_BYTES).toBe(10)
  })

  it("frames back to back to the end: 0 bytes left", async () => {
    expect(await tail("whole.aac", frames(500))).toBe(0)
  })

  it.each([1, 3, 6, 9])("frames back to back, then %i stray zero bytes: that many left", async (n) => {
    expect(await tail(`stray-${n}.aac`, frames(500), Buffer.alloc(n))).toBe(n)
  })

  it("6 stray 0xFF bytes (too few for a header): 6 left", async () => {
    expect(await tail("stray-ff.aac", frames(500), Buffer.alloc(6, 0xff))).toBe(6)
  })

  it("a cut inside the last frame's header: the bytes of that header left", async () => {
    expect(await tail("cut-header.aac", frames(500), frame(371).subarray(0, 5))).toBe(5)
  })

  it("ID3v2 tags before the first frame and between frames are skipped, like the demuxer", async () => {
    expect(await tail("id3.aac", id3(3000), frames(100), id3(200), frames(100), Buffer.alloc(4))).toBe(4)
  })

  it("leading junk before the first sync word is skipped, like the demuxer", async () => {
    expect(await tail("junk-first.aac", Buffer.alloc(1000, 0x11), frames(100), Buffer.alloc(2))).toBe(2)
  })

  it.each([
    ["10 or more stray bytes (the demuxer skips them as junk: its error came from elsewhere)", [frames(500), Buffer.alloc(10, 0x11)]],
    ["junk between frames", [frames(200), Buffer.alloc(50, 0x11), frames(200), Buffer.alloc(3)]],
    ["a last frame cut off part-way", [frames(500), frame(371).subarray(0, 200)]],
    ["an invalid header (length under 7) with 10 or more bytes after it", [frames(200), frame(371).subarray(0, 3), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.alloc(20)]],
    ["no frame at all", [Buffer.alloc(5000, 0x11)]],
  ])("not a stray tail: %s", async (_label, parts) => {
    expect(await tail(`not-${_label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.aac`, ...(parts as Buffer[]))).toBeUndefined()
  })

  it("reads a large file in chunks (frames across chunk edges)", async () => {
    // 3 MB of frames of an odd length, so headers straddle every 64 KiB edge.
    expect(await tail("large.aac", frames(8_000, 377), Buffer.alloc(7))).toBe(7)
  })
})
