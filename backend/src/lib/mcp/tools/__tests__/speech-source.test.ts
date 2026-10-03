import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ resolveAssetId: vi.fn() }))
vi.mock("../../asset-resolver.js", () => ({ resolveAssetId: mocks.resolveAssetId }))

import { resolveSpeechSourceUrl } from "../_speech-source.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("resolveSpeechSourceUrl", () => {
  it("resolves an audio job on the first attempt", async () => {
    mocks.resolveAssetId.mockResolvedValueOnce("https://cdn.example.com/vo.mp3")
    await expect(resolveSpeechSourceUrl("a1", "u1")).resolves.toBe("https://cdn.example.com/vo.mp3")
    expect(mocks.resolveAssetId).toHaveBeenCalledTimes(1)
    expect(mocks.resolveAssetId).toHaveBeenCalledWith({ assetId: "a1", userId: "u1", expectedKind: "audio" })
  })

  it("falls back to video when the id is not an audio job", async () => {
    mocks.resolveAssetId
      .mockRejectedValueOnce(new Error("expected audio, got job of type image-to-video"))
      .mockResolvedValueOnce("https://cdn.example.com/clip.mp4")
    await expect(resolveSpeechSourceUrl("v1", "u1")).resolves.toBe("https://cdn.example.com/clip.mp4")
    expect(mocks.resolveAssetId).toHaveBeenCalledTimes(2)
    expect(mocks.resolveAssetId).toHaveBeenLastCalledWith({ assetId: "v1", userId: "u1", expectedKind: "video" })
  })

  it("rethrows any other failure without a second attempt", async () => {
    mocks.resolveAssetId.mockRejectedValueOnce(new Error("Asset not found"))
    await expect(resolveSpeechSourceUrl("x1", "u1")).rejects.toThrow("Asset not found")
    expect(mocks.resolveAssetId).toHaveBeenCalledTimes(1)
  })
})
