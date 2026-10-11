// The no-progress watchdog on a real process: `runFfmpeg` launches a FAKE
// ffmpeg (a shell script first on PATH) that behaves like the evidence's stalled
// launch, a slow one, and a busy one. The stall window is shortened so the
// file runs in seconds; the rules are the production ones.
//
// CPU time is read from /proc where it exists (Linux, CI). On a dev Mac the
// stall/slow cases inject an idle reader; the busy case needs the real one.
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runFfmpeg } from "../ffmpeg-utils.js"
import { isFfmpegStall, readProcessCpuSec, type FfmpegStallWatch } from "../ffmpeg-stall-watchdog.js"

const hasProc = existsSync("/proc/self/stat")
const STALL_MS = 1_500
const watch: FfmpegStallWatch = { stallMs: STALL_MS, tickMs: 100, ...(hasProc ? {} : { readCpuSec: () => 0 }) }

let dir = ""
let savedPath: string | undefined

/** Install `script` as the `ffmpeg` on PATH for one launch. */
async function fake(script: string): Promise<void> {
  await fs.writeFile(join(dir, "ffmpeg"), `#!/bin/sh\n${script}\n`, { mode: 0o755 })
}

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "fake-ffmpeg-"))
  savedPath = process.env.PATH
  process.env.PATH = `${dir}:${savedPath ?? ""}`
})
afterAll(async () => {
  process.env.PATH = savedPath
  await fs.rm(dir, { recursive: true, force: true })
})

describe("runFfmpeg with the stall watchdog, on a real process", () => {
  it("a launch whose stats freeze (only elapsed ticks) is killed and reported as a stall", async () => {
    await fake([
      `printf 'frame=   10 fps=5.0 q=24.0 size=     256KiB time=00:00:00.33 bitrate=1.0kbits/s speed=0.1x elapsed=0:00:01.00    \\r' >&2`,
      `i=0; while :; do i=$((i+1)); printf "frame=   56 fps=2.0 q=24.0 size=    2048KiB time=00:00:01.80 bitrate=9320.9kbits/s speed=0.1x elapsed=0:00:$i.00    \\r" >&2; sleep 0.2; done`,
    ].join("\n"))
    const t0 = Date.now()
    const err = await runFfmpeg(["-y", "out.mp4"], 60_000, undefined, watch).catch((e: unknown) => e)
    const took = Date.now() - t0
    expect(isFfmpegStall(err)).toBe(true)
    expect((err as Error).message).toMatch(/^ffmpeg failed: /)
    expect(took).toBeGreaterThanOrEqual(STALL_MS)
    expect(took).toBeLessThan(STALL_MS + 5_000) // nowhere near the 60 s kill budget
    expect((err as { ranMs: number }).ranMs).toBeGreaterThanOrEqual(STALL_MS)
  }, 20_000)

  it("a launch that makes progress SLOWLY — a new frame every ~0.6 s, over 3× the window — is never killed", async () => {
    await fake([
      `for f in 1 2 3 4 5 6 7 8; do printf "frame=   $f fps=1.0 q=24.0 size=     $((f*32))KiB time=00:00:0$f.00 bitrate=1.0kbits/s speed=0.1x elapsed=0:00:0$f.00    \\r" >&2; sleep 0.6; done`,
      `printf '\\n' >&2; exit 0`,
    ].join("\n"))
    await expect(runFfmpeg(["-y", "out.mp4"], 60_000, undefined, watch)).resolves.toBe("")
  }, 20_000)

  it.skipIf(!hasProc)("a launch that prints nothing new but is busy on the CPU (decoding toward its next window) is never killed", async () => {
    // Busy for ~6 s — three windows — with frozen stats, then finishes: CPU
    // time alone keeps it alive. The CPU bar is lowered to a tenth of a core so
    // a loaded CI runner sharing its cores with other test workers cannot
    // starve the busy loop under it.
    await fake([
      `printf 'frame=    0 fps=0.0 q=0.0 size=       0KiB time=N/A bitrate=N/A speed=N/A elapsed=0:00:00.50    \\r' >&2`,
      `end=$(( $(date +%s) + 6 )); while [ "$(date +%s)" -lt "$end" ]; do i=0; while [ $i -lt 20000 ]; do i=$((i+1)); done; done`,
      `exit 0`,
    ].join("\n"))
    const busyWatch: FfmpegStallWatch = { stallMs: 2_000, cpuSec: 0.2, tickMs: 100 }
    await expect(runFfmpeg(["-y", "out.mp4"], 60_000, undefined, busyWatch)).resolves.toBe("")
  }, 20_000)

  it("without a watch, runFfmpeg is unchanged — a real failure is a plain ffmpeg failure, not a stall", async () => {
    await fake(`echo 'Error opening input' >&2; exit 1`)
    const err = await runFfmpeg(["-y", "out.mp4"], 60_000).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^ffmpeg failed: Error opening input/)
    expect(isFfmpegStall(err)).toBe(false)
  }, 20_000)

  it.skipIf(!hasProc)("reads a live process's CPU time from /proc", () => {
    const cpu = readProcessCpuSec(process.pid)
    expect(cpu).toBeGreaterThan(0)
  })
})
