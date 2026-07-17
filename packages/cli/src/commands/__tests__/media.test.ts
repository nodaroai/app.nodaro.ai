import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { mediaCommand } from "../media.js"
import { warn, success, emit } from "../../output.js"

const mocks = {
  downloadVideo: vi.fn(),
  downloadVideoProgress: vi.fn(),
  saveToStorage: vi.fn(),
  trimVideo: vi.fn(),
  trimAudio: vi.fn(),
  videoMetadata: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    media: {
      downloadVideo: mocks.downloadVideo,
      downloadVideoProgress: mocks.downloadVideoProgress,
      saveToStorage: mocks.saveToStorage,
      trimVideo: mocks.trimVideo,
      trimAudio: mocks.trimAudio,
      videoMetadata: mocks.videoMetadata,
    },
    jobs: { get: mocks.jobsGet },
  }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return {
    ...actual,
    emit: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dim: vi.fn(),
    warn: vi.fn(),
    detail: vi.fn(),
    table: vi.fn(),
  }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(mediaCommand())
  await program.parseAsync(["node", "test", ...args])
}

/** An async generator over the given progress events, as the SDK yields them. */
async function* progressEvents(events: Array<Record<string, unknown>>) {
  for (const ev of events) yield ev
}

let exitSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  vi.mocked(warn).mockClear()
  vi.mocked(success).mockClear()
  vi.mocked(emit).mockClear()
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`)
  }) as never)
})
afterEach(() => {
  exitSpy.mockRestore()
})

describe("media download command", () => {
  it("maps --max-height and --section into the request", async () => {
    mocks.downloadVideo.mockResolvedValueOnce({ downloadId: "dl-1" })
    await runCmd("media", "download", "https://youtu.be/x", "--max-height", "720", "--section", "30-90.5", "--json")
    expect(mocks.downloadVideo).toHaveBeenCalledWith({
      url: "https://youtu.be/x",
      maxHeight: 720,
      sectionStartSec: 30,
      sectionEndSec: 90.5,
    })
    expect(vi.mocked(emit)).toHaveBeenCalledWith({ downloadId: "dl-1" }, expect.anything())
  })

  it("errors on a malformed --section", async () => {
    await expect(
      runCmd("media", "download", "https://youtu.be/x", "--section", "90-30"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--section"))
    expect(mocks.downloadVideo).not.toHaveBeenCalled()
  })

  it("--watch streams progress and reports the completed video url", async () => {
    mocks.downloadVideo.mockResolvedValueOnce({ downloadId: "dl-2" })
    mocks.downloadVideoProgress.mockReturnValueOnce(
      progressEvents([
        { phase: "downloading", percent: 40 },
        { phase: "uploading", percent: 100 },
        { phase: "completed", percent: 100, videoUrl: "https://r2/v.mp4" },
      ]),
    )
    await runCmd("media", "download", "https://youtu.be/x", "--watch")
    expect(mocks.downloadVideoProgress).toHaveBeenCalledWith("dl-2")
    expect(vi.mocked(success)).toHaveBeenCalledWith(expect.stringContaining("downloaded in"))
  })

  it("--watch exits 2 when the download fails", async () => {
    mocks.downloadVideo.mockResolvedValueOnce({ downloadId: "dl-3" })
    mocks.downloadVideoProgress.mockReturnValueOnce(
      progressEvents([
        { phase: "downloading", percent: 10 },
        { phase: "failed", percent: 10, error: "video unavailable" },
      ]),
    )
    await expect(runCmd("media", "download", "https://youtu.be/x", "--watch")).rejects.toThrow("process.exit(2)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("video unavailable"))
  })
})

describe("media metadata command", () => {
  it("probes and returns the metadata", async () => {
    mocks.videoMetadata.mockResolvedValueOnce({ durationSec: 212, width: 1280, height: 720 })
    await runCmd("media", "metadata", "https://youtu.be/x", "--json")
    expect(mocks.videoMetadata).toHaveBeenCalledWith({ url: "https://youtu.be/x" })
    expect(vi.mocked(emit)).toHaveBeenCalledWith({ durationSec: 212, width: 1280, height: 720 }, expect.anything())
  })
})

describe("media trim commands", () => {
  it("trim-video maps the range flags", async () => {
    mocks.trimVideo.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd("media", "trim-video", "--video", "https://x/v.mp4", "--start", "12", "--end", "48", "--json")
    expect(mocks.trimVideo).toHaveBeenCalledWith({ videoUrl: "https://x/v.mp4", startTime: 12, endTime: 48 })
  })

  it("trim-video maps --keep-first / --keep-last", async () => {
    mocks.trimVideo.mockResolvedValueOnce({ jobId: "j2" })
    await runCmd("media", "trim-video", "--video", "https://x/v.mp4", "--keep-first", "60", "--json")
    expect(mocks.trimVideo).toHaveBeenCalledWith({ videoUrl: "https://x/v.mp4", keepFirstSeconds: 60 })
  })

  it("trim-video errors when no range is given", async () => {
    await expect(runCmd("media", "trim-video", "--video", "https://x/v.mp4")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("range"))
    expect(mocks.trimVideo).not.toHaveBeenCalled()
  })

  it("trim-audio maps source + format", async () => {
    mocks.trimAudio.mockResolvedValueOnce({ jobId: "j3" })
    await runCmd("media", "trim-audio", "--video", "https://x/v.mp4", "--start", "0", "--end", "30", "--format", "wav", "--json")
    expect(mocks.trimAudio).toHaveBeenCalledWith({
      videoUrl: "https://x/v.mp4",
      startTime: 0,
      endTime: 30,
      audioFormat: "wav",
    })
  })

  it("trim-audio errors without a source", async () => {
    await expect(runCmd("media", "trim-audio", "--start", "0")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--video"))
  })

  it("trim-audio errors on an unknown --format", async () => {
    await expect(
      runCmd("media", "trim-audio", "--audio", "https://x/a.mp3", "--format", "flac"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--format"))
  })
})

describe("media save command", () => {
  it("maps filename + type", async () => {
    mocks.saveToStorage.mockResolvedValueOnce({ jobId: "j4" })
    await runCmd("media", "save", "https://ext/x.mp4", "--filename", "clip.mp4", "--type", "video", "--json")
    expect(mocks.saveToStorage).toHaveBeenCalledWith({
      mediaUrl: "https://ext/x.mp4",
      filename: "clip.mp4",
      mediaType: "video",
    })
  })

  it("errors on an unknown --type", async () => {
    await expect(runCmd("media", "save", "https://ext/x.bin", "--type", "document")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--type"))
  })
})
