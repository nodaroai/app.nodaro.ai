/**
 * A clip with no length in its header is read from its packets by the
 * STREAMED scan (`scanPacketEnds`), never through `runFfprobe`'s 5 MB buffer:
 * a long recording (one csv line a packet — about 70 minutes at 60 fps fills
 * 5 MB) is read to its end, on the charge and at the render's check alike.
 * ffprobe is replaced here by a process that streams a synthetic csv of more
 * than 300,000 packets in chunks that split lines; the real-file version is
 * the media e2e `video-utility-probe-long.e2e.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventEmitter } from "node:events"

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}))
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: h.spawn,
  execFile: h.execFile,
}))

import { probeClipLengthSec } from "../video-utility-probe.js"

const PACKETS = 300_001
const FPS = 60

/** The csv ffprobe writes for `-show_entries packet=pts_time,dts_time,duration_time,flags`: pts, dts, duration, flags. */
function csv(): string {
  const lines: string[] = []
  for (let i = 0; i < PACKETS; i++) {
    const t = (i / FPS).toFixed(6)
    lines.push(`${t},${t},${(1 / FPS).toFixed(6)},${i % 120 === 0 ? "K__" : "___"}`)
  }
  // A packet the demuxer discards (past an edit list): never counted.
  lines.push(`99999.000000,99999.000000,0.016667,__D`)
  return `${lines.join("\n")}\n`
}

/** A child process that streams `text` on stdout in 64 KiB chunks (lines split across chunks), then exits 0. */
function streamingProcess(text: string): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void } {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
  setImmediate(() => {
    for (let at = 0; at < text.length; at += 65_536) proc.stdout.emit("data", Buffer.from(text.slice(at, at + 65_536)))
    proc.emit("close", 0)
  })
  return proc
}

/** The header read: a video stream at index 0 with no length anywhere, the file starting at 1.5 s. */
function headerWithoutLength(startTime = "1.500000") {
  h.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
    cb(null, JSON.stringify({ streams: [{ index: 0, codec_type: "video" }], format: { start_time: startTime } }), "")
    return {}
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("a recording with no length in its header, read from its packets", () => {
  it("the synthetic csv really is past runFfprobe's 5 MB buffer", () => {
    expect(Buffer.byteLength(csv())).toBeGreaterThan(5 * 1024 * 1024)
  })

  it("is streamed to its end: the latest packet's end, less the file's start time, a discarded packet left out", async () => {
    headerWithoutLength()
    const text = csv()
    h.spawn.mockImplementation(() => streamingProcess(text))
    const sec = await probeClipLengthSec("/tmp/long-recording.webm")
    expect(sec).toBeCloseTo(PACKETS / FPS - 1.5, 3)
    // One streamed scan of the stream the header named, with the probe's own protocol whitelist.
    const [cmd, args] = h.spawn.mock.calls[0] as [string, string[]]
    expect(cmd).toBe("ffprobe")
    expect(args).toEqual(expect.arrayContaining(["-protocol_whitelist", "file,http,https,tcp,tls", "-select_streams", "0"]))
  })

  it("a scan that runs out of time is retryable (timedOut), never 'unreadable'", async () => {
    headerWithoutLength()
    h.spawn.mockImplementation(() => {
      const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => setImmediate(() => proc.emit("close", null))) })
      return proc
    })
    const err = await probeClipLengthSec("/tmp/slow.webm", { packetTimeoutMs: 20 }).then(() => undefined, (e: unknown) => e as { timedOut?: boolean })
    expect(err?.timedOut).toBe(true)
  })

  it("a scan the caller stops (its client went away) is marked aborted", async () => {
    headerWithoutLength()
    h.spawn.mockImplementation(() => {
      const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => setImmediate(() => proc.emit("close", null))) })
      return proc
    })
    const stop = new AbortController()
    const pending = probeClipLengthSec("/tmp/slow.webm", { signal: stop.signal }).then(() => undefined, (e: unknown) => e as { aborted?: boolean })
    setTimeout(() => stop.abort(), 10)
    expect((await pending)?.aborted).toBe(true)
  })
})
