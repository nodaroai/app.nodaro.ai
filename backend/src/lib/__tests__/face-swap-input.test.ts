import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  probeClipLengthSec: vi.fn(),
  baseCreditCostFor: vi.fn(async (_id: string) => 119),
  hasCredits: vi.fn(() => true),
}))

vi.mock("../video-utility-probe.js", () => ({ probeClipLengthSec: m.probeClipLengthSec }))
vi.mock("../credit-base-cost.js", () => ({ baseCreditCostFor: m.baseCreditCostFor }))
vi.mock("../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../config.js")>()), hasCredits: m.hasCredits }))

import {
  FACE_SWAP_CREDIT_ID,
  FACE_SWAP_UNREADABLE_MESSAGE,
  faceSwapSettle,
  readFaceSwapInput,
  stampFaceSwapInput,
} from "../face-swap-input.js"

beforeEach(() => {
  vi.clearAllMocks()
  m.probeClipLengthSec.mockResolvedValue(12)
  m.hasCredits.mockReturnValue(true)
})

describe("Face Swap's target video", () => {
  it("is read before anything is held, its container's length", async () => {
    await expect(readFaceSwapInput("https://cdn.example/clip.mp4")).resolves.toEqual({ ok: true, clipSec: 12 })
    expect(m.probeClipLengthSec).toHaveBeenCalledWith("https://cdn.example/clip.mp4", expect.objectContaining({ reading: "container" }))
  })

  it("up to 60 seconds runs, a hair past it forgiven; past that it is refused", async () => {
    m.probeClipLengthSec.mockResolvedValueOnce(60.04)
    await expect(readFaceSwapInput("https://cdn.example/clip.mp4")).resolves.toMatchObject({ ok: true })
    m.probeClipLengthSec.mockResolvedValueOnce(61)
    await expect(readFaceSwapInput("https://cdn.example/clip.mp4")).resolves.toEqual({
      ok: false,
      code: "video_too_long",
      message: "The video is 61 seconds long. Face Swap takes videos up to 60 seconds: trim it first.",
    })
  })

  it("a video whose length cannot be read is refused, never priced on a guess", async () => {
    m.probeClipLengthSec.mockRejectedValueOnce(new Error("Invalid data found when processing input"))
    await expect(readFaceSwapInput("https://cdn.example/clip.mp4")).resolves.toEqual({
      ok: false,
      code: "video_unreadable",
      message: FACE_SWAP_UNREADABLE_MESSAGE,
    })
    m.probeClipLengthSec.mockResolvedValueOnce(0)
    await expect(readFaceSwapInput("https://cdn.example/clip.mp4")).resolves.toMatchObject({ ok: false, code: "video_unreadable" })
  })

  it("the workflow run stamps what the route reads, and refuses what the route refuses", async () => {
    const payload: Record<string, unknown> = { videoUrl: "https://cdn.example/clip.mp4", faceSwapVideoSec: 1 }
    await expect(stampFaceSwapInput("face-swap", payload)).resolves.toBeUndefined()
    expect(payload.faceSwapVideoSec).toBe(12)

    m.probeClipLengthSec.mockResolvedValueOnce(90)
    const long: Record<string, unknown> = { videoUrl: "https://cdn.example/clip.mp4" }
    await expect(stampFaceSwapInput("face-swap", long)).resolves.toMatchObject({ code: "video_too_long" })

    // A link the route's own schema refuses is never read.
    const local: Record<string, unknown> = { videoUrl: "/etc/passwd" }
    await expect(stampFaceSwapInput("face-swap", local)).resolves.toMatchObject({ code: "video_unreadable" })
    expect(m.probeClipLengthSec).toHaveBeenCalledTimes(2)
  })

  it("leaves every other job alone", async () => {
    const payload: Record<string, unknown> = { videoUrl: "https://cdn.example/clip.mp4" }
    await expect(stampFaceSwapInput("lip-sync", payload)).resolves.toBeUndefined()
    expect(m.probeClipLengthSec).not.toHaveBeenCalled()
  })
})

describe("how a finished Face Swap run is charged", () => {
  it("within its row, the hold is committed as it is (the least a run is charged)", async () => {
    // $0.05 is 25 credits of provider cost, within the 119 row.
    await expect(faceSwapSettle(0.05)).resolves.toEqual({})
    // $0.238 is 119 credits: exactly the row, still within it.
    await expect(faceSwapSettle(0.238)).resolves.toEqual({})
    expect(m.baseCreditCostFor).toHaveBeenCalledWith(FACE_SWAP_CREDIT_ID)
  })

  it("past its row, what the run cost is charged, collected above the hold", async () => {
    await expect(faceSwapSettle(0.42)).resolves.toEqual({ meteredCost: true, collectOverHold: true })
  })

  it("the row is read live: an administrator's retune moves where the run's cost takes over", async () => {
    m.baseCreditCostFor.mockResolvedValueOnce(300)
    await expect(faceSwapSettle(0.42)).resolves.toEqual({})
  })

  it("no cost, or credits off: nothing to settle", async () => {
    await expect(faceSwapSettle(null)).resolves.toEqual({})
    await expect(faceSwapSettle(0)).resolves.toEqual({})
    m.hasCredits.mockReturnValue(false)
    await expect(faceSwapSettle(5)).resolves.toEqual({})
  })
})
