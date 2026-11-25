/**
 * A thumbnail's source video is fetched through the shared downloader
 * (`downloadFile`), not a bare fetch buffered into memory: the 60 s is then
 * one hard total that ends the body too (a body that stalls or trickles stops
 * at it), and a refusal leaves no temp folder behind.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as fs } from "node:fs"
import { dirname } from "node:path"

const downloadFile = vi.hoisted(() => vi.fn())
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ downloadFile }))

const { generateThumbnailFromUrl } = await import("../thumbnail.js")

beforeEach(() => { downloadFile.mockReset() })

describe("generateThumbnailFromUrl's download", () => {
  it("goes through downloadFile into its own work folder, under a 60 s hard total", async () => {
    downloadFile.mockImplementation(async () => { throw new Error("Download timeout: over its 60 s limit: https://cdn.example/v.mp4") })
    await expect(generateThumbnailFromUrl("https://cdn.example/v.mp4")).rejects.toThrow("over its 60 s limit")
    expect(downloadFile).toHaveBeenCalledOnce()
    const [url, dest, opts] = downloadFile.mock.calls[0]!
    expect(url).toBe("https://cdn.example/v.mp4")
    expect(dest).toMatch(/thumb-gen-[^/]+\/input\.mp4$/)
    expect(opts).toEqual({ timeoutMs: 60_000 })
    // The work folder goes with the failure.
    await expect(fs.stat(dirname(dest as string))).rejects.toMatchObject({ code: "ENOENT" })
  })
})
