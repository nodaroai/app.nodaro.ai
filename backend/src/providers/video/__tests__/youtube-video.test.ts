import { describe, it, expect, vi } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

vi.mock("node:child_process", () => ({ spawn: vi.fn(), execFile: vi.fn() }))
import {
  ytMetadataProbe,
  buildYtDlpVideoArgs,
  resolveYtDlpBin,
  YtUrlNotAllowedError,
} from "../youtube-video.js"

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

/**
 * The regression these pin: the image sets `YOUTUBE_DL_SKIP_DOWNLOAD=1`, so the
 * bundled binary is never fetched — yet the code spawned it anyway, and every
 * social-video path died with `spawn .../bin/yt-dlp ENOENT`, silently. The image
 * now ships the real binary and points YOUTUBE_DL_DIR at it; resolution must
 * prefer that, and must never hand `spawn` a path it already knows is absent.
 */
describe("resolveYtDlpBin", () => {
  it("prefers YOUTUBE_DL_DIR — the env `youtube-dl-exec` itself reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "ytdlp-"))
    const bin = join(dir, "yt-dlp")
    writeFileSync(bin, "#!/bin/sh\n")
    expect(resolveYtDlpBin({ YOUTUBE_DL_DIR: dir } as NodeJS.ProcessEnv)).toBe(bin)
  })

  it("ignores YOUTUBE_DL_DIR when no binary is actually there", () => {
    const empty = mkdtempSync(join(tmpdir(), "ytdlp-empty-"))
    // Must NOT return the non-existent env path — that is precisely the ENOENT bug.
    expect(resolveYtDlpBin({ YOUTUBE_DL_DIR: empty } as NodeJS.ProcessEnv)).not.toBe(
      join(empty, "yt-dlp"),
    )
  })

  it("falls back to a bare PATH lookup rather than a path known to be absent", () => {
    // No env dir, and (in CI) no postinstalled bundle → must degrade to "yt-dlp"
    // so the OS resolves it, instead of spawning a guaranteed-missing path.
    const resolved = resolveYtDlpBin({} as NodeJS.ProcessEnv)
    expect(resolved === "yt-dlp" || resolved.endsWith("/bin/yt-dlp")).toBe(true)
  })
})
