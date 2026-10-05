// Every ffmpeg the backend runs is told the box's CPU budget as its thread
// counts — not only Apply EDL's slices (decided 2026-10-05). The counts are
// placed into an argv a caller already built, so the placement has to read
// that argv the way ffmpeg's own command-line splitter does: a `-threads`
// before each `-i` binds that input's decoders, one before each output path
// binds that output's encoders, and the filter counts are global. These pin
// that reading, and that a box with no quota (no counts) runs the argv
// exactly as given.
import { describe, it, expect } from "vitest"
import { withFfmpegThreads, type FfmpegThreads } from "../ffmpeg-threads.js"

const TWO: FfmpegThreads = { decode: 2, filter: 2, encode: 2 }
/** Distinct counts, so a test can tell which slot a count landed in. */
const D3F4E5: FfmpegThreads = { decode: 3, filter: 4, encode: 5 }
const GLOBALS = (f: number) => ["-filter_complex_threads", String(f), "-filter_threads", String(f)]

describe("withFfmpegThreads — no counts: the argv exactly as given", () => {
  it("returns an equal copy, never the caller's array", () => {
    const args = ["-y", "-i", "in.mp4", "-c:v", "libx264", "out.mp4"]
    const out = withFfmpegThreads(args, undefined)
    expect(out).toEqual(args)
    expect(out).not.toBe(args)
  })
})

describe("withFfmpegThreads — where each count goes", () => {
  it("filter counts first (global), decode before each -i, encode before the output path", () => {
    expect(withFfmpegThreads(["-y", "-i", "a.mp4", "-c:v", "libx264", "-crf", "18", "out.mp4"], D3F4E5)).toEqual([
      ...GLOBALS(4), "-y", "-threads", "3", "-i", "a.mp4", "-c:v", "libx264", "-crf", "18", "-threads", "5", "out.mp4",
    ])
  })

  it("every input gets its own decode count, lavfi and concat inputs included", () => {
    const args = [
      "-y", "-f", "concat", "-safe", "0", "-i", "list.txt",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-filter_complex", "[0:v]scale=320:240[v]", "-map", "[v]", "-map", "1:a", "-shortest", "out.mp4",
    ]
    expect(withFfmpegThreads(args, TWO)).toEqual([
      ...GLOBALS(2), "-y", "-f", "concat", "-safe", "0", "-threads", "2", "-i", "list.txt",
      "-f", "lavfi", "-threads", "2", "-i", "anullsrc=r=48000:cl=stereo",
      "-filter_complex", "[0:v]scale=320:240[v]", "-map", "[v]", "-map", "1:a", "-shortest", "-threads", "2", "out.mp4",
    ])
  })

  it("every output gets its own encode count — valueless options between outputs are not mistaken for paths", () => {
    const args = [
      "-i", "in.mp4",
      "-map", "0:a", "-c:a", "pcm_s16le", "a.wav",
      "-an", "-c:v", "libx264", "-shortest", "v.mp4",
      "-f", "null", "-",
    ]
    expect(withFfmpegThreads(args, D3F4E5)).toEqual([
      ...GLOBALS(4), "-threads", "3", "-i", "in.mp4",
      "-map", "0:a", "-c:a", "pcm_s16le", "-threads", "5", "a.wav",
      "-an", "-c:v", "libx264", "-shortest", "-threads", "5", "v.mp4",
      "-f", "null", "-threads", "5", "-",
    ])
  })

  it("an option's value is never an output, even when it starts with a dash", () => {
    // -sseof -1, -itsoffset -0.5, -map -0:s: AVOption-style values ffmpeg consumes whole.
    const args = ["-y", "-sseof", "-1", "-itsoffset", "-0.5", "-i", "in.mp4", "-map", "0", "-map", "-0:s", "-update", "1", "f.png"]
    expect(withFfmpegThreads(args, TWO)).toEqual([
      ...GLOBALS(2), "-y", "-sseof", "-1", "-itsoffset", "-0.5", "-threads", "2", "-i", "in.mp4",
      "-map", "0", "-map", "-0:s", "-update", "1", "-threads", "2", "f.png",
    ])
  })

  it("reads stream specifiers, the -/ file prefix and -no<bool> the way ffmpeg does", () => {
    const args = [
      "-hide_banner", "-nostats", "-noautorotate", "-i", "in.mov",
      "-/filter_complex", "graph.txt", "-c:v:0", "libx264", "-frames:v", "1", "-copyts", "out.mp4",
    ]
    expect(withFfmpegThreads(args, TWO)).toEqual([
      ...GLOBALS(2), "-hide_banner", "-nostats", "-noautorotate", "-threads", "2", "-i", "in.mov",
      "-/filter_complex", "graph.txt", "-c:v:0", "libx264", "-frames:v", "1", "-copyts", "-threads", "2", "out.mp4",
    ])
  })

  it("the progress runner's prefix (-progress pipe:1 -nostats) is read as options, not an output", () => {
    const args = ["-progress", "pipe:1", "-nostats", "-y", "-loop", "1", "-i", "still.png", "-t", "3", "out.mp4"]
    expect(withFfmpegThreads(args, TWO)).toEqual([
      ...GLOBALS(2), "-progress", "pipe:1", "-nostats", "-y", "-loop", "1", "-threads", "2", "-i", "still.png",
      "-t", "3", "-threads", "2", "out.mp4",
    ])
  })

  it("a PCM pipe to stdout is an output like any other", () => {
    const args = ["-hide_banner", "-nostats", "-v", "error", "-i", "a.m4a", "-vn", "-ac", "1", "-f", "f32le", "pipe:1"]
    expect(withFfmpegThreads(args, TWO)).toEqual([
      ...GLOBALS(2), "-hide_banner", "-nostats", "-v", "error", "-threads", "2", "-i", "a.m4a",
      "-vn", "-ac", "1", "-f", "f32le", "-threads", "2", "pipe:1",
    ])
  })
})

describe("withFfmpegThreads — argv it leaves exactly as given", () => {
  const untouched = (args: string[]) => expect(withFfmpegThreads(args, TWO)).toEqual(args)

  it("an argv that already sets a thread count: the caller decided (Apply EDL's sliceArgv)", () => {
    untouched(["-y", "-filter_complex_threads", "2", "-threads", "2", "-i", "a.mp4", "-threads", "2", "out.mp4"])
    untouched(["-i", "a.mp4", "-c:v", "libx264", "-threads:v", "1", "out.mp4"])
    untouched(["-filter_threads", "1", "-i", "a.mp4", "-vf", "scale=2:2", "out.mp4"])
  })

  it("an informational run that exits (-version keys render caches; its output must not change)", () => {
    untouched(["-version"])
    untouched(["-hide_banner", "-h", "encoder=libx264"])
  })

  it("no output path at all", () => {
    untouched(["-i", "a.mp4"])
    untouched([])
  })

  it("an argv it cannot read for certain: a value that looks like an option, or a dangling option", () => {
    // An option this table does not know as valueless would swallow the next
    // option as its value — then nothing is placed rather than misplaced.
    untouched(["-some_new_flag", "-i", "a.mp4", "out.mp4"])
    untouched(["-i", "a.mp4", "-c:v"])
    untouched(["-i", "a.mp4", "--", "out.mp4"])
  })
})
