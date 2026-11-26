import { describe, it, expect } from "vitest"
import {
  FFMPEG_DIAGNOSTIC_LINE_CHARS,
  FFMPEG_DIAGNOSTIC_MAX_LINES,
  FFMPEG_FAILURE_DETAIL_MAX_CHARS,
  FfmpegDiagnostics,
  describeFfmpegExit,
  ffmpegDiagnosticLines,
  ffmpegFailureDetail,
  ffmpegFailureLogOf,
  withPathBasenames,
  withoutFilterText,
} from "../ffmpeg-failure-detail.js"
import { providerDetailOf } from "../../../lib/provider-error-detail.js"

/** The generic ending every encoder-open / first-frame failure prints. */
const GENERIC_TAIL = [
  "[vost#0:0/libx264 @ 0x5598a1c2e480] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.",
  "[vf#0:0 @ 0x5598a1c2e000] Error sending frames to consumers: Invalid argument",
  "[vost#0:0/libx264 @ 0x5598a1c2e480] Terminating thread with return code -22 (Invalid argument)",
  "[out#0/mp4 @ 0x5598a1c0b9c0] Nothing was written into output file, because at least one of its streams received no packets.",
  "frame=    0 fps=0.0 q=0.0 Lsize=       0KiB time=N/A bitrate=N/A speed=N/A elapsed=0:00:00.40",
  "Conversion failed!",
]

const BANNER = [
  "ffmpeg version n8.1.2 Copyright (c) 2000-2026 the FFmpeg developers",
  "  built with gcc 15.2.0",
  `  configuration: --enable-gpl --disable-debug --enable-libx264 ${"--enable-error-resilience ".repeat(20)}`,
  "  libavcodec     62. 11.100 / 62. 11.100",
]

describe("ffmpegDiagnosticLines", () => {
  it("keeps the earlier line that names the cause when the tail is the generic -22 ending", () => {
    const stderr = [
      ...BANNER,
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/work/in.mp4':",
      ...Array.from({ length: 40 }, (_, i) => `  Stream #0:${i}: metadata ${"x".repeat(40)}`),
      "[libx264 @ 0x5598a1c2e480] malloc of size 1638400 failed",
      ...GENERIC_TAIL,
    ].join("\n")

    // (That the message's own tail drops it is `ffmpeg-utils.test.ts`'s.)
    const lines = ffmpegDiagnosticLines(stderr)
    expect(lines[0]).toBe("[libx264 @ 0x5598a1c2e480] malloc of size 1638400 failed")
    expect(lines).toContain("Conversion failed!")
    // The banner's configure flags are not errors.
    expect(lines.some((l) => l.includes("configuration:"))).toBe(false)
  })

  it("stays bounded over 50k progress lines written with carriage returns", () => {
    const progress = Array.from({ length: 50_000 }, (_, i) => `frame=${i} fps=30 q=28.0 size=${i}KiB time=00:00:${i % 60} bitrate=1000kbits/s speed=1x`).join("\r")
    const errors = Array.from({ length: 40 }, (_, i) => `[h264 @ 0x55${i.toString(16)}] error while decoding MB ${i} 12, bytestream -${i}`)
    const stderr = `${progress}\r${errors.join("\n")}\n${GENERIC_TAIL.join("\n")}`

    const lines = ffmpegDiagnosticLines(stderr)
    expect(lines.length).toBeLessThanOrEqual(FFMPEG_DIAGNOSTIC_MAX_LINES)
    expect(lines.every((l) => l.length <= FFMPEG_DIAGNOSTIC_LINE_CHARS + 1)).toBe(true)
    expect(lines.some((l) => l.startsWith("frame="))).toBe(false)
    expect(lines[0]).toContain("error while decoding MB 0")
  })

  it("keeps the cause line in the stored column when 20 decoder warnings with other numbers come before it", () => {
    const stderr = [
      ...Array.from({ length: 20 }, (_, i) => `[h264 @ 0x55${i}] error while decoding MB ${i} ${i * 3}, bytestream -${i + 7}`),
      "[libx264 @ 0x1] malloc of size 1638400 failed",
      ...GENERIC_TAIL,
    ].join("\n")
    const err = Object.assign(new Error("ffmpeg failed: …"), {
      internalDetails: ffmpegFailureDetail({ exit: { code: 234 }, diagnostics: ffmpegDiagnosticLines(stderr), tail: GENERIC_TAIL.slice(-3).join("\n") }),
    })
    expect(providerDetailOf(err)).toContain("malloc of size 1638400 failed")
  })

  it("collapses the same line from another instance of a component", () => {
    const stderr = [
      "[aac @ 0x1111] Too large remapped id",
      "[aac @ 0x2222] Too large remapped id",
      "[libx264 @ 0x3333] height not divisible by 2 (1080x1081)",
    ].join("\n")
    expect(ffmpegDiagnosticLines(stderr)).toEqual([
      "[aac @ 0x1111] Too large remapped id",
      "[libx264 @ 0x3333] height not divisible by 2 (1080x1081)",
    ])
  })

  it("keeps a line at ffmpeg's error level whatever its words", () => {
    expect(ffmpegDiagnosticLines("[enc:libx264 @ 0x1] [fatal] x\nnothing here\n")).toEqual(["[enc:libx264 @ 0x1] [fatal] x"])
  })

  it("collects the same lines when stderr arrives in chunks split mid-line", () => {
    const stderr = `ok line\n[libx264 @ 0x1] malloc of size 9 failed\n${GENERIC_TAIL.join("\n")}`
    const d = new FfmpegDiagnostics()
    for (let i = 0; i < stderr.length; i += 7) d.push(stderr.slice(i, i + 7))
    expect(d.lines()).toEqual(ffmpegDiagnosticLines(stderr))
  })
})

describe("describeFfmpegExit", () => {
  it("names a signal this process did not send (an out-of-memory kill), apart from an ffmpeg error exit", () => {
    expect(describeFfmpegExit({ code: null, signal: "SIGKILL", signalledByUs: false })).toBe(
      "ended by SIGKILL, not sent by this process (the out-of-memory killer or an operator)",
    )
    expect(describeFfmpegExit({ signal: "SIGSEGV", signalledByUs: false })).not.toContain("out-of-memory")
    expect(describeFfmpegExit({ code: 234 })).toBe("exit code 234")
  })

  it("names this process's own stop and why", () => {
    expect(describeFfmpegExit({ code: 255, signal: null, signalledByUs: true, stoppedBecause: "its time limit" })).toBe(
      "stopped by this process (its time limit), exit code 255",
    )
    expect(describeFfmpegExit({ signal: "SIGTERM", signalledByUs: true, stoppedBecause: "its time limit" })).toBe(
      "ended by SIGTERM, sent by this process (its time limit)",
    )
    expect(describeFfmpegExit({ processError: "ENOENT" })).toBe("process error ENOENT")
  })
})

describe("ffmpegFailureDetail", () => {
  it("puts how it ended and the cause first, then the tail without repeating lines", () => {
    const detail = ffmpegFailureDetail({
      exit: { code: 234 },
      diagnostics: ["[libx264 @ 0x1] malloc of size 9 failed", "Conversion failed!"],
      tail: "Nothing was written into output file\nConversion failed!",
    })
    expect(detail).toBe(
      "ffmpeg exit code 234 | errors: [libx264 @ 0x1] malloc of size 9 failed | Conversion failed! | tail: Nothing was written into output file",
    )
  })

  it("redacts links and secrets like every error_detail", () => {
    const detail = ffmpegFailureDetail({
      exit: { code: 1 },
      diagnostics: [
        "[https @ 0x1] HTTP error 403 Forbidden",
        "Error opening input file https://bucket.example.com/private/clip.mp4?X-Amz-Signature=abc123&token=s3cr3t.",
        "Authorization: Bearer eyJhbGciOi.secret",
        "[tcp @ 0x2] Failed to resolve hostname media.example?sig=deadbeef",
      ],
      tail: "",
    })
    expect(detail).toContain("bucket.example.com/…")
    expect(detail).not.toContain("private/clip.mp4")
    expect(detail).not.toContain("abc123")
    expect(detail).not.toContain("s3cr3t")
    expect(detail).not.toContain("eyJhbGciOi")
    expect(detail).not.toContain("deadbeef")
  })

  it("is capped", () => {
    const detail = ffmpegFailureDetail({
      exit: { code: 1 },
      diagnostics: Array.from({ length: 15 }, (_, i) => `error ${i} ${"y".repeat(299)}`),
      tail: "z".repeat(5000),
    })
    expect(detail.length).toBeLessThanOrEqual(FFMPEG_FAILURE_DETAIL_MAX_CHARS)
  })

  it("reaches error_detail through providerDetailOf with the cause inside the column's first 500 characters", () => {
    const stderr = [...BANNER, "[libx264 @ 0x1] malloc of size 1638400 failed", ...GENERIC_TAIL].join("\n")
    const tail = GENERIC_TAIL.slice(-4).join("\n")
    const err = Object.assign(new Error("ffmpeg failed: …"), {
      internalDetails: ffmpegFailureDetail({ exit: { code: 234 }, diagnostics: ffmpegDiagnosticLines(stderr), tail }),
    })
    const stored = providerDetailOf(err)!
    expect(stored.length).toBeLessThanOrEqual(500)
    expect(stored).toMatch(/^ffmpeg exit code 234 \| errors: \[libx264 @ 0x1\] malloc of size 1638400 failed/)
  })
})

describe("what the owner-readable form leaves out", () => {
  it("drops filter-graph argument text: a quoted graph, and a text option's words", () => {
    expect(withoutFilterText("[Parsed_drawtext_0 @ 0x1] Error initializing filter 'drawtext' with args 'text=Hello there:fontsize=48'"))
      .toBe("[Parsed_drawtext_0 @ 0x1] Error initializing filter '<filter graph>' with args '<filter graph>'")
    expect(withoutFilterText("[AVFilterGraph @ 0x2] Error parsing filterchain \"[0:v]drawtext=text=my prompt words[v]\""))
      .toBe("[AVFilterGraph @ 0x2] Error parsing filterchain \"<filter graph>\"")
    expect(withoutFilterText("Unable to parse option value text=a caption with spaces:x=10")).toBe("Unable to parse option value text=<text>:x=10")
    // A line about no filter keeps its quotes (an input name, a codec).
    expect(withoutFilterText("Error opening input file 'in.mp4'.")).toBe("Error opening input file 'in.mp4'.")
  })

  it("omits echoed graph arguments containing nested quotes or free text", () => {
    for (const line of [
      "Error parsing filterchain 'drawtext=text='sample caption''",
      "Error parsing a filter description around: sample caption",
    ]) {
      expect(withoutFilterText(line)).not.toContain("sample caption")
    }
  })

  it("drops the continuation of a quoted multiline filter argument, even after an oversized line", () => {
    for (const padding of ["", "x".repeat(24_000)]) {
      const diagnostics = new FfmpegDiagnostics()
      diagnostics.push("Error parsing filterchain 'drawtext=text=")
      diagnostics.push(padding + "\n")
      diagnostics.push("private caption on another line'\n[decoder] invalid frame\n")
      for (const detail of Object.values(diagnostics.fields({ code: 1 }))) {
        expect(detail).not.toContain("private caption")
        expect(detail).toContain("invalid frame")
      }
    }
  })

  it("discards an oversized line through its delimiter when it arrives in fragments", () => {
    const diagnostics = new FfmpegDiagnostics()
    diagnostics.push("Error parsing filterchain '")
    diagnostics.push("x".repeat(24_000))
    diagnostics.push("error detached caption'\n[decoder] invalid frame\n")
    for (const detail of Object.values(diagnostics.fields({ code: 1 }))) {
      expect(detail).not.toMatch(/detached caption|filterchain/)
      expect(detail).toContain("invalid frame")
    }
  })

  it("keeps only a local path's basename", () => {
    expect(withPathBasenames("Error opening input file '/tmp/nodaro-abc/in.mp4'. and /var/data/x/out.mov: No such file"))
      .toBe("Error opening input file '…/in.mp4'. and …/out.mov: No such file")
    expect(withPathBasenames("Error opening file '/tmp/work area/team name/file.mp4'")).toBe("Error opening file '…/file.mp4'")
    expect(withPathBasenames("Error opening file /tmp/work area/team name/file.mp4")).toBe("Error opening file …/file.mp4")
    // A link already cut to its host, and a ratio, are left alone.
    expect(withPathBasenames("cdn.example.com/… 1920/1080")).toBe("cdn.example.com/… 1920/1080")
  })

  it("the stored form cuts paths and filter text; the log form keeps paths only", () => {
    const input = {
      exit: { code: 1 },
      diagnostics: ["[in#0 @ 0x1] Error opening input: No such file or directory /tmp/nodaro-abc/in.mp4", "[Parsed_subtitles_0 @ 0x2] Unable to open subtitles=/tmp/nodaro-abc/captions.ass"],
      tail: "",
    }
    const stored = ffmpegFailureDetail(input)
    const log = ffmpegFailureDetail({ ...input, keepPaths: true })
    expect(stored).toContain("…/in.mp4")
    expect(stored).not.toContain("/tmp/nodaro-abc")
    expect(log).toContain("/tmp/nodaro-abc/in.mp4")
    expect(stored).toContain("subtitles=<text>")
    expect(log).toContain("subtitles=<text>")
  })

  it("finds the log form on the cause chain", () => {
    const inner = Object.assign(new Error("ffmpeg failed: x"), { ffmpegFailureLog: "ffmpeg exit code 1" })
    expect(ffmpegFailureLogOf(new Error("wrapped", { cause: inner }))).toBe("ffmpeg exit code 1")
    expect(ffmpegFailureLogOf(new Error("plain"))).toBeUndefined()
  })
})
