/**
 * A real process tree, on Linux: what yt-dlp starts (the PyInstaller
 * bootloader's Python, the ffmpeg it merges with) dies with it. A shell that
 * starts a child and waits stands in for the bootloader.
 */
import { describe, it, expect } from "vitest"
import { killYtDlpProcess, spawnYtDlpProcess } from "../ytdlp-process.js"

const groupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

describe.runIf(process.platform === "linux")("stopping yt-dlp stops what it started", () => {
  it("kills the whole group, the grandchild included", async () => {
    const proc = spawnYtDlpProcess("sh", ["-c", "sleep 60 & wait"])
    const pid = proc.pid as number
    expect(pid).toBeGreaterThan(0)
    // Let the shell start its child.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(groupAlive(pid)).toBe(true)
    killYtDlpProcess(proc)
    const deadline = Date.now() + 5_000
    while (groupAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
    expect(groupAlive(pid)).toBe(false)
  }, 10_000)
})
