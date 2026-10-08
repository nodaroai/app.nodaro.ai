/**
 * UPLOAD_FASTSTART_ENABLED (decided 2026-10-08): the kill switch for the whole
 * rewrite. Off = both entry points return the input untouched ("disabled"),
 * before any probe, disk check or ffmpeg launch; on = the normal path runs.
 * The switch is exercised end to end on every lane in
 * routes/__tests__/upload-faststart.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const switchState = vi.hoisted(() => ({ enabled: true }))
vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  uploadFaststartEnabled: () => switchState.enabled,
}))
const launcher = vi.hoisted(() => ({ calls: 0 }))
vi.mock("../../providers/video/ffmpeg-cancellable.js", () => ({
  runFfmpegCancellable: vi.fn(async () => { launcher.calls++ }),
}))

import { faststartVideoBuffer, faststartVideoFile, noteFaststartOutcome } from "../faststart.js"

// ftyp + mdat + moov: a moov-last file the box walk accepts.
function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + payload.length, 0)
  head.write(type, 4, "latin1")
  return Buffer.concat([head, payload])
}
const moovLast = Buffer.concat([
  box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.alloc(4), Buffer.from("isom")])),
  box("mdat", Buffer.alloc(64)),
  box("moov", Buffer.alloc(32)),
])

beforeEach(() => {
  switchState.enabled = true
  launcher.calls = 0
})

describe("faststart kill switch", () => {
  it("off: the buffer comes back as the same object, nothing is launched", async () => {
    switchState.enabled = false
    const r = await faststartVideoBuffer(moovLast, "video/mp4")
    expect(r.outcome).toBe("disabled")
    expect(r.buffer).toBe(moovLast)
    expect(launcher.calls).toBe(0)
  })

  it("off: the file path comes back unchanged, nothing is launched", async () => {
    switchState.enabled = false
    const r = await faststartVideoFile("/nonexistent/in.mp4", "video/mp4")
    expect(r).toEqual({ path: "/nonexistent/in.mp4", outcome: "disabled" })
    expect(launcher.calls).toBe(0)
  })

  it("off is silent: no warning is logged for a deliberate skip", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    noteFaststartOutcome("upload", "disabled")
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("on: a moov-last buffer gets past the switch and reaches the remux", async () => {
    // Free disk is forced to 0 so the attempt stops at the disk check: proves the
    // gate let it through without needing real ffmpeg for this file.
    const r = await faststartVideoBuffer(moovLast, "video/mp4", { freeBytes: async () => 0 })
    expect(r.outcome).toBe("no-disk")
    expect(r.buffer).toBe(moovLast)
  })
})
