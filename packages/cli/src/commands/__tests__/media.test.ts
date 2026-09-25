import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { VIDEO_OVERLAY_CORNERS, VIDEO_OVERLAY_OUTPUT_ASPECTS, VIDEO_OVERLAY_PRESET_IDS } from "@nodaro/shared"
import { mediaCommand } from "../media.js"
import { warn, success, emit } from "../../output.js"

const mocks = {
  downloadVideo: vi.fn(),
  downloadVideoProgress: vi.fn(),
  saveToStorage: vi.fn(),
  trimVideo: vi.fn(),
  trimAudio: vi.fn(),
  stillToVideo: vi.fn(),
  slideshow: vi.fn(),
  videoMetadata: vi.fn(),
  imageCollage: vi.fn(),
  imageOverlay: vi.fn(),
  suggestOverlayPlacement: vi.fn(),
  videoOverlay: vi.fn(),
  addCaptions: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    media: {
      downloadVideo: mocks.downloadVideo,
      downloadVideoProgress: mocks.downloadVideoProgress,
      saveToStorage: mocks.saveToStorage,
      trimVideo: mocks.trimVideo,
      stillToVideo: mocks.stillToVideo,
      slideshow: mocks.slideshow,
      trimAudio: mocks.trimAudio,
      videoMetadata: mocks.videoMetadata,
      imageCollage: mocks.imageCollage,
      imageOverlay: mocks.imageOverlay,
      suggestOverlayPlacement: mocks.suggestOverlayPlacement,
      videoOverlay: mocks.videoOverlay,
      addCaptions: mocks.addCaptions,
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

  it("still-to-video maps image + audio + motion levers (defaults included)", async () => {
    mocks.stillToVideo.mockResolvedValueOnce({ jobId: "j-stv" })
    await runCmd(
      "media", "still-to-video",
      "--image", "https://x/still.png",
      "--audio", "https://x/track.mp3",
      "--motion", "ken-burns",
      "--intensity", "4",
      "--fit", "contain",
      "--pad-color", "#101010",
      "--json",
    )
    expect(mocks.stillToVideo).toHaveBeenCalledWith({
      imageUrl: "https://x/still.png",
      audioUrl: "https://x/track.mp3",
      motion: "ken-burns",
      intensity: 4,
      // commander applies the declared defaults for the unset levers
      resolution: "1080p",
      aspectRatio: "16:9",
      fit: "contain",
      padColor: "#101010",
    })
  })

  it("slideshow maps variadic images + auto durations", async () => {
    mocks.slideshow.mockResolvedValueOnce({ jobId: "j-sl" })
    await runCmd(
      "media", "slideshow",
      "--images", "https://x/a.png", "https://x/b.png", "https://x/c.png",
      "--audio", "https://x/t.mp3",
      "--durations", "10,auto,auto",
      "--json",
    )
    expect(mocks.slideshow).toHaveBeenCalledWith({
      imageUrls: ["https://x/a.png", "https://x/b.png", "https://x/c.png"],
      audioUrl: "https://x/t.mp3",
      imageDurations: [10, null, null],
      // commander fills the declared defaults
      transition: "cut",
      motion: "none",
      resolution: "1080p",
      aspectRatio: "16:9",
      fit: "cover",
    })
  })

  it("slideshow refuses a single image and points at still-to-video", async () => {
    await expect(
      runCmd("media", "slideshow", "--images", "https://x/a.png"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("still-to-video"))
    expect(mocks.slideshow).not.toHaveBeenCalled()
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

describe("media collage command", () => {
  it("maps images + per-image --sizes and options into the request", async () => {
    mocks.imageCollage.mockResolvedValueOnce({ jobId: "j5" })
    await runCmd(
      "media", "collage", "https://x/a.png", "https://x/b.png", "https://x/c.png",
      "--sizes", "1,0,3", "--layout", "smart", "--resolution", "2K",
      "--aspect-ratio", "16:9", "--gap", "12", "--background-color", "#000000", "--json",
    )
    expect(mocks.imageCollage).toHaveBeenCalledWith({
      imageUrls: ["https://x/a.png", "https://x/b.png", "https://x/c.png"],
      imageSizes: [1, 0, 3],
      layout: "smart",
      resolution: "2K",
      aspectRatio: "16:9",
      gap: 12,
      backgroundColor: "#000000",
    })
  })

  it("works without --sizes (all auto)", async () => {
    mocks.imageCollage.mockResolvedValueOnce({ jobId: "j6" })
    await runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--json")
    expect(mocks.imageCollage).toHaveBeenCalledWith({
      imageUrls: ["https://x/a.png", "https://x/b.png"],
    })
  })

  it("errors with fewer than 2 images", async () => {
    await expect(runCmd("media", "collage", "https://x/a.png")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("at least 2"))
    expect(mocks.imageCollage).not.toHaveBeenCalled()
  })

  it("errors on out-of-range --sizes and on more hints than images", async () => {
    await expect(
      runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--sizes", "1,4"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--sizes"))
    await expect(
      runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--sizes", "1,0,3"),
    ).rejects.toThrow("process.exit(1)")
    expect(mocks.imageCollage).not.toHaveBeenCalled()
  })

  it("errors on unknown --layout / --resolution", async () => {
    await expect(
      runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--layout", "mosaic"),
    ).rejects.toThrow("process.exit(1)")
    await expect(
      runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--resolution", "8K"),
    ).rejects.toThrow("process.exit(1)")
    expect(mocks.imageCollage).not.toHaveBeenCalled()
  })

  it("maps --numbered and repeatable --label into numbered + index-aligned imageLabels", async () => {
    mocks.imageCollage.mockResolvedValueOnce({ jobId: "j-storyboard" })
    await runCmd(
      "media", "collage", "https://x/a.png", "https://x/b.png", "https://x/c.png",
      "--numbered", "--label", "Wide", "--label", "", "--label", "Close-up", "--json",
    )
    expect(mocks.imageCollage).toHaveBeenCalledWith({
      imageUrls: ["https://x/a.png", "https://x/b.png", "https://x/c.png"],
      numbered: true,
      imageLabels: ["Wide", null, "Close-up"],
    })
  })

  it("omits imageLabels when every --label is blank", async () => {
    mocks.imageCollage.mockResolvedValueOnce({ jobId: "j-nolabels" })
    await runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--label", "  ", "--json")
    expect(mocks.imageCollage).toHaveBeenCalledWith({
      imageUrls: ["https://x/a.png", "https://x/b.png"],
    })
  })

  it("errors on more --label values than images", async () => {
    await expect(
      runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--label", "A", "--label", "B", "--label", "C"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("Too many --label"))
    expect(mocks.imageCollage).not.toHaveBeenCalled()
  })

  it("errors on a --label longer than 80 characters", async () => {
    await expect(
      runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--label", "x".repeat(81)),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("80 characters"))
    expect(mocks.imageCollage).not.toHaveBeenCalled()
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

describe("media collage --badge-position", () => {
  it("passes a valid corner through and rejects anything else", async () => {
    mocks.imageCollage.mockResolvedValueOnce({ jobId: "j-bp" })
    await runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--numbered", "--badge-position", "top-right", "--json")
    expect(mocks.imageCollage).toHaveBeenCalledWith({
      imageUrls: ["https://x/a.png", "https://x/b.png"],
      numbered: true,
      badgePosition: "top-right",
    })
    mocks.imageCollage.mockClear()
    await expect(
      runCmd("media", "collage", "https://x/a.png", "https://x/b.png", "--badge-position", "bottom-left"),
    ).rejects.toThrow("process.exit(1)")
    expect(mocks.imageCollage).not.toHaveBeenCalled()
  })
})

describe("media overlay command", () => {
  it("makes each positional URL an image layer sharing the flag placement", async () => {
    mocks.imageOverlay.mockResolvedValueOnce({ jobId: "j-ov" })
    await runCmd(
      "media", "overlay", "https://x/base.png", "https://x/logo.svg",
      "--anchor", "bottom-right", "--x", "-4", "--y", "-6", "--width", "12", "--opacity", "0.95", "--json",
    )
    expect(mocks.imageOverlay).toHaveBeenCalledWith({
      imageUrl: "https://x/base.png",
      layers: [{ imageUrl: "https://x/logo.svg", anchor: "bottom-right", x: -4, y: -6, width: 12, opacity: 0.95 }],
    })
  })

  it("maps --platform, the mask controls and --canvas into the request", async () => {
    mocks.imageOverlay.mockResolvedValueOnce({ jobId: "j-ov2" })
    await runCmd(
      "media", "overlay", "https://x/base.png", "https://x/logo.png",
      "--platform", "youtube-thumbnail", "--platform", "x-header",
      "--mask-mode", "around", "--mask-spread", "64",
      "--canvas", "1920x1080", "--base-fit", "cover", "--background-color", "#000000",
      "--output-format", "webp", "--qr-text", "https://nodaro.ai", "--json",
    )
    expect(mocks.imageOverlay).toHaveBeenCalledWith({
      imageUrl: "https://x/base.png",
      layers: [{ imageUrl: "https://x/logo.png" }],
      canvas: { width: 1920, height: 1080, backgroundColor: "#000000" },
      baseFit: "cover",
      outputFormat: "webp",
      variants: ["youtube-thumbnail", "x-header"],
      qrText: "https://nodaro.ai",
      maskMode: "around",
      maskSpread: 64,
    })
  })

  it("reads the full layers array from --layers-file (text / QR / shape kinds)", async () => {
    const file = join(tmpdir(), `overlay-layers-${Date.now()}.json`)
    const layers = [
      { kind: "text", text: { content: "50% OFF", fontId: "anton" }, anchor: "top-left", x: 5, y: 5 },
      { kind: "qr", qr: { text: "https://nodaro.ai" }, anchor: "bottom-right", x: -4, y: -4, width: 14 },
    ]
    writeFileSync(file, JSON.stringify(layers))
    mocks.imageOverlay.mockResolvedValueOnce({ jobId: "j-ov3" })
    try {
      await runCmd("media", "overlay", "https://x/base.png", "--layers-file", file, "--json")
    } finally {
      rmSync(file, { force: true })
    }
    expect(mocks.imageOverlay).toHaveBeenCalledWith({ imageUrl: "https://x/base.png", layers })
  })

  it("refuses positional layers together with --layers-file, and no layers at all", async () => {
    await expect(
      runCmd("media", "overlay", "https://x/base.png", "https://x/logo.png", "--layers-file", "layers.json"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("not both"))
    await expect(runCmd("media", "overlay", "https://x/base.png")).rejects.toThrow("process.exit(1)")
    expect(mocks.imageOverlay).not.toHaveBeenCalled()
  })

  it("errors on an unknown --anchor and an unknown --platform", async () => {
    await expect(
      runCmd("media", "overlay", "https://x/base.png", "https://x/l.png", "--anchor", "middle"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--anchor"))
    await expect(
      runCmd("media", "overlay", "https://x/base.png", "https://x/l.png", "--platform", "myspace-banner"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("Unknown --platform"))
    expect(mocks.imageOverlay).not.toHaveBeenCalled()
  })
})

describe("media video-overlay command", () => {
  it("pairs each positional layer URL with its --at window and the shared preset", async () => {
    mocks.videoOverlay.mockResolvedValueOnce({ jobId: "j-vo" })
    await runCmd(
      "media", "video-overlay", "https://x/clip.mp4", "https://x/a.png", "https://x/b.png",
      "--at", "1.2-2.6", "--at", "3", "--preset", "card", "--json",
    )
    expect(mocks.videoOverlay).toHaveBeenCalledWith({
      videoUrl: "https://x/clip.mp4",
      layers: [
        { imageUrl: "https://x/a.png", start: 1.2, end: 2.6, preset: "card" },
        { imageUrl: "https://x/b.png", start: 3, preset: "card" },
      ],
    })
  })

  it("maps --corner, --aspect, --base-fit and --background-color", async () => {
    mocks.videoOverlay.mockResolvedValueOnce({ jobId: "j-vo2" })
    await runCmd(
      "media", "video-overlay", "https://x/clip.mp4", "https://x/logo.png", "--at", "0",
      "--preset", "corner-badge", "--corner", "top-right",
      "--aspect", "9:16", "--base-fit", "contain", "--background-color", "#101010", "--json",
    )
    expect(mocks.videoOverlay).toHaveBeenCalledWith({
      videoUrl: "https://x/clip.mp4",
      layers: [{ imageUrl: "https://x/logo.png", start: 0, preset: "corner-badge", corner: "top-right" }],
      outputAspect: "9:16",
      baseFit: "contain",
      backgroundColor: "#101010",
    })
  })

  it("reads the full layers array from --layers-file", async () => {
    const file = join(tmpdir(), `video-overlay-layers-${Date.now()}.json`)
    const layers = [{ imageUrl: "https://x/logo.png", start: 0, anchor: "top-left", x: 4, y: 4, width: 12, opacity: 0.9 }]
    writeFileSync(file, JSON.stringify(layers))
    mocks.videoOverlay.mockResolvedValueOnce({ jobId: "j-vo3" })
    try {
      await runCmd("media", "video-overlay", "https://x/clip.mp4", "--layers-file", file, "--json")
    } finally {
      rmSync(file, { force: true })
    }
    expect(mocks.videoOverlay).toHaveBeenCalledWith({ videoUrl: "https://x/clip.mp4", layers })
  })

  it("refuses a --at count that does not match the layers, and a window that ends before it starts", async () => {
    await expect(runCmd("media", "video-overlay", "https://x/clip.mp4", "https://x/a.png", "https://x/b.png", "--at", "1")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("one --at per layer URL"))
    await expect(runCmd("media", "video-overlay", "https://x/clip.mp4", "https://x/a.png", "--at", "5-4")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('--at must be "<start>" or "<start>-<end>"'))
    expect(mocks.videoOverlay).not.toHaveBeenCalled()
  })

  it("refuses positional layers with --layers-file, an unknown --preset, and --base-fit without --aspect", async () => {
    await expect(
      runCmd("media", "video-overlay", "https://x/clip.mp4", "https://x/a.png", "--layers-file", "layers.json"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("not both"))
    await expect(runCmd("media", "video-overlay", "https://x/clip.mp4", "https://x/a.png", "--at", "0", "--preset", "banner")).rejects.toThrow("process.exit(1)")
    await expect(runCmd("media", "video-overlay", "https://x/clip.mp4", "https://x/a.png", "--at", "0", "--base-fit", "contain")).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith("--base-fit and --background-color need --aspect")
    expect(mocks.videoOverlay).not.toHaveBeenCalled()
  })
})

describe("media overlay-placement command", () => {
  it("asks for a placement and prints it (no job to poll)", async () => {
    const placement = { anchor: "bottom-right", x: -4, y: -6, width: 12, reason: "Calm sky in the corner." }
    mocks.suggestOverlayPlacement.mockResolvedValueOnce({ jobId: "j-place", placement })
    await runCmd(
      "media", "overlay-placement", "https://x/base.png",
      "--intent", "a logo", "--aspect", "2.5", "--safe-area", "0.05,0.05,0.9,0.9", "--json",
    )
    expect(mocks.suggestOverlayPlacement).toHaveBeenCalledWith({
      imageUrl: "https://x/base.png",
      intent: "a logo",
      layerAspect: 2.5,
      safeArea: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    })
    expect(vi.mocked(emit)).toHaveBeenCalledWith(placement, expect.anything())
  })

  it("errors on a malformed --safe-area", async () => {
    await expect(
      runCmd("media", "overlay-placement", "https://x/base.png", "--safe-area", "0.1,0.1,2"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--safe-area"))
    expect(mocks.suggestOverlayPlacement).not.toHaveBeenCalled()
  })
})

describe("media add-captions command", () => {
  it("maps the style + every look lever onto the SDK call", async () => {
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-cap1" })
    await runCmd(
      "media", "add-captions", "https://x/clip.mp4",
      "--style", "word-highlight", "--look", "outline", "--position", "top", "--position-y", "18",
      "--font-size", "48", "--font-family", "Montserrat", "--font-weight", "900",
      "--color", "white", "--background-color", "#000000",
      "--stroke-color", "black", "--stroke-width", "5", "--highlight-color", "#FFE600",
      "--uppercase", "--json",
    )
    expect(mocks.addCaptions).toHaveBeenCalledWith({
      videoUrl: "https://x/clip.mp4",
      style: "word-highlight",
      look: "outline",
      position: "top",
      positionY: 18,
      fontSize: 48,
      fontFamily: "Montserrat",
      fontWeight: 900,
      color: "white",
      backgroundColor: "#000000",
      strokeColor: "black",
      strokeWidth: 5,
      highlightColor: "#FFE600",
      uppercase: true,
    })
  })

  it("leaves autoTranscribe ABSENT unless --no-auto-transcribe is passed", async () => {
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-cap2" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "karaoke", "--json")
    expect(mocks.addCaptions).toHaveBeenCalledWith({ videoUrl: "https://x/clip.mp4", style: "karaoke" })
    expect(mocks.addCaptions.mock.calls[0][0]).not.toHaveProperty("autoTranscribe")
  })

  // The default `outline` look is already UPPERCASE, so the override that changes a
  // render is `uppercase: false` — a flag that could only send `true` was a no-op.
  it("--no-uppercase sends uppercase:false, and an untouched flag sends nothing", async () => {
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-up1" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "word-pop", "--no-uppercase", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).toMatchObject({ uppercase: false })

    mocks.addCaptions.mockClear()
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-up2" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "word-pop", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).not.toHaveProperty("uppercase")
  })

  // animate defaults to true server-side; the flag is a tri-state like --uppercase
  // (undefined unless passed), so --no-animate freezes motion and an untouched flag
  // sends nothing.
  it("--no-animate sends animate:false, --animate sends animate:true, and an untouched flag sends nothing", async () => {
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-an1" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "word-highlight", "--no-animate", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).toMatchObject({ animate: false })

    mocks.addCaptions.mockClear()
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-an2" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "word-highlight", "--animate", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).toMatchObject({ animate: true })

    mocks.addCaptions.mockClear()
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-an3" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "word-highlight", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).not.toHaveProperty("animate")
  })

  it("--max-words-per-line sends a NUMBER, and an untouched flag sends nothing", async () => {
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-mw1" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "word-highlight", "--max-words-per-line", "3", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).toMatchObject({ maxWordsPerLine: 3 })

    mocks.addCaptions.mockClear()
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-mw2" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "word-highlight", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).not.toHaveProperty("maxWordsPerLine")
  })

  it("--max-words-per-line takes it on the static subtitle style too (a styling lever, not a kinetic one)", async () => {
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-mw3" })
    await runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "subtitle", "--max-words-per-line", "2", "--json")
    expect(mocks.addCaptions.mock.calls[0][0]).toMatchObject({ style: "subtitle", maxWordsPerLine: 2 })
  })

  it("errors on a --max-words-per-line outside the bounds or not a whole number", async () => {
    for (const bad of ["0", "21", "2.5", "abc"]) {
      vi.mocked(warn).mockClear()
      await expect(
        runCmd("media", "add-captions", "https://x/clip.mp4", "--max-words-per-line", bad),
      ).rejects.toThrow("process.exit(1)")
      // The refusal quotes what was TYPED, so "2.5" reads back as 2.5, not 2.
      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--max-words-per-line"))
      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining(bad))
    }
    expect(mocks.addCaptions).not.toHaveBeenCalled()
  })

  it("sends autoTranscribe:false and the transcribe provider when asked", async () => {
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-cap3" })
    await runCmd(
      "media", "add-captions", "https://x/clip.mp4", "--text", "hello world",
      "--no-auto-transcribe", "--transcribe-provider", "elevenlabs-stt", "--json",
    )
    expect(mocks.addCaptions).toHaveBeenCalledWith({
      videoUrl: "https://x/clip.mp4",
      text: "hello world",
      autoTranscribe: false,
      transcribeProvider: "elevenlabs-stt",
    })
  })

  it("passes a --captions-file word list through verbatim", async () => {
    const file = join(tmpdir(), `captions-words-${Date.now()}.json`)
    const words = [
      { text: "hello", startMs: 0, endMs: 320 },
      { text: "world", startMs: 320, endMs: 700, speaker: "speaker_0" },
    ]
    writeFileSync(file, JSON.stringify(words))
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-cap4" })
    try {
      await runCmd(
        "media", "add-captions", "https://x/clip.mp4", "--captions-file", file,
        "--style", "word-highlight", "--no-auto-transcribe", "--json",
      )
    } finally {
      rmSync(file, { force: true })
    }
    expect(mocks.addCaptions).toHaveBeenCalledWith({
      videoUrl: "https://x/clip.mp4",
      captions: words,
      style: "word-highlight",
      autoTranscribe: false,
    })
  })

  it("reads per-range treatments from --segments-file", async () => {
    const file = join(tmpdir(), `captions-segments-${Date.now()}.json`)
    const segments = [
      { startMs: 0, endMs: 3000, style: "word-pop", fontSize: 72, position: "top" },
      { startMs: 3000, endMs: 12000, style: "word-highlight", look: "clean" },
    ]
    writeFileSync(file, JSON.stringify(segments))
    mocks.addCaptions.mockResolvedValueOnce({ jobId: "j-cap5" })
    try {
      await runCmd("media", "add-captions", "https://x/clip.mp4", "--segments-file", file, "--json")
    } finally {
      rmSync(file, { force: true })
    }
    expect(mocks.addCaptions).toHaveBeenCalledWith({ videoUrl: "https://x/clip.mp4", segments })
  })

  it("errors when a file input is not a non-empty JSON array", async () => {
    const file = join(tmpdir(), `captions-bad-${Date.now()}.json`)
    writeFileSync(file, JSON.stringify({ text: "not an array" }))
    try {
      await expect(
        runCmd("media", "add-captions", "https://x/clip.mp4", "--captions-file", file),
      ).rejects.toThrow("process.exit(1)")
    } finally {
      rmSync(file, { force: true })
    }
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--captions-file"))
    expect(mocks.addCaptions).not.toHaveBeenCalled()
  })

  it("errors on an unknown --style, --look, --font-family, --font-weight and --transcribe-provider", async () => {
    await expect(
      runCmd("media", "add-captions", "https://x/clip.mp4", "--style", "glitter"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--style"))
    await expect(
      runCmd("media", "add-captions", "https://x/clip.mp4", "--look", "neon"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--look"))
    await expect(
      runCmd("media", "add-captions", "https://x/clip.mp4", "--font-family", "Comic Sans"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--font-family"))
    await expect(
      runCmd("media", "add-captions", "https://x/clip.mp4", "--font-weight", "850"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--font-weight"))
    await expect(
      runCmd("media", "add-captions", "https://x/clip.mp4", "--transcribe-provider", "deepgram"),
    ).rejects.toThrow("process.exit(1)")
    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("--transcribe-provider"))
    expect(mocks.addCaptions).not.toHaveBeenCalled()
  })
})

/**
 * docs/cli.md is the public CLI reference; every `nodaro media` subcommand the
 * package ships must be listed there (video-overlay shipped without one).
 */
describe("docs/cli.md covers the media command surface", () => {
  const doc = readFileSync(
    fileURLToPath(new URL("../../../../../docs/cli.md", import.meta.url)),
    "utf8",
  ).replace(/\r\n/g, "\n")
  const synopsisOf = (name: string): string | undefined =>
    doc.split("\n").find((line) => line.startsWith(`nodaro media ${name} `))

  it.each(mediaCommand().commands.map((c) => c.name()))("documents `nodaro media %s`", (name) => {
    expect(synopsisOf(name)).toBeDefined()
  })

  it("lists every video-overlay flag and enum value in its synopsis", () => {
    const line = synopsisOf("video-overlay") ?? ""
    const sub = mediaCommand().commands.find((c) => c.name() === "video-overlay")
    const flags = (sub?.options ?? []).map((o) => o.long).filter((f): f is string => !!f && f !== "--profile")
    expect(flags.length).toBeGreaterThan(5)
    for (const flag of flags) expect(line).toContain(`[${flag}`)
    expect(line).toContain(`--preset ${VIDEO_OVERLAY_PRESET_IDS.join("|")}`)
    expect(line).toContain(`--corner ${VIDEO_OVERLAY_CORNERS.join("|")}`)
    expect(line).toContain(`--aspect ${VIDEO_OVERLAY_OUTPUT_ASPECTS.join("|")}`)
  })

  it("names video overlay in the Media section header", () => {
    expect(doc).toMatch(/^# Media — .*\bvideo overlay\b/m)
  })
})
