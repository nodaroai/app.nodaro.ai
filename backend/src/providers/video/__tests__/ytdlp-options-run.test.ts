/**
 * THE AUDIO LANES KILL THE WHOLE PROCESS GROUP (round 4 of #1860, decided 2026-10-05).
 *
 * `youtube-dl-exec` stopped yt-dlp with Node's `signal`, which reaches yt-dlp
 * alone: the ffmpeg it started (`-x --audio-format mp3`) outlived the 30-minute
 * hold that reserves its memory, unreserved. `runYtDlpOptions` spawns yt-dlp as
 * its own process group and kills the GROUP at the hold or an abort.
 *
 * REAL processes: a shell script stands in for the yt-dlp bootloader — it starts a
 * long `sleep` (the ffmpeg) and waits, and records the child's pid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const fx = vi.hoisted(() => ({ placed: undefined as { decode: number; filter: number; encode: number } | undefined }))
vi.mock("../ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-threads.js")>()),
  ffmpegThreads: () => fx.placed,
  ffmpegEffectiveThreads: () => fx.placed ?? { decode: 2, filter: 2, encode: 2 },
}))

import { runYtDlpOptions } from "../ytdlp-options-run.js"
import { YtDlpHaltError } from "../ytdlp-process.js"

const AUDIO = { extractAudio: true, audioFormat: "mp3", audioQuality: 0, noPlaylist: true, output: "/tmp/x.%(ext)s" }
const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const until = async (cond: () => boolean, ms = 8_000): Promise<boolean> => {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50))
  return cond()
}

describe.runIf(process.platform !== "win32")("runYtDlpOptions", () => {
  let dir: string
  const script = (name: string, body: string): string => {
    const path = join(dir, name)
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
    return path
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ytdlp-run-"))
    fx.placed = undefined
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("the child ffmpeg is gone after the hold — the group is killed, not just yt-dlp", async () => {
    const pidFile = join(dir, "ffmpeg.pid")
    const bin = script("yt-dlp", `sleep 300 &\necho $! > "${pidFile}"\nwait`)
    const run = runYtDlpOptions(URL_, AUDIO, { bin, holdMs: 700 }).catch((err: Error) => err)
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "")).toBe(true)
    const ffmpeg = Number(readFileSync(pidFile, "utf8").trim())
    expect(alive(ffmpeg)).toBe(true)
    const error = await run
    expect(error).toBeInstanceOf(YtDlpHaltError)
    expect(error).toMatchObject({ reason: "out_of_time" })
    // SIGTERM to the group at the hold, SIGKILL after the grace: either way, nothing is left running.
    expect(await until(() => !alive(ffmpeg))).toBe(true)
  }, 20_000)

  it("the caller's abort kills the group the same way, as an aborted halt", async () => {
    const pidFile = join(dir, "ffmpeg.pid")
    const bin = script("yt-dlp", `sleep 300 &\necho $! > "${pidFile}"\nwait`)
    const controller = new AbortController()
    const run = runYtDlpOptions(URL_, AUDIO, { bin, signal: controller.signal }).catch((err: Error) => err)
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "")).toBe(true)
    const ffmpeg = Number(readFileSync(pidFile, "utf8").trim())
    controller.abort()
    expect(await run).toMatchObject({ name: "YtDlpHaltError", reason: "aborted" })
    expect(await until(() => !alive(ffmpeg))).toBe(true)
  }, 20_000)

  it("a failure keeps the shape youtube-dl-exec gave: the message is stderr, with stderr, stdout and the exit code attached", async () => {
    const bin = script("yt-dlp", `echo "partial" \necho "ERROR: Sign in to confirm you're not a bot" >&2\nexit 1`)
    const error = (await runYtDlpOptions(URL_, AUDIO, { bin }).catch((err: Error) => err)) as Error & { stderr: string; stdout: string; exitCode: number }
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(YtDlpHaltError)
    expect(error.message).toBe("ERROR: Sign in to confirm you're not a bot")
    expect(error.stderr).toContain("Sign in to confirm")
    expect(error.stdout).toContain("partial")
    expect(error.exitCode).toBe(1)
  })

  it("a missing binary rejects with the spawn error, as the library did", async () => {
    await expect(runYtDlpOptions(URL_, AUDIO, { bin: join(dir, "nope") })).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("spawns the url first, then the options as flags, then the quota's thread counts for the ffmpeg it starts", async () => {
    fx.placed = { decode: 3, filter: 3, encode: 3 }
    const argsFile = join(dir, "args")
    const bin = script("yt-dlp", `for a in "$@"; do echo "$a"; done > "${argsFile}"`)
    await runYtDlpOptions(URL_, { ...AUDIO, addHeader: ["referer:youtube.com", "x:y"] }, { bin })
    const argv = readFileSync(argsFile, "utf8").trimEnd().split("\n")
    expect(argv.slice(0, 7)).toEqual([URL_, "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0", "--no-playlist"])
    expect(argv).toEqual(expect.arrayContaining(["--add-header", "referer:youtube.com", "ExtractAudio+ffmpeg_i:-threads 3"]))
    expect(argv.indexOf("ExtractAudio+ffmpeg_i:-threads 3")).toBeGreaterThan(argv.indexOf("--no-playlist"))
  })

  it("a run that only copies streams is neither pinned nor held", async () => {
    fx.placed = { decode: 3, filter: 3, encode: 3 }
    const argsFile = join(dir, "args")
    const bin = script("yt-dlp", `for a in "$@"; do echo "$a"; done > "${argsFile}"`)
    await runYtDlpOptions(URL_, { mergeOutputFormat: "mp4", noPlaylist: true }, { bin })
    expect(readFileSync(argsFile, "utf8").trimEnd().split("\n")).toEqual([URL_, "--merge-output-format", "mp4", "--no-playlist"])
  })
})
