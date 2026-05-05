import { describe, it, expect } from "vitest"
import { classifyUrl, pathToLabel, extractAssets, extractTextFields } from "../job-asset-view-extractors"

describe("classifyUrl", () => {
  it("classifies mp4 as video", () => {
    expect(classifyUrl("https://r2.foo/x.mp4")).toBe("video")
  })

  it("classifies all video extensions", () => {
    for (const ext of ["mp4", "webm", "mov", "avi"]) {
      expect(classifyUrl(`https://r2.foo/x.${ext}`)).toBe("video")
    }
  })

  it("classifies all image extensions", () => {
    for (const ext of ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "heic", "heif"]) {
      expect(classifyUrl(`https://r2.foo/x.${ext}`)).toBe("image")
    }
  })

  it("classifies all audio extensions", () => {
    for (const ext of ["mp3", "wav", "ogg", "aac", "flac", "m4a"]) {
      expect(classifyUrl(`https://r2.foo/x.${ext}`)).toBe("audio")
    }
  })

  it("classifies presigned R2 URL with query string", () => {
    expect(classifyUrl("https://r2.foo/x.mp4?token=abc&exp=123")).toBe("video")
  })

  it("classifies uppercase extensions correctly", () => {
    expect(classifyUrl("https://r2.foo/X.MP4")).toBe("video")
    expect(classifyUrl("https://r2.foo/X.PNG")).toBe("image")
  })

  it("returns 'other' for unknown extension", () => {
    expect(classifyUrl("https://r2.foo/x.txt")).toBe("other")
  })

  it("returns 'other' for URL with no extension", () => {
    expect(classifyUrl("https://api.example.com/jobs/abc123")).toBe("other")
  })
})

describe("pathToLabel", () => {
  it("returns empty string for empty segments", () => {
    expect(pathToLabel([])).toBe("")
  })

  it("returns single object key as-is", () => {
    expect(pathToLabel(["videoUrl"])).toBe("videoUrl")
  })

  it("joins nested object keys with dots", () => {
    expect(pathToLabel(["assets", "primary", "url"])).toBe("assets.primary.url")
  })

  it("wraps numeric segments in brackets without leading dot", () => {
    expect(pathToLabel(["imageUrls", "2"])).toBe("imageUrls[2]")
  })

  it("handles top-level array index", () => {
    expect(pathToLabel(["0"])).toBe("[0]")
  })

  it("interleaves objects and arrays correctly", () => {
    expect(pathToLabel(["a", "b", "0", "c"])).toBe("a.b[0].c")
  })
})

describe("extractAssets", () => {
  it("returns empty array for null", () => {
    expect(extractAssets(null)).toEqual([])
  })

  it("returns empty array for undefined", () => {
    expect(extractAssets(undefined)).toEqual([])
  })

  it("returns empty array for primitives", () => {
    expect(extractAssets(42)).toEqual([])
    expect(extractAssets(true)).toEqual([])
  })

  it("returns empty array for non-URL string", () => {
    expect(extractAssets("just a label")).toEqual([])
  })

  it("returns empty array for empty object", () => {
    expect(extractAssets({})).toEqual([])
  })

  it("extracts a top-level URL", () => {
    expect(extractAssets({ videoUrl: "https://r2.foo/x.mp4" })).toEqual([
      { path: "videoUrl", url: "https://r2.foo/x.mp4", kind: "video" },
    ])
  })

  it("extracts nested URLs through objects", () => {
    expect(extractAssets({ assets: { primary: { url: "https://r2.foo/x.png" } } })).toEqual([
      { path: "assets.primary.url", url: "https://r2.foo/x.png", kind: "image" },
    ])
  })

  it("extracts URLs from arrays with bracket indices", () => {
    expect(extractAssets({ imageUrls: ["https://r2.foo/a.png", "https://r2.foo/b.png"] })).toEqual([
      { path: "imageUrls[0]", url: "https://r2.foo/a.png", kind: "image" },
      { path: "imageUrls[1]", url: "https://r2.foo/b.png", kind: "image" },
    ])
  })

  it("skips non-URL strings inside an array", () => {
    expect(
      extractAssets({ items: ["https://r2.foo/x.mp4", "not a url", "https://r2.foo/y.mp3"] }),
    ).toEqual([
      { path: "items[0]", url: "https://r2.foo/x.mp4", kind: "video" },
      { path: "items[2]", url: "https://r2.foo/y.mp3", kind: "audio" },
    ])
  })

  it("classifies 'other' for non-media URLs", () => {
    expect(extractAssets({ ref: "https://api.example.com/job/abc" })).toEqual([
      { path: "ref", url: "https://api.example.com/job/abc", kind: "other" },
    ])
  })

  it("handles top-level URL string", () => {
    expect(extractAssets("https://r2.foo/x.mp4")).toEqual([
      { path: "", url: "https://r2.foo/x.mp4", kind: "video" },
    ])
  })

  it("matches https case-insensitively", () => {
    expect(extractAssets({ url: "HTTPS://r2.foo/x.png" })).toEqual([
      { path: "url", url: "HTTPS://r2.foo/x.png", kind: "image" },
    ])
  })

  it("ignores null and missing values inside the tree", () => {
    expect(extractAssets({ a: null, b: undefined, c: "https://r2.foo/x.mp4" })).toEqual([
      { path: "c", url: "https://r2.foo/x.mp4", kind: "video" },
    ])
  })
})

describe("extractTextFields", () => {
  it("returns empty array for empty object", () => {
    expect(extractTextFields({})).toEqual([])
  })

  it("extracts each known field when present and non-empty", () => {
    expect(
      extractTextFields({
        prompt: "make a cat",
        generatedText: "the cat sat",
        text: "alt",
        result: "ok",
        error: "boom",
      }),
    ).toEqual([
      { label: "prompt", value: "make a cat" },
      { label: "generatedText", value: "the cat sat" },
      { label: "text", value: "alt" },
      { label: "result", value: "ok" },
      { label: "error", value: "boom" },
    ])
  })

  it("preserves the order defined by TEXT_FIELDS, not by object insertion order", () => {
    const result = extractTextFields({
      error: "x",
      prompt: "y",
    })
    expect(result.map((r) => r.label)).toEqual(["prompt", "error"])
  })

  it("skips fields whose value is whitespace-only", () => {
    expect(extractTextFields({ prompt: "   \n\t  " })).toEqual([])
  })

  it("skips fields whose value is the empty string", () => {
    expect(extractTextFields({ prompt: "" })).toEqual([])
  })

  it("skips 'result' when it is not a string", () => {
    expect(extractTextFields({ result: { nested: "obj" } as unknown as string })).toEqual([])
  })

  it("skips fields whose value is missing", () => {
    expect(extractTextFields({ prompt: "hello" })).toEqual([
      { label: "prompt", value: "hello" },
    ])
  })

  it("ignores fields not in TEXT_FIELDS", () => {
    expect(extractTextFields({ name: "alice", customField: "value" } as Record<string, unknown>)).toEqual([])
  })
})
