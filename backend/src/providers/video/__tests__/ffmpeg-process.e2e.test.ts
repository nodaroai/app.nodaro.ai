/**
 * The counts the launcher places reach the REAL ffmpeg (CI runs this on the
 * production-pinned build) in every output of a hand-built argv: a command
 * with an audio output between two video outputs, valueless options
 * (`-an`, `-shortest`) among them, renders, and libx264 encodes BOTH videos
 * with exactly the count it was told. x264 records its decision in the SEI it
 * writes into the stream.
 *
 * The count is 2 because x264 never picks it on its own here (1.5 × the CPUs
 * it may run on, capped at two macroblock rows per thread — see
 * `ffmpeg-threads.e2e.test.ts`), so a `-threads` ffmpeg ignored — one placed
 * after an output path only warns, and still exits 0 — fails this on any box.
 */
import { describe, it, expect, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ffmpegAvailable } from "./apply-edl-e2e-helpers.js"

vi.mock("../ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-threads.js")>()),
  ffmpegThreads: () => ({ decode: 2, filter: 2, encode: 2 }),
}))

import { runFfmpeg } from "../ffmpeg-utils.js"

const x264Threads = async (path: string) =>
  (await fs.readFile(path)).toString("latin1").match(/ threads=(\d+) lookahead_threads=/)?.[1]

describe.skipIf(!ffmpegAvailable)("the ffmpeg launcher's thread counts on the real ffmpeg", () => {
  it("every output of a multi-output argv is encoded with exactly the count it was told", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "ffmpeg-launch-threads-"))
    try {
      const src = join(dir, "src.mp4")
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", "testsrc=d=2:s=320x240:r=30", "-f", "lavfi", "-i", "sine=d=2",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", src,
      ], 60_000)
      const big = join(dir, "big.mp4")
      const wav = join(dir, "a.wav")
      const small = join(dir, "small.mp4")

      await runFfmpeg([
        "-y", "-i", src,
        "-map", "0:v", "-an", "-c:v", "libx264", "-preset", "veryfast", big,
        "-map", "0:a", "-c:a", "pcm_s16le", wav,
        "-map", "0:v", "-vf", "scale=160:120", "-c:v", "libx264", "-shortest", small,
      ], 60_000)

      expect(await x264Threads(src)).toBe("2")
      expect(await x264Threads(big)).toBe("2")
      expect(await x264Threads(small)).toBe("2")
      expect((await fs.stat(wav)).size).toBeGreaterThan(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
