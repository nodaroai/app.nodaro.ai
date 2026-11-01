// @test-watches backend/src/services/face-detect/__tests__/fixtures/rt4k-540p2-gop.mp4 backend/src/services/face-detect/__tests__/fixtures/rt4k-540p2-gop.ort-dets.json
/**
 * `detectFacesInImage` — YuNet over ONE still picture, with the real session
 * and the pinned model (as `detect-faces.parity.test.ts`), the download mocked.
 *
 * The picture is frame 0 of the parity fixture (four seated people, 960 × 540),
 * written losslessly by ffmpeg at test time, so its pixels are ffmpeg's own
 * conversion and the detections can be compared with the measured reference
 * at the operating point (0.7, boxes within 2e-3 of the frame).
 *
 * Footage: "Round Table - 10 Years On - The stars of 2014-15 reminisce on
 * HISTORIC promotion season", AFCB TV, Wikimedia Commons, CC BY 3.0.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const fx = vi.hoisted(() => ({
  /** What the mocked guarded download answers, by URL. */
  files: new Map<string, Buffer>(),
  fetched: [] as Array<{ url: string; maxBytes: number }>,
  slots: [] as Array<{ timeoutMs: number; peakMemoryMiB?: number; label?: string }>,
}))

vi.mock("../../../lib/safe-fetch-bytes.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/safe-fetch-bytes.js")>()
  return {
    ...real,
    safeFetchBytes: async (url: string, maxBytes: number) => {
      fx.fetched.push({ url, maxBytes })
      const file = fx.files.get(url)
      if (!file) throw new Error("Image download failed")
      if (file.length > maxBytes) throw new real.PublicDownloadTooLargeError("Image download exceeds the size limit")
      return file
    },
  }
})

vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  withFfmpegSlot: async (fn: () => Promise<unknown>, opts: { timeoutMs: number; peakMemoryMiB?: number; label?: string }) => {
    fx.slots.push(opts)
    return fn()
  },
}))

import {
  detectFacesInImage,
  FACE_DETECT_IMAGE_MAX_BYTES,
  FACE_DETECT_IMAGE_MAX_SIDE,
} from "../detect-faces-image.js"
import { FaceDetectRequestError } from "../detect-faces.js"
import { yunetSession, releaseYunetSession } from "../yunet-session.js"
import { YUNET_DETECTOR } from "../yunet-model.js"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIP = join(HERE, "fixtures", "rt4k-540p2-gop.mp4")
const REF = JSON.parse(readFileSync(join(HERE, "fixtures", "rt4k-540p2-gop.ort-dets.json"), "utf8")) as {
  width: number
  height: number
  frames: Array<Array<{ box: [number, number, number, number]; score: number }>>
}
const BOX_TOL = 2e-3
const MIN_SCORE = 0.7

/** Frame 0's reference faces at 0.7, top-left boxes, left to right. */
const EXPECTED = REF.frames[0]!
  .filter((d) => d.score >= MIN_SCORE)
  .map(({ box: [cx, cy, w, h] }) => ({ x: cx - w / 2, y: cy - h / 2, w, h }))
  .sort((a, b) => a.x - b.x)

/** Frame 0 of the fixture as a lossless PNG (ffmpeg's yuv → rgb). */
let framePng: Buffer

beforeAll(async () => {
  framePng = execFileSync("ffmpeg", [
    "-nostdin", "-v", "error", "-i", CLIP, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
  ], { maxBuffer: 32 * 1024 * 1024 })
  await yunetSession()
})
afterAll(async () => {
  await releaseYunetSession()
})
beforeEach(() => {
  fx.files.clear()
  fx.fetched.length = 0
  fx.slots.length = 0
})

const leftToRight = <T extends { x: number }>(boxes: readonly T[]) => [...boxes].sort((a, b) => a.x - b.x)

describe("detectFacesInImage", () => {
  it("detectFacesInImage finds the fixture face and returns fractions", async () => {
    const url = "https://cdn.example.com/people.png"
    fx.files.set(url, framePng)
    const out = await detectFacesInImage({ imageUrl: url, minScore: MIN_SCORE })

    expect(out.detector).toEqual(YUNET_DETECTOR)
    expect(out.frame).toEqual({ w: REF.width, h: REF.height })
    expect(EXPECTED.length).toBeGreaterThan(0)
    expect(out.boxes).toHaveLength(EXPECTED.length)
    const got = leftToRight(out.boxes)
    for (const [i, want] of EXPECTED.entries()) {
      const box = got[i]!
      for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(box[k] - want[k])).toBeLessThan(BOX_TOL)
      expect(box.score).toBeGreaterThanOrEqual(MIN_SCORE)
      expect(box.landmarks).toHaveLength(5)
      for (const [lx, ly] of box.landmarks) {
        // Each landmark lies on its face, as a fraction of the picture.
        expect(lx).toBeGreaterThan(box.x - box.w * 0.1)
        expect(lx).toBeLessThan(box.x + box.w * 1.1)
        expect(ly).toBeGreaterThan(box.y - box.h * 0.1)
        expect(ly).toBeLessThan(box.y + box.h * 1.1)
      }
    }
    // Downloaded once through the guarded fetch, under its size cap.
    expect(fx.fetched).toEqual([{ url, maxBytes: FACE_DETECT_IMAGE_MAX_BYTES }])
    // Decode and inference under ONE admission hold, the detector's label.
    expect(fx.slots).toHaveLength(1)
    expect(fx.slots[0]!.label).toBe("face-detect")
    expect(fx.slots[0]!.peakMemoryMiB).toBeGreaterThan(0)
  })

  it("an EXIF-rotated picture gives the upright frame size and boxes", async () => {
    // Stored turned a quarter left (540 × 960), its orientation tag saying to
    // turn it a quarter right to show it: upright, it is the fixture frame.
    const stored = await sharp(framePng).rotate(270).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer()
    const meta = await sharp(stored).metadata()
    expect({ w: meta.width, h: meta.height, orientation: meta.orientation }).toEqual({ w: REF.height, h: REF.width, orientation: 6 })

    const url = "https://cdn.example.com/turned.jpg"
    fx.files.set(url, stored)
    const out = await detectFacesInImage({ imageUrl: url, minScore: MIN_SCORE })

    expect(out.frame).toEqual({ w: REF.width, h: REF.height })
    expect(out.boxes).toHaveLength(EXPECTED.length)
    // Upright: the seated people side by side across the picture, as in the
    // reference — not stacked down it, as they are in the stored pixels.
    const got = leftToRight(out.boxes)
    for (const [i, want] of EXPECTED.entries()) {
      for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(got[i]![k] - want[k])).toBeLessThan(1e-2)
    }
  })

  it("a picture larger than the detection size is detected smaller, its frame and fractions the whole picture's", async () => {
    const big = await sharp(framePng).resize(REF.width * 3, REF.height * 3, { kernel: "lanczos3" }).png().toBuffer()
    const url = "https://cdn.example.com/big.png"
    fx.files.set(url, big)
    const out = await detectFacesInImage({ imageUrl: url, minScore: MIN_SCORE })
    expect(out.frame).toEqual({ w: REF.width * 3, h: REF.height * 3 })
    expect(Math.max(REF.width, REF.height)).toBeLessThanOrEqual(FACE_DETECT_IMAGE_MAX_SIDE)
    expect(out.boxes).toHaveLength(EXPECTED.length)
    const got = leftToRight(out.boxes)
    for (const [i, want] of EXPECTED.entries()) {
      for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(got[i]![k] - want[k])).toBeLessThan(1e-2)
    }
  })

  it("a greyscale, a 16-bit and a transparent picture decode to the same faces", async () => {
    const variants = {
      grey: await sharp(framePng).greyscale().png().toBuffer(),
      deep: await sharp(framePng).toColourspace("rgb16").png().toBuffer(),
      alpha: await sharp(framePng).ensureAlpha(1).png().toBuffer(),
    }
    expect((await sharp(variants.deep).metadata()).depth).toBe("ushort")
    for (const [name, file] of Object.entries(variants)) {
      const url = `https://cdn.example.com/${name}.png`
      fx.files.set(url, file)
      const out = await detectFacesInImage({ imageUrl: url, minScore: 0.5 })
      expect(out.frame, name).toEqual({ w: REF.width, h: REF.height })
      expect(out.boxes.length, name).toBeGreaterThan(0)
    }
  })

  it("it refuses a non-https url", async () => {
    for (const imageUrl of ["http://cdn.example.com/people.png", "file:///etc/passwd", "data:image/png;base64,AAAA", "not a url", ""]) {
      fx.files.set(imageUrl, framePng)
      await expect(detectFacesInImage({ imageUrl, minScore: MIN_SCORE })).rejects.toBeInstanceOf(FaceDetectRequestError)
    }
    expect(fx.fetched).toEqual([])
    expect(fx.slots).toEqual([])
  })

  it("refuses a score floor outside (0, 1] before downloading", async () => {
    const url = "https://cdn.example.com/people.png"
    fx.files.set(url, framePng)
    for (const minScore of [0, -0.1, 1.5, Number.NaN, "0.7" as unknown as number]) {
      await expect(detectFacesInImage({ imageUrl: url, minScore })).rejects.toBeInstanceOf(FaceDetectRequestError)
    }
    expect(fx.fetched).toEqual([])
  })

  it("refuses a file that is not a picture, and an svg, deterministically", async () => {
    const text = "https://cdn.example.com/notes.txt"
    fx.files.set(text, Buffer.from("hello, these are not pixels"))
    await expect(detectFacesInImage({ imageUrl: text, minScore: MIN_SCORE })).rejects.toBeInstanceOf(FaceDetectRequestError)
    const svg = "https://cdn.example.com/drawing.svg"
    fx.files.set(svg, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'))
    await expect(detectFacesInImage({ imageUrl: svg, minScore: MIN_SCORE })).rejects.toBeInstanceOf(FaceDetectRequestError)
    expect(fx.slots).toEqual([])
  })

  it("refuses a picture past the download cap deterministically", async () => {
    const url = "https://cdn.example.com/huge.png"
    fx.files.set(url, Buffer.alloc(FACE_DETECT_IMAGE_MAX_BYTES + 1))
    await expect(detectFacesInImage({ imageUrl: url, minScore: MIN_SCORE })).rejects.toBeInstanceOf(FaceDetectRequestError)
  })

  it("keeps only faces at or above the score floor", async () => {
    const url = "https://cdn.example.com/people.png"
    fx.files.set(url, framePng)
    const out = await detectFacesInImage({ imageUrl: url, minScore: 0.999 })
    for (const b of out.boxes) expect(b.score).toBeGreaterThanOrEqual(0.999)
    expect(out.boxes.length).toBeLessThan(EXPECTED.length)
  })
})
