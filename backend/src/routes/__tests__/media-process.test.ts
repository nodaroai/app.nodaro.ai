import { describe, expect, it } from "vitest"
import { safeMediaExt } from "../media-process"

describe("safeMediaExt (path-traversal guard for /v1/media/process)", () => {
  it("returns the real extension for normal media URLs", () => {
    expect(safeMediaExt("https://cdn.x/clip.mp4", "mp4")).toBe("mp4")
    expect(safeMediaExt("https://cdn.x/song.mp3?token=abc", "mp3")).toBe("mp3")
    expect(safeMediaExt("https://cdn.x/a.WEBM", "mp4")).toBe("webm") // case-normalized
    expect(safeMediaExt("https://cdn.x/voice.m4a", "mp3")).toBe("m4a")
  })

  it("clamps unknown or malicious extensions to the fallback (never shapes a path)", () => {
    const attacks = [
      "https://e.com/x.mp4/../../../../etc/passwd",
      "https://e.com/a." + "../".repeat(10) + "etc/passwd",
      "https://e.com/x./etc/passwd",
      "https://e.com/file", // no extension at all
      "https://e.com/x.mov", // real container, but not an allowed output format
      "https://e.com/report.pdf",
    ]
    for (const url of attacks) {
      const ext = safeMediaExt(url, "mp4")
      expect(ext).toBe("mp4")
      // The returned extension can NEVER contain a path separator or dot segment.
      expect(ext).not.toMatch(/[/\\.]/)
    }
  })
})
