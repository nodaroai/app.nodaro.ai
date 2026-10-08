import { describe, it, expect } from "vitest"
import { INPUT_FIELD_MAP as COMPONENT_FIELD_MAP, getInputFieldSchema } from "../index.js"
import { INPUT_FIELD_MAP, INPUT_NODE_TYPES, mergeNodeInputOverrides, getInputNodes } from "../presentation-utils.js"
import {
  VIDEO_LINK_DERIVED_FIELDS,
  DIRECT_VIDEO_EXTENSIONS,
  isDirectVideoFileUrl,
  videoLinkInputProblem,
} from "../video-link.js"

describe("the Video URL node as an app input", () => {
  it("is an input node type, written through its `youtubeUrl` field", () => {
    expect(INPUT_NODE_TYPES.has("youtube-video")).toBe(true)
    expect(INPUT_FIELD_MAP["youtube-video"]).toEqual({ key: "youtubeUrl", type: "video-url" })
    expect(getInputFieldSchema("youtube-video")).toEqual({ key: "youtubeUrl", type: "video-url" })
    // …and a component can take one as an input handle on the same field.
    expect(COMPONENT_FIELD_MAP["youtube-video"]).toBe("youtubeUrl")
  })

  it("a curated Video URL node is listed as an input (not only by the legacy flag)", () => {
    const node = { id: "n1", type: "youtube-video", data: { presentationInput: true } }
    expect(getInputNodes([node])).toHaveLength(1)
    const legacy = { id: "n2", type: "youtube-video", data: { presentationVisible: true } }
    expect(getInputNodes([legacy])).toHaveLength(1)
  })
})

describe("videoLinkInputProblem — the one URL rule the card, the route and the lock share", () => {
  it("accepts a supported social link and any other http(s) link — the canvas node's own rule (decided 2026-10-08)", () => {
    for (const ok of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.tiktok.com/@a/video/7234567890123456789",
      "https://www.instagram.com/reel/Cabc123/",
      "https://x.com/a/status/123456",
      "https://cdn.example.com/episodes/ep-12.mp4",
      "https://cdn.example.com/episodes/EP.MOV?sig=abc",
      // No video extension: the canvas node passes any non-post link through, so the input does too.
      "https://cdn.example.com/stream/ep-12",
      "https://example.com/page",
      "https://www.netflix.com/watch/1", // not a supported post host: passed through as it is, like the canvas
      "http://cdn.example.com/a.mp4.exe",
    ]) {
      expect(videoLinkInputProblem(ok), ok).toBeNull()
    }
  })

  it("surrounding spaces are not a problem (the card trims before it sends)", () => {
    expect(videoLinkInputProblem("  https://youtu.be/dQw4w9WgXcQ  ")).toBeNull()
  })

  it("names an empty value", () => {
    expect(videoLinkInputProblem("")).toBe("empty")
    expect(videoLinkInputProblem("   ")).toBe("empty")
    expect(videoLinkInputProblem(undefined)).toBe("empty")
    expect(videoLinkInputProblem(null)).toBe("empty")
  })

  it("refuses everything else as `invalid`", () => {
    for (const bad of [
      "hello",
      "ftp://cdn.example.com/a.mp4",
      "javascript:alert(1)",
      "//cdn.example.com/a.mp4", // no scheme
      "mailto:a@example.com",
      "https://tiktok.com\\@10.0.0.1/x", // parser differential
      "https://example.com/a\n.mp4",
    ]) {
      expect(videoLinkInputProblem(bad), bad).toBe("invalid")
    }
    expect(videoLinkInputProblem(42 as unknown)).toBe("invalid")
    expect(videoLinkInputProblem({ href: "https://youtu.be/x" } as unknown)).toBe("invalid")
  })

  it("an over-long value is invalid, not parsed", () => {
    expect(videoLinkInputProblem(`https://cdn.example.com/${"a".repeat(3000)}.mp4`)).toBe("invalid")
  })
})

describe("isDirectVideoFileUrl (lifted to shared so the card and the route cannot drift)", () => {
  it("reads the path's extension only", () => {
    expect(DIRECT_VIDEO_EXTENSIONS).toEqual([".mp4", ".webm", ".mov", ".avi"])
    expect(isDirectVideoFileUrl("https://cdn.example/CLIP.MP4")).toBe(true)
    expect(isDirectVideoFileUrl("https://cdn.example/page?file=a.mp4")).toBe(false)
  })
})

describe("merging a new link over a saved Video URL node", () => {
  const saved = {
    label: "Episode",
    youtubeUrl: "https://youtu.be/AAAAAAAAAAA",
    videoId: "AAAAAAAAAAA",
    title: "Creator's sample",
    thumbnailUrl: "https://img/creator.jpg",
    downloadedVideoUrl: "https://cdn/creator-sample.mp4",
    downloadedFromUrl: "https://youtu.be/AAAAAAAAAAA",
    downloadedAudioUrl: "https://cdn/creator-sample.mp3",
    downloadedSection: { startSec: 0, endSec: 60 },
    videoDurationSec: 60,
    needsRangeChoice: false,
    metadata: { durationSeconds: 60 },
  }

  it("drops everything that belonged to the previous link", () => {
    const merged = mergeNodeInputOverrides("youtube-video", saved, { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" })
    expect(merged.youtubeUrl).toBe("https://youtu.be/BBBBBBBBBBB")
    for (const key of VIDEO_LINK_DERIVED_FIELDS) expect(key in merged, `${key} outlived its link`).toBe(false)
    // …and nothing the creator authored.
    expect(merged.label).toBe("Episode")
  })

  it("a stale audio track can never reach Transcribe / Suno Cover under the caller's link", () => {
    const merged = mergeNodeInputOverrides("youtube-video", saved, { youtubeUrl: "https://cdn.example.com/ep.mp4" })
    expect(merged.downloadedAudioUrl).toBeUndefined()
    expect(merged.videoDurationSec).toBeUndefined()
  })

  it("keeps what the SAME override brings for the new link (the runner's own download)", () => {
    const merged = mergeNodeInputOverrides("youtube-video", saved, {
      youtubeUrl: "https://youtu.be/BBBBBBBBBBB",
      downloadedVideoUrl: "https://cdn/runner-episode.mp4",
      downloadedFromUrl: "https://youtu.be/BBBBBBBBBBB",
    })
    expect(merged.downloadedVideoUrl).toBe("https://cdn/runner-episode.mp4")
    expect(merged.downloadedFromUrl).toBe("https://youtu.be/BBBBBBBBBBB")
    expect(merged.downloadedAudioUrl).toBeUndefined()
  })

  it("keeps the saved state when the link is re-sent unchanged or not sent at all", () => {
    const same = mergeNodeInputOverrides("youtube-video", saved, { youtubeUrl: saved.youtubeUrl })
    expect(same.downloadedAudioUrl).toBe("https://cdn/creator-sample.mp3")
    expect(same.metadata).toEqual({ durationSeconds: 60 })
    const none = mergeNodeInputOverrides("youtube-video", saved, { label: "Renamed" })
    expect(none.downloadedVideoUrl).toBe("https://cdn/creator-sample.mp4")
  })

  it("does not touch the saved data (a new object each time)", () => {
    const copy = { ...saved }
    mergeNodeInputOverrides("youtube-video", copy, { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" })
    expect(copy).toEqual(saved)
  })

  it("only the Video URL node drops link-bound state", () => {
    const merged = mergeNodeInputOverrides("upload-video", { url: "a", title: "keep", downloadedAudioUrl: "keep" }, { url: "b" })
    expect(merged.title).toBe("keep")
    expect(merged.downloadedAudioUrl).toBe("keep")
  })
})
