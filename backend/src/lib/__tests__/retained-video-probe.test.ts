import { readFile, stat } from "node:fs/promises"
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock("node:child_process", () => ({ execFile: mocks.exec }))
import { probeRetainedVideo } from "../retained-video-probe.js"
const valid = { streams: [{ codec_type: "video", width: 1920, height: 1080 }], format: { format_name: "mov,mp4", duration: "1.25" } }
beforeEach(() => { vi.resetAllMocks() })
function respond(output: unknown, error?: Error) {
  mocks.exec.mockImplementation((_exe, _args, _opts, done) => done(error ?? null, { stdout: JSON.stringify(output) }))
}
it("probes only a private local file with bounded execution and removes the file", async () => {
  let path = ""
  mocks.exec.mockImplementation((exe, args, opts, done) => {
    void (async () => {
    path = args.at(-1)
    expect(exe).toBe("ffprobe")
    expect(await readFile(path)).toEqual(Buffer.from("video bytes"))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(args).toEqual(expect.arrayContaining(["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm"]))
    expect(opts).toMatchObject({ timeout: 30_000, maxBuffer: 128 * 1024 })
    done(null, { stdout: JSON.stringify(valid) })
    })().catch(done)
  })
  expect(await probeRetainedVideo(Buffer.from("video bytes"))).toEqual({ width: 1920, height: 1080, durationMs: 1250, contentType: "video/mp4" })
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" })
})
it.each([
  {}, { ...valid, streams: [] }, { ...valid, streams: [...valid.streams, ...valid.streams] },
  { ...valid, format: { format_name: "hls", duration: "1" } },
  { ...valid, format: { format_name: "mov", duration: "Infinity" } },
  { ...valid, streams: [{ codec_type: "video", width: 0, height: 10 }] },
])("refuses invalid or unsupported metadata %j", async (output) => {
  respond(output)
  await expect(probeRetainedVideo(Buffer.from("bytes"))).rejects.toThrow()
})
it("accepts webm without changing the captured bytes", async () => {
  respond({ ...valid, format: { format_name: "matroska,webm", duration: "1.25" } })
  expect(await probeRetainedVideo(Buffer.from("webm"))).toHaveProperty("contentType", "video/webm")
})
