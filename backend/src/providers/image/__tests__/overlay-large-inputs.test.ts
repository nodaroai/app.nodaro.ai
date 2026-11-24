// @test-always builds its pictures in memory; the work dir is the run's own
/**
 * An 8K model result (Kling Image 4.0: 10880 x 6144 at 16:9, about 67 MP) is
 * over Image Overlay's 8192 px edge and 8192² pixel caps: as a base or as a
 * layer it is scaled down to fit them, never refused.
 */
import { describe, it, expect, vi } from "vitest"
import { writeFile } from "node:fs/promises"
import sharp from "sharp"

const files = vi.hoisted(() => new Map<string, Buffer>())
vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../video/ffmpeg-utils.js")>()),
  downloadFile: async (url: string, dest: string) => {
    await writeFile(dest, files.get(url)!)
  },
  withFfmpegSlot: async <T,>(fn: () => Promise<T>) => fn(),
}))

import { createImageOverlay } from "../overlay.js"
import { prefitVideoOverlayLayer } from "../../video/video-overlay-prefit.js"
import { OVERLAY_PIXEL_LIMIT } from "../overlay-contract.js"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#4a7" } }).jpeg({ quality: 60 }).toBuffer()

describe("pictures over the overlay caps are scaled down, not refused", () => {
  it("an 8K base and a layer past 8192² render, the base fitted within 8192 px", async () => {
    files.set("https://cdn.example.com/base-8k.jpg", await solid(10880, 6144))
    files.set("https://cdn.example.com/layer-big.jpg", await solid(9000, 9000))
    expect(9000 * 9000).toBeGreaterThan(OVERLAY_PIXEL_LIMIT)
    const out = await createImageOverlay({
      imageUrl: "https://cdn.example.com/base-8k.jpg",
      layers: [{ imageUrl: "https://cdn.example.com/layer-big.jpg", x: 0.1, y: 0.1, width: 0.2 } as never],
    })
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(8192)
    expect(out.width * out.height).toBeLessThanOrEqual(OVERLAY_PIXEL_LIMIT)
    expect(out.width / out.height).toBeCloseTo(10880 / 6144, 2)
  }, 120_000)

  it("a video overlay layer past 8192² is prefitted, not refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prefit-"))
    const src = join(dir, "layer.jpg")
    await writeFile(src, await solid(9000, 9000))
    const out = await prefitVideoOverlayLayer(src, join(dir, "out.png"), { width: 640, height: 640 }, "contain")
    expect(out).toEqual({ width: 640, height: 640 })
  }, 120_000)
})
