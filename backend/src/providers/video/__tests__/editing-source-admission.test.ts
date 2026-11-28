// @test-reads-none runs only a stand-in ffmpeg script it writes to a temp folder
/**
 * The conform's clock starts when ffmpeg admits it (decided 2026-11-22):
 * `runFfmpeg` tells `onAdmitted` when a launch starts, and the editing
 * source's encode hands its caller's callback on. A stand-in `ffmpeg` on PATH
 * exits at once, so no real encode runs.
 */
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { runFfmpeg } from "../ffmpeg-utils.js"
import { encodeEditingSource } from "../browser-safe-preview.js"

const realPath = process.env.PATH ?? ""
let dir = ""
beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "editing-source-admission-"))
  await fs.writeFile(join(dir, "ffmpeg"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  process.env.PATH = realPath
})

describe("a launch tells its caller when it is admitted", () => {
  it("runFfmpeg calls onAdmitted once, when the launch starts", async () => {
    process.env.PATH = `${dir}:${realPath}`
    const onAdmitted = vi.fn()
    await runFfmpeg(["-v", "error", "-f", "null", "-"], 10_000, { onAdmitted })
    expect(onAdmitted).toHaveBeenCalledTimes(1)
  })

  it("encodeEditingSource hands the caller's onAdmitted to its launch", async () => {
    process.env.PATH = `${dir}:${realPath}`
    const onAdmitted = vi.fn()
    // The stand-in writes no file, so the frame check after the launch fails; the launch itself was admitted.
    await expect(encodeEditingSource(join(dir, "in.mp4"), join(dir, "out.mp4"), { width: 320, height: 180, durationSec: 1 }, { timeoutMs: 10_000, onAdmitted })).rejects.toThrow()
    expect(onAdmitted).toHaveBeenCalledTimes(1)
  })
})
