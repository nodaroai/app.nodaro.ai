/**
 * The thread counts a slice is given reach the REAL ffmpeg (CI runs this on the
 * production-pinned build): it accepts all three options, renders the slice
 * frame-exact, and libx264 encodes with exactly the count it was told. x264
 * records its own decision in the SEI it writes into the stream — the same
 * line that read `threads=67` for a 4K final on a 2-CPU box that shows 48
 * cores.
 *
 * The count is 2, the one a quota of 2 CPUs ships, because x264 never picks it
 * on its own here: its automatic count is 1.5 × the CPUs it may run on, capped
 * at two macroblock rows per thread (7 at 240 lines), so it is 1, 3, 4, 6 or 7.
 * A `-threads` that ffmpeg ignores (after the output path it only warns, and
 * still exits 0) therefore fails this on any box. A 3 would not: on a box
 * that lets ffmpeg run on 2 CPUs, 3 is x264's own choice.
 */
import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Edl } from "@nodaro/shared"
import { runFfmpeg, runFfprobe } from "../ffmpeg-utils.js"
import { buildSliceCommand, sliceArgv } from "../apply-edl.js"
import { ffmpegAvailable, makeSource } from "./apply-edl-e2e-helpers.js"

describe.skipIf(!ffmpegAvailable)("apply-edl slice thread counts on the real ffmpeg", () => {
  it("renders with every count set, and x264 encodes with exactly the one it was told", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "edl-threads-"))
    try {
      const src = join(dir, "a.mp4")
      await makeSource(src, "red", 440, 3)
      const edl = {
        version: 1,
        clock: "master",
        sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }],
        segments: [{ id: "s0", inMs: 500, outMs: 2500, video: "A" }],
      } as unknown as Edl
      const cmd = buildSliceCommand(edl, edl.segments, {
        output: "video", quality: "final", target: { width: 320, height: 240 }, fps: 30, chunkStartSec: 0,
        masterAudioId: undefined, audioPresent: new Map([["A", true]]),
      })
      const graph = join(dir, "graph.txt")
      await fs.writeFile(graph, cmd.filterGraph)
      const out = join(dir, "out.mp4")

      await runFfmpeg(sliceArgv(cmd, new Map([["A", src]]), graph, out, { decode: 2, filter: 2, encode: 2 }), 60_000)

      const sei = (await fs.readFile(out)).toString("latin1").match(/ threads=(\d+) lookahead_threads=/)
      expect(sei?.[1]).toBe("2")
      const packets = await runFfprobe([
        "-v", "error", "-count_packets", "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", out,
      ])
      expect(Number(packets.trim())).toBe(60) // 2 s on the 30 fps grid
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
