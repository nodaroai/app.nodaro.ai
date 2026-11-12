/**
 * A video added from the Library records the result row a fresh upload
 * records for its file — its url and, when the server measured it at upload,
 * its length — so it is quoted and charged at the length an upload's is. An
 * asset whose length the server did not measure records none (the estimates
 * stay at their fallback). Audio and image assets are mapped exactly as before.
 */
import { describe, it, expect } from "vitest"
import type { LibraryAsset } from "@/lib/api"
import { assetToUploadNode } from "@/lib/asset-to-node"

const asset = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  id: "asset-1",
  type: "video",
  filename: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1234,
  url: "https://cdn.example/asset.mp4",
  thumbnailUrl: "https://cdn.example/asset.jpg",
  metadata: { width: 1920, height: 1080, durationSeconds: 10.01, codec: "h264" },
  isLibraryItem: true,
  uploadSource: "manual_upload",
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
})

describe("assetToUploadNode", () => {
  it("a video asset with a measured length records the upload's result row for its file, active", () => {
    const node = assetToUploadNode(asset())!
    expect(node.type).toBe("upload-video")
    expect(node.data).toEqual({
      r2Url: "https://cdn.example/asset.mp4",
      url: "https://cdn.example/asset.mp4",
      thumbnailUrl: "https://cdn.example/asset.jpg",
      filename: "clip.mp4",
      fileSize: 1234,
      mimeType: "video/mp4",
      metadata: { width: 1920, height: 1080, durationSeconds: 10.01, codec: "h264" },
      assetId: "asset-1",
      generatedResults: [{
        url: "https://cdn.example/asset.mp4",
        thumbnailUrl: "https://cdn.example/asset.jpg",
        jobId: expect.stringMatching(/^upload-\d+$/),
        timestamp: expect.any(String),
        width: 1920,
        height: 1080,
        duration: 10.01,
      }],
      activeResultIndex: 0,
    })
  })

  it("a file the media editor processed (measured by the server) records its length too", () => {
    const rows = assetToUploadNode(asset({ uploadSource: "media_process" }))!.data.generatedResults as Array<Record<string, unknown>>
    expect(rows[0]!.duration).toBe(10.01)
  })

  it.each(["generated", "url_import", "social_download", "job", ""])(
    "an asset from %j records no length, whatever its metadata says (the server did not measure it)",
    (uploadSource) => {
      // A video saved through POST /v1/library/save-generated stores its caller's metadata as sent.
      const rows = assetToUploadNode(asset({ uploadSource, metadata: { durationSeconds: 1 } }))!.data.generatedResults as Array<Record<string, unknown>>
      expect(rows).toHaveLength(1)
      expect(rows[0]!.url).toBe("https://cdn.example/asset.mp4")
      expect(rows[0]).not.toHaveProperty("duration")
    },
  )

  it.each([
    ["no durationSeconds (a generated video's asset)", { thumbnail_url: "https://cdn.example/t.jpg" }],
    ["a durationSeconds of 0 (a probe that read nothing)", { width: 640, height: 360, durationSeconds: 0 }],
    ["a durationSeconds that is not a number", { durationSeconds: "12" }],
  ])("a video asset with %s records no length", (_name, metadata) => {
    const rows = assetToUploadNode(asset({ metadata }))!.data.generatedResults as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.url).toBe("https://cdn.example/asset.mp4")
    expect(rows[0]).not.toHaveProperty("duration")
  })

  it("a video asset without a poster records none (as an upload without one does)", () => {
    const rows = assetToUploadNode(asset({ thumbnailUrl: null }))!.data.generatedResults as Array<Record<string, unknown>>
    expect(rows[0]!.thumbnailUrl).toBeUndefined()
  })

  it("audio and image assets are mapped exactly as before: no result row", () => {
    const audio = assetToUploadNode(asset({ type: "audio", mimeType: "audio/mpeg", metadata: { durationSeconds: 42 } }))!
    expect(audio.type).toBe("upload-audio")
    expect(audio.data).toEqual({
      r2Url: "https://cdn.example/asset.mp4",
      url: "https://cdn.example/asset.mp4",
      thumbnailUrl: "https://cdn.example/asset.jpg",
      filename: "clip.mp4",
      fileSize: 1234,
      mimeType: "audio/mpeg",
      metadata: { durationSeconds: 42 },
      assetId: "asset-1",
    })
    const image = assetToUploadNode(asset({ type: "image", mimeType: "image/png", metadata: { width: 10, height: 10 } }))!
    expect(image.type).toBe("upload-image")
    expect(image.data).not.toHaveProperty("generatedResults")
    expect(image.data).not.toHaveProperty("activeResultIndex")
  })

  it("a non-media asset is not added", () => {
    expect(assetToUploadNode(asset({ type: "document" as LibraryAsset["type"] }))).toBeNull()
  })
})
