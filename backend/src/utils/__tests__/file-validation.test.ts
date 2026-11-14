import { describe, it, expect } from "vitest"
import { validateFile, detectCategory, getExtensionFromMime, getSizeLimit, resolveUploadMime, acceptedTypesSentence } from "../file-validation.js"

describe("detectCategory", () => {
  it("detects image types", () => {
    expect(detectCategory("image/png")).toBe("image")
    expect(detectCategory("image/jpeg")).toBe("image")
    expect(detectCategory("image/webp")).toBe("image")
    expect(detectCategory("image/gif")).toBe("image")
    expect(detectCategory("image/avif")).toBe("image")
    expect(detectCategory("image/heic")).toBe("image")
    expect(detectCategory("image/heif")).toBe("image")
  })

  it("detects video types", () => {
    expect(detectCategory("video/mp4")).toBe("video")
    expect(detectCategory("video/webm")).toBe("video")
    expect(detectCategory("video/quicktime")).toBe("video")
  })

  it("detects audio types", () => {
    expect(detectCategory("audio/mpeg")).toBe("audio")
    expect(detectCategory("audio/wav")).toBe("audio")
    expect(detectCategory("audio/ogg")).toBe("audio")
    expect(detectCategory("audio/flac")).toBe("audio")
    expect(detectCategory("audio/x-flac")).toBe("audio")
  })

  it("detects data types", () => {
    expect(detectCategory("application/json")).toBe("data")
  })

  it("returns null for unknown types", () => {
    expect(detectCategory("text/html")).toBeNull()
  })
})

describe("getExtensionFromMime", () => {
  it("maps common types to extensions", () => {
    expect(getExtensionFromMime("image/png")).toBe("png")
    expect(getExtensionFromMime("image/jpeg")).toBe("jpg")
    expect(getExtensionFromMime("image/avif")).toBe("avif")
    expect(getExtensionFromMime("image/heic")).toBe("heic")
    expect(getExtensionFromMime("video/mp4")).toBe("mp4")
    expect(getExtensionFromMime("audio/mpeg")).toBe("mp3")
    expect(getExtensionFromMime("audio/flac")).toBe("flac")
    expect(getExtensionFromMime("audio/x-flac")).toBe("flac")
    expect(getExtensionFromMime("video/quicktime")).toBe("mov")
  })

  it("returns bin for unknown types", () => {
    expect(getExtensionFromMime("application/octet-stream")).toBe("bin")
  })
})

describe("getSizeLimit", () => {
  it("returns 25MB for images", () => {
    expect(getSizeLimit("image")).toBe(25 * 1024 * 1024)
  })

  it("returns 500MB for videos", () => {
    expect(getSizeLimit("video")).toBe(500 * 1024 * 1024)
  })

  it("returns 50MB for audio", () => {
    expect(getSizeLimit("audio")).toBe(50 * 1024 * 1024)
  })
})

describe("validateFile", () => {
  it("accepts valid image files", () => {
    const result = validateFile("image/png", 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("image")
  })

  it("accepts valid video files", () => {
    const result = validateFile("video/mp4", 50 * 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("video")
  })

  it("accepts valid audio files", () => {
    const result = validateFile("audio/mpeg", 5 * 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("audio")
  })

  it("accepts valid FLAC audio files at 50MB limit", () => {
    const result = validateFile("audio/flac", 50 * 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("audio")
  })

  it("accepts valid x-flac audio files under 50MB", () => {
    const result = validateFile("audio/x-flac", 30 * 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("audio")
  })

  it("accepts data files (JSON)", () => {
    const result = validateFile("application/json", 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("data")
  })

  it("rejects unsupported MIME types", () => {
    const result = validateFile("text/html", 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Unsupported file type")
  })

  it("rejects images exceeding 25MB", () => {
    const result = validateFile("image/png", 30 * 1024 * 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("File too large")
    expect(result.category).toBe("image")
  })

  it("rejects videos exceeding 500MB", () => {
    const result = validateFile("video/mp4", 600 * 1024 * 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("File too large")
  })

  it("rejects audio exceeding 50MB", () => {
    const result = validateFile("audio/wav", 60 * 1024 * 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("File too large")
  })
})

// ---------------------------------------------------------------------------
// resolveUploadMime
// ---------------------------------------------------------------------------

/**
 * Production app_reports rows this closes (2026-09-03 and 2026-09-15):
 *   Unsupported file type: audio/vnd.dlna.adts
 *   Unsupported file type: application/octet-stream
 * Both from first-party clients, and the first one names a format the very
 * same message advertises as accepted ("audio (… aac …)").
 */
describe("resolveUploadMime", () => {
  it("leaves a canonical type alone", () => {
    expect(resolveUploadMime("image/png", "a.png")).toBe("image/png")
    expect(resolveUploadMime("audio/aac", "a.aac")).toBe("audio/aac")
  })

  it("resolves a vendor alias to the canonical type", () => {
    // Windows' registry type for a plain .aac file
    expect(resolveUploadMime("audio/vnd.dlna.adts", "voice.aac")).toBe("audio/aac")
    expect(resolveUploadMime("image/jpg", "p.jpg")).toBe("image/jpeg")
    expect(resolveUploadMime("video/mov", "c.mov")).toBe("video/quicktime")
    expect(resolveUploadMime("audio/x-pn-wav", "s.wav")).toBe("audio/wav")
  })

  it("strips MIME parameters (MediaRecorder sends codecs=…)", () => {
    expect(resolveUploadMime("audio/webm;codecs=opus", "rec.weba")).toBe("audio/webm")
    expect(resolveUploadMime("video/webm; codecs=vp9", "c.webm")).toBe("video/webm")
  })

  it("falls back to the filename when the declared type says nothing", () => {
    expect(resolveUploadMime("application/octet-stream", "clip.mp4")).toBe("video/mp4")
    expect(resolveUploadMime("application/octet-stream", "Song.MP3")).toBe("audio/mpeg")
    expect(resolveUploadMime("", "shot.heic")).toBe("image/heic")
    expect(resolveUploadMime("binary/octet-stream", "track.m4a")).toBe("audio/mp4")
  })

  it("does NOT let the filename override an informative declared type", () => {
    // A real declared type wins: only uninformative ones consult the name.
    expect(resolveUploadMime("text/html", "evil.mp4")).toBe("text/html")
  })

  it("returns an unresolvable type unchanged, so the caller still rejects it", () => {
    expect(resolveUploadMime("application/octet-stream", "notes.xyz")).toBe("application/octet-stream")
    expect(resolveUploadMime("application/octet-stream", null)).toBe("application/octet-stream")
    expect(resolveUploadMime("application/x-msdownload", "setup.exe")).toBe("application/x-msdownload")
  })
})

describe("validateFile — resolution", () => {
  it("accepts a Windows .aac upload and reports the canonical type", () => {
    const result = validateFile("audio/vnd.dlna.adts", 1024, "voice.aac")
    expect(result.valid).toBe(true)
    expect(result.category).toBe("audio")
    expect(result.mimeType).toBe("audio/aac")
  })

  it("accepts an octet-stream upload resolved by its extension", () => {
    const result = validateFile("application/octet-stream", 1024, "clip.mp4")
    expect(result.valid).toBe(true)
    expect(result.category).toBe("video")
    expect(result.mimeType).toBe("video/mp4")
  })

  it("still rejects an octet-stream upload with no usable extension", () => {
    const result = validateFile("application/octet-stream", 1024, "notes.xyz")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Unsupported file type: application/octet-stream")
  })

  it("sizes a resolved file by its RESOLVED category", () => {
    // 100 MB: over the 50 MB audio limit, under the 500 MB video one.
    expect(validateFile("application/octet-stream", 100 * 1024 * 1024, "clip.mp4").valid).toBe(true)
    expect(validateFile("audio/vnd.dlna.adts", 100 * 1024 * 1024, "voice.aac").valid).toBe(false)
  })

  it("keeps working with no filename at all (every pre-existing caller)", () => {
    expect(validateFile("image/png", 1024).valid).toBe(true)
    expect(validateFile("text/html", 1024).valid).toBe(false)
  })
})

describe("acceptedTypesSentence", () => {
  it("is derived from the allow-table, so it cannot drift from it", () => {
    const sentence = acceptedTypesSentence()
    // The hand-written copy this replaced omitted all three of these.
    expect(sentence).toContain("flac")
    expect(sentence).toContain("weba")
    expect(sentence).toContain("json")
    expect(sentence).toContain("aac")
    expect(sentence).toMatch(/^Accepted types: images \(/)
  })

  it("is what an unsupported-type rejection quotes", () => {
    expect(validateFile("text/html", 1).error).toContain(acceptedTypesSentence())
  })
})

// Documents an LLM reads (decided 2026-11-13): PDF only, stored as a `document`.
describe("documents", () => {
  it("accepts a PDF as a document, by its type, an alias or its extension", () => {
    expect(validateFile("application/pdf", 1000)).toMatchObject({ valid: true, category: "document", mimeType: "application/pdf" })
    expect(validateFile("application/x-pdf", 1000)).toMatchObject({ valid: true, category: "document", mimeType: "application/pdf" })
    expect(validateFile("application/octet-stream", 1000, "report.PDF")).toMatchObject({ valid: true, category: "document" })
    expect(detectCategory("application/pdf")).toBe("document")
    expect(getExtensionFromMime("application/pdf")).toBe("pdf")
  })

  it("caps a document at 25 MB and still refuses other document types", () => {
    expect(getSizeLimit("document")).toBe(25 * 1024 * 1024)
    expect(validateFile("application/pdf", 25 * 1024 * 1024 + 1).valid).toBe(false)
    expect(validateFile("text/plain", 10).valid).toBe(false)
    expect(validateFile("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 10).valid).toBe(false)
    expect(acceptedTypesSentence()).toContain("documents (pdf)")
  })
})
