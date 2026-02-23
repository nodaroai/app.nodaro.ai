import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from("watermarked"))
  const mockComposite = vi.fn().mockReturnValue({ toBuffer: mockToBuffer })
  const mockMetadata = vi.fn().mockResolvedValue({ width: 1920, height: 1080 })
  const mockSharp = vi.fn().mockImplementation(() => ({
    metadata: mockMetadata,
    composite: mockComposite,
  }))
  const mockRunFfmpeg = vi.fn().mockResolvedValue(undefined)
  return { mockSharp, mockMetadata, mockComposite, mockToBuffer, mockRunFfmpeg }
})

vi.mock("sharp", () => ({ default: mocks.mockSharp }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  runFfmpeg: mocks.mockRunFfmpeg,
  BROWSER_SAFE_VIDEO_ARGS: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
}))

import { applyImageWatermark, applyVideoWatermark } from "../watermark.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("applyImageWatermark", () => {
  it("returns a buffer with watermark composited", async () => {
    const input = Buffer.from("original image")
    const result = await applyImageWatermark(input)
    expect(result).toBeInstanceOf(Buffer)
    expect(mocks.mockSharp).toHaveBeenCalledWith(input)
    expect(mocks.mockComposite).toHaveBeenCalledWith([
      expect.objectContaining({ top: 0, left: 0 }),
    ])
  })

  it("computes font size as 2.5% of width (min 16px)", async () => {
    mocks.mockMetadata.mockResolvedValueOnce({ width: 800, height: 600 })
    await applyImageWatermark(Buffer.from("test"))
    // 800 * 0.025 = 20, which is > 16
    const compositeCall = mocks.mockComposite.mock.calls[0][0][0]
    const svg = compositeCall.input.toString()
    expect(svg).toContain('font-size="20"')
  })

  it("uses minimum font size of 16px for small images", async () => {
    mocks.mockMetadata.mockResolvedValueOnce({ width: 200, height: 200 })
    await applyImageWatermark(Buffer.from("test"))
    // 200 * 0.025 = 5, clamped to 16
    const compositeCall = mocks.mockComposite.mock.calls[0][0][0]
    const svg = compositeCall.input.toString()
    expect(svg).toContain('font-size="16"')
  })

  it("includes SceneNode.ai text in SVG", async () => {
    await applyImageWatermark(Buffer.from("test"))
    const compositeCall = mocks.mockComposite.mock.calls[0][0][0]
    const svg = compositeCall.input.toString()
    expect(svg).toContain("SceneNode.ai")
  })
})

describe("applyVideoWatermark", () => {
  it("calls runFfmpeg with drawtext filter", async () => {
    await applyVideoWatermark("/tmp/input.mp4", "/tmp/output.mp4")
    expect(mocks.mockRunFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining([
        "-y",
        "-i", "/tmp/input.mp4",
        "-vf", expect.stringContaining("SceneNode.ai"),
        "/tmp/output.mp4",
      ]),
    )
  })

  it("includes BROWSER_SAFE_VIDEO_ARGS", async () => {
    await applyVideoWatermark("/tmp/input.mp4", "/tmp/output.mp4")
    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args).toContain("-c:v")
    expect(args).toContain("libx264")
  })

  it("includes audio codec args", async () => {
    await applyVideoWatermark("/tmp/input.mp4", "/tmp/output.mp4")
    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args).toContain("-c:a")
    expect(args).toContain("aac")
  })

  it("uses drawtext with correct position and style", async () => {
    await applyVideoWatermark("/tmp/input.mp4", "/tmp/output.mp4")
    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    const vfArg = args[args.indexOf("-vf") + 1]
    expect(vfArg).toContain("fontcolor=white@0.5")
    expect(vfArg).toContain("x=w-tw-20")
    expect(vfArg).toContain("y=h-th-20")
  })
})
