/**
 * Where a card's picture is drawn from (card-image/sources.ts): our own files
 * from the bucket by key (never the CDN), another host's through the public
 * download checks; a video with no poster gives a frame of our own copy only;
 * every failure reads as "no picture".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const calls = vi.hoisted(() => ({ bucket: [] as string[], fetched: [] as string[], downloaded: [] as string[], failFetch: false }))

vi.mock("../../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../config.js")>()
  return { ...actual, config: { ...actual.config, R2_PUBLIC_URL: "https://cdn.example" } }
})
vi.mock("../../../storage.js", () => ({
  readR2Object: async (key: string) => {
    calls.bucket.push(key)
    return { body: Buffer.from(`bytes of ${key}`), contentType: "image/png", size: 10 }
  },
  downloadR2ObjectToFile: async (key: string) => {
    calls.downloaded.push(key)
  },
}))
vi.mock("../../../safe-fetch-bytes.js", () => ({
  safeFetchBytes: async (url: string) => {
    calls.fetched.push(url)
    if (calls.failFetch) throw new Error("refused")
    return Buffer.from(`bytes of ${url}`)
  },
}))
vi.mock("../../../../utils/thumbnail.js", () => ({ thumbnailFromLocalVideo: async () => Buffer.from("frame") }))

import { loadImage, loadPicture, loadVideoFrame } from "../sources.js"

beforeEach(() => {
  calls.bucket.length = 0
  calls.fetched.length = 0
  calls.downloaded.length = 0
  calls.failFetch = false
})

describe("card picture sources", () => {
  it("reads our own file from the bucket by its key, another host's through the public download checks", async () => {
    expect(String(await loadImage("https://cdn.example/images/a.png"))).toBe("bytes of images/a.png")
    expect(calls.bucket).toEqual(["images/a.png"])
    expect(String(await loadImage("https://art.provider.example/c.jpeg"))).toBe("bytes of https://art.provider.example/c.jpeg")
    expect(calls.fetched).toEqual(["https://art.provider.example/c.jpeg"])
  })

  it("a failed download is no picture", async () => {
    calls.failFetch = true
    await expect(loadImage("https://art.provider.example/c.jpeg")).resolves.toBeNull()
    await expect(loadImage(null)).resolves.toBeNull()
  })

  it("takes a frame only from our own copy of a video", async () => {
    await expect(loadVideoFrame("https://elsewhere.example/v.mp4")).resolves.toBeNull()
    expect(calls.downloaded).toEqual([])
    expect(String(await loadVideoFrame("https://cdn.example/videos/v.mp4"))).toBe("frame")
    expect(calls.downloaded).toEqual(["videos/v.mp4"])
  })

  it("a video's poster first; a grid at most four pictures", async () => {
    const video = await loadPicture({ kind: "video", poster: "https://cdn.example/images/p.jpg", video: "https://cdn.example/videos/v.mp4" })
    expect(video).toMatchObject({ kind: "video" })
    expect(calls.downloaded).toEqual([])
    const grid = await loadPicture({ kind: "grid", sources: ["a", "b", "c", "d", "e"].map((x) => `https://cdn.example/images/${x}.png`) })
    expect(grid.kind === "grid" && grid.images.length).toBe(4)
  })
})
