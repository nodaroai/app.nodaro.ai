/**
 * The face photo a Face Swap run sends. Two runs with a 1536x2048 PNG face
 * failed inside the swap model (2026-11-22); the same face cropped and saved as
 * JPEG swapped fine. Real images through real sharp; only the download and the
 * scratch upload are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

const mocks = vi.hoisted(() => ({
  fetchOwnMedia: vi.fn(),
  uploadJobScratchBuffer: vi.fn(async (_b: Buffer, _n: string, _e: string, _c: string, _j?: string) => "https://r2.example/tmp/provider-input/job-1/face-swap-face-x.jpg"),
}))
vi.mock("../fetch-own-media.js", () => ({ fetchOwnMedia: mocks.fetchOwnMedia }))
vi.mock("../job-scratch.js", () => ({ uploadJobScratchBuffer: mocks.uploadJobScratchBuffer }))

import {
  FACE_SWAP_FACE_MAX_READ_BYTES,
  FACE_SWAP_FACE_MAX_SIDE,
  faceSwapFaceImage,
} from "../face-swap-face-image.js"

const URL_ = "https://cdn.example/face.png"

function served(bytes: Buffer, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers })
}

async function image(
  width: number,
  height: number,
  format: "png" | "jpeg",
  opts: { alpha?: boolean; orientation?: number } = {},
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: opts.alpha ? 4 : 3, background: opts.alpha ? { r: 200, g: 100, b: 50, alpha: 0.5 } : { r: 200, g: 100, b: 50 } },
  })
  const encoded = format === "png" ? base.png() : base.jpeg()
  return opts.orientation ? encoded.withMetadata({ orientation: opts.orientation }).toBuffer() : encoded.toBuffer()
}

/** The bytes uploaded to the scratch folder by the last call. */
function uploaded(): Buffer {
  return mocks.uploadJobScratchBuffer.mock.calls.at(-1)![0]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("faceSwapFaceImage", () => {
  it("the failing shape: a 1536x2048 PNG is sent as a JPEG fitted inside the limit, keeping its proportions", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(await image(1536, 2048, "png")))
    const url = await faceSwapFaceImage(URL_, "job-1")

    expect(url).toBe("https://r2.example/tmp/provider-input/job-1/face-swap-face-x.jpg")
    expect(mocks.uploadJobScratchBuffer).toHaveBeenCalledWith(expect.any(Buffer), "face-swap-face", "jpg", "image/jpeg", "job-1")
    const meta = await sharp(uploaded()).metadata()
    expect(meta.format).toBe("jpeg")
    expect(meta.height).toBe(FACE_SWAP_FACE_MAX_SIDE)
    expect(meta.width).toBe(960)
  })

  it("a JPEG within the limit is sent as it is, nothing uploaded", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(await image(1236, 1236, "jpeg")))
    expect(await faceSwapFaceImage(URL_, "job-1")).toBe(URL_)
    expect(mocks.uploadJobScratchBuffer).not.toHaveBeenCalled()
  })

  it("a small PNG is sent as a JPEG at its own size, never enlarged", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(await image(600, 800, "png")))
    await faceSwapFaceImage(URL_, "job-1")
    const meta = await sharp(uploaded()).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 600, 800])
  })

  it("a transparent photo is laid on white: the JPEG has no transparency", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(await image(400, 400, "png", { alpha: true })))
    await faceSwapFaceImage(URL_, "job-1")
    const meta = await sharp(uploaded()).metadata()
    expect(meta.hasAlpha).toBe(false)
  })

  it("a phone photo with a rotation flag is turned upright", async () => {
    // Stored 800 wide, 600 tall, flagged to be shown turned a quarter (orientation 6): upright it is 600x800.
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(await image(800, 600, "jpeg", { orientation: 6 })))
    await faceSwapFaceImage(URL_, "job-1")
    const meta = await sharp(uploaded()).metadata()
    expect([meta.width, meta.height]).toEqual([600, 800])
    expect(meta.orientation ?? 1).toBe(1)
  })

  it("a photo that cannot be downloaded is sent as it is", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await faceSwapFaceImage(URL_, "job-1")).toBe(URL_)
  })

  it("a file that is not an image is sent as it is (the run goes on as before)", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(Buffer.from("not an image")))
    expect(await faceSwapFaceImage(URL_, "job-1")).toBe(URL_)
    expect(mocks.uploadJobScratchBuffer).not.toHaveBeenCalled()
  })

  it("a photo declared over the read limit is not downloaded and is sent as it is", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(Buffer.alloc(16), { "content-length": String(FACE_SWAP_FACE_MAX_READ_BYTES + 1) }))
    expect(await faceSwapFaceImage(URL_, "job-1")).toBe(URL_)
  })

  it("a failed scratch upload sends the photo as it is", async () => {
    mocks.fetchOwnMedia.mockResolvedValueOnce(served(await image(1536, 2048, "png")))
    mocks.uploadJobScratchBuffer.mockRejectedValueOnce(new Error("R2 down"))
    expect(await faceSwapFaceImage(URL_, "job-1")).toBe(URL_)
  })
})
