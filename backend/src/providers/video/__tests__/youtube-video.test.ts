import { describe, it, expect, vi } from "vitest"

vi.mock("node:child_process", () => ({ spawn: vi.fn(), execFile: vi.fn() }))
import { ytMetadataProbe, buildYtDlpVideoArgs, YtUrlNotAllowedError } from "../youtube-video.js"

describe("ytMetadataProbe", () => {
  it("rejects non-YouTube hosts BEFORE spawning", async () => {
    await expect(ytMetadataProbe("https://internal.service/meta")).rejects.toBeInstanceOf(YtUrlNotAllowedError)
    await expect(ytMetadataProbe("https://vimeo.com/123")).rejects.toBeInstanceOf(YtUrlNotAllowedError)
  })
})

describe("buildYtDlpVideoArgs", () => {
  it("carries spoof + mp4 merge + max-filesize", () => {
    const args = buildYtDlpVideoArgs({ url: "https://youtu.be/x", outPath: "/tmp/x.mp4", maxFilesizeBytes: 512 * 1024 * 1024 })
    expect(args).toContain("--extractor-args")
    expect(args.join(" ")).toContain("youtube:player_client=android")
    expect(args.join(" ")).toContain("--max-filesize 512M")
    expect(args.join(" ")).toContain("--merge-output-format mp4")
  })
})
