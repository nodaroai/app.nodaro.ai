import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }))
vi.mock("../client.js", async (orig) => ({ ...(await orig<object>()), runReplicatePrediction: mockRun }))

import { replicateVideoDepth } from "../video-depth.js"

beforeEach(() => {
  mockRun.mockReset()
  mockRun.mockResolvedValue({ output: "https://replicate.delivery/d.mp4", cost: 0.01, predictionId: "p1" })
})

describe("replicateVideoDepth", () => {
  it("pins the version, maps size → encoder, drops every fal-only lever", async () => {
    const reconcileOpts = { onTaskCreated: vi.fn() }
    const out = await replicateVideoDepth(
      "depth-anything-frames",
      "https://x/v.mp4",
      { modelSize: "base", colormap: "turbo", resolution: "720p", sideBySide: true },
      reconcileOpts,
    )
    const arg = mockRun.mock.calls[0][0]
    expect(arg.version).toBe("9143691405afc64c7952499a1e81e3f779535a8916c8da7154a9995f145d5e6d")
    expect(arg.input).toEqual({ video: "https://x/v.mp4", encoder: "vitb" })
    expect(arg.reconcileOpts).toBe(reconcileOpts)
    expect(arg.costModelKey).toBe("depth-anything-frames")
    // No nodaro.ai relay serves video-depth: a keyless run must not be told the connection covers it.
    expect(arg.keyCoverage).toEqual({ coveredByConnection: false })
    expect(out).toEqual({ videoUrl: "https://replicate.delivery/d.mp4", cost: 0.01 })
  })

  it("never forwards colormap, even the Replicate-supported values (the worker applies it)", async () => {
    await replicateVideoDepth("depth-anything-frames", "https://x/v.mp4", { colormap: "grayscale" })
    expect(mockRun.mock.calls[0][0].input).toEqual({ video: "https://x/v.mp4", encoder: "vitl" })
  })

  it("accepts a 1-element array output", async () => {
    mockRun.mockResolvedValue({ output: ["https://replicate.delivery/a.mp4"], cost: null, predictionId: "p2" })
    expect((await replicateVideoDepth("depth-anything-frames", "https://x/v.mp4", {})).videoUrl).toBe(
      "https://replicate.delivery/a.mp4",
    )
  })

  it("defaults to the large encoder", async () => {
    await replicateVideoDepth("depth-anything-frames", "https://x/v.mp4", {})
    expect(mockRun.mock.calls[0][0].input).toEqual({ video: "https://x/v.mp4", encoder: "vitl" })
  })
})
