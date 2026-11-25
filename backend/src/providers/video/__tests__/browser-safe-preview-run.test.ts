// @test-reads-none runs only the stand-in ffmpeg scripts and clips it writes to a temp folder
/**
 * The preview encode as it RUNS (decided 2026-11-22):
 *  - the job's cancel stops an encode already running, which then rejects
 *    with the cancel (never read as a failed encode);
 *  - a child the kernel killed (out of memory: SIGKILL from outside, `killed`
 *    false, no exit code) and a log that outgrew its capture buffer are the
 *    box's failures, never the encode's: no job completes on its original
 *    for them.
 * A stand-in `ffmpeg` on PATH plays each failure; the cancel runs real ffmpeg
 * (skipped without it).
 */
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { runFfmpeg } from "../ffmpeg-utils.js"
import { encodeBrowserSafePreview } from "../browser-safe-preview.js"
import { isPreviewEncodeFailure } from "../../../lib/video-result-store.js"
import { JobCancelledError } from "../../../lib/job-cancellation.js"

const realPath = process.env.PATH ?? ""
let dir = ""
beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "preview-run-"))
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  process.env.PATH = realPath
})

/** Put a stand-in `ffmpeg` running `body` first on PATH. */
async function standIn(name: string, body: string): Promise<void> {
  const bin = join(dir, name)
  await fs.mkdir(bin, { recursive: true })
  await fs.writeFile(join(bin, "ffmpeg"), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  process.env.PATH = `${bin}:${realPath}`
}

async function failureOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run
  } catch (err) {
    return err
  }
  throw new Error("expected the launch to fail")
}

describe("the box's failures are not the encode's", () => {
  it("a child killed from outside (the out-of-memory killer's SIGKILL)", async () => {
    await standIn("oom", "kill -9 $$")
    const err = await failureOf(runFfmpeg(["-i", "x", "y.mp4"], 10_000))
    expect(err).toMatchObject({ killed: false, signalledFromOutside: true })
    expect(isPreviewEncodeFailure(err)).toBe(false)
  })

  it("a log that outgrew its capture buffer", async () => {
    await standIn("chatty", "head -c 12000000 /dev/zero | tr '\\0' 'x' >&2; exit 1")
    const err = await failureOf(runFfmpeg(["-i", "x", "y.mp4"], 30_000))
    expect(err).toMatchObject({ truncated: true })
    expect(isPreviewEncodeFailure(err)).toBe(false)
  })

  it("an ordinary non-zero exit is still the encode's own failure", async () => {
    await standIn("exit1", "exit 1")
    const err = await failureOf(runFfmpeg(["-i", "x", "y.mp4"], 10_000))
    expect(err).toMatchObject({ killed: false })
    expect(isPreviewEncodeFailure(err)).toBe(true)
  })
})

const ffmpegAvailable = (() => {
  try {
    return /\slibx264\s/.test(execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
  } catch {
    return false
  }
})()

describe.skipIf(!ffmpegAvailable)("the job's cancel", () => {
  it("stops an encode already running, which rejects with the cancel", async () => {
    const src = join(dir, "long.mkv")
    // Long enough that the encode is still running when the cancel lands.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=40", "-c:v", "ffv1", src], 120_000)
    const controller = new AbortController()
    const cancel = new JobCancelledError("11111111-2222-4333-8444-555555555555")
    const started = Date.now()
    setTimeout(() => controller.abort(cancel), 500)
    const err = await failureOf(encodeBrowserSafePreview(src, join(dir, "preview.mp4"), { videoCodec: "ffv1", pixFmt: "yuv420p", width: 1280, height: 720, durationSec: 40 }, undefined, controller.signal))
    expect(err).toBe(cancel)
    expect(isPreviewEncodeFailure(err)).toBe(false)
    // Well before a 40 s encode could end on its own (a loose bound: the machine may be loaded).
    expect(Date.now() - started).toBeLessThan(60_000)
  }, 120_000)
})
