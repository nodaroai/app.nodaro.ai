import { beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import sharp from "sharp"

const state = vi.hoisted(() => ({ fetch: vi.fn(), run: vi.fn(), create: vi.fn(), cleanup: vi.fn(), directory: "" }))
vi.mock("../safe-fetch.js", () => ({ safeFetch: state.fetch }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ createWorkDir: state.create, cleanupWorkDir: state.cleanup, runFfmpeg: state.run }))
import { readPublicVideoFrame } from "../public-video-frame.js"

let frame: Buffer
beforeEach(async () => {
  vi.resetAllMocks()
  frame = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer()
  state.create.mockImplementation(async () => {
    state.directory = await mkdtemp(join(tmpdir(), "public-frame-test-"))
    return state.directory
  })
  state.cleanup.mockImplementation(async (directory: string) => rm(directory, { recursive: true, force: true }))
  state.fetch.mockResolvedValue(new Response(Buffer.from("video bytes")))
  state.run.mockImplementation(async (args: string[]) => {
    expect(await readFile(args[args.indexOf("-i") + 1]!)).toEqual(Buffer.from("video bytes"))
    await writeFile(args.at(-1)!, frame)
    return ""
  })
})

describe("bounded public source-frame extraction", () => {
  it("downloads publicly to a private workdir, extracts one local frame and removes all temporary bytes", async () => {
    expect(await readPublicVideoFrame({ videoUrl: "https://media.test/source.mp4", timeSec: 1.25 })).toEqual(frame)
    expect(state.fetch).toHaveBeenCalledWith("https://media.test/source.mp4", { timeoutMs: 120_000 })
    const [args, timeout] = state.run.mock.calls[0]!
    expect(args).toContain("1.25")
    expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual(["-frames:v", "1"])
    expect(args.slice(args.indexOf("-format_whitelist"), args.indexOf("-format_whitelist") + 2)).toEqual(["-format_whitelist", "mov,matroska,webm,avi"])
    expect(args.slice(args.indexOf("-protocol_whitelist"), args.indexOf("-protocol_whitelist") + 2)).toEqual(["-protocol_whitelist", "file,pipe"])
    expect(args.join(" ")).not.toContain("https://")
    expect(timeout).toBe(60_000)
    await expect(stat(state.directory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it.each([404, 403])("does not bypass an HTTP %s with a storage-origin read", async (status) => {
    state.fetch.mockResolvedValue(new Response("missing", { status }))
    await expect(readPublicVideoFrame({ videoUrl: "https://media.test/source.mp4", timeSec: 0 })).rejects.toThrow("Video download failed")
    expect(state.fetch).toHaveBeenCalledOnce()
    expect(state.run).not.toHaveBeenCalled()
    await expect(stat(state.directory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects oversize and interrupted downloads before invoking ffmpeg", async () => {
    state.fetch.mockResolvedValueOnce(new Response("large", { headers: { "content-length": String(500 * 1024 * 1024 + 1) } }))
    await expect(readPublicVideoFrame({ videoUrl: "https://media.test/source.mp4", timeSec: 0 })).rejects.toThrow("size limit")
    state.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error("deadline")) } })))
    await expect(readPublicVideoFrame({ videoUrl: "https://media.test/source.mp4", timeSec: 0 })).rejects.toThrow("deadline")
    expect(state.run).not.toHaveBeenCalled()
    await expect(stat(state.directory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("cleans up when the timestamp or container produces no frame", async () => {
    state.run.mockResolvedValue("")
    await expect(readPublicVideoFrame({ videoUrl: "https://media.test/source.mp4", timeSec: 99 })).rejects.toMatchObject({ code: "ENOENT" })
    await expect(stat(state.directory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects invalid timestamps before network or disk work", async () => {
    for (const timeSec of [-1, NaN, Infinity]) {
      await expect(readPublicVideoFrame({ videoUrl: "https://media.test/source.mp4", timeSec })).rejects.toThrow("timestamp")
    }
    expect(state.fetch).not.toHaveBeenCalled()
    expect(state.create).not.toHaveBeenCalled()
  })
})
