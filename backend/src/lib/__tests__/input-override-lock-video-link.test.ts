/**
 * The Video URL node is an outbound fetcher (`DENIED_NODE_TYPES`) — and also an
 * app input. A run request may set exactly the link (and the file the runner's
 * own download made for it), and only to a value the node itself would
 * download; every other destination-shaped field on it stays locked.
 */
import { describe, expect, it } from "vitest"
import {
  assertNoLockedOverrides as assertLocked,
  describeLockedOverrides,
  findLockedOverrides as findLocked,
  type VideoLinkAdmission,
} from "../input-override-lock.js"

/** The app exposes the Video URL node `yt-1` as an input (`exposedVideoLinkNodeIds`). */
const EXPOSED: VideoLinkAdmission = new Set(["yt-1"])
const findLockedOverrides = (nodes: Parameters<typeof findLocked>[0], overrides: Parameters<typeof findLocked>[1]) =>
  findLocked(nodes, overrides, EXPOSED)
const assertNoLockedOverrides = (nodes: Parameters<typeof assertLocked>[0], overrides: Parameters<typeof assertLocked>[1]) =>
  assertLocked(nodes, overrides, EXPOSED)

const GRAPH = [
  { id: "yt-1", type: "youtube-video" },
  { id: "hook-1", type: "webhook-output" },
  { id: "up-1", type: "upload-video" },
]

describe("a run request's link for a Video URL node", () => {
  // Decided 2026-10-08: the canvas node's own rule — a supported post link, or any other
  // public web link (passed through as it is), each behind the SSRF guard.
  it("admits a supported social link and any other public web link", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.tiktok.com/@a/video/7234567890123456789",
      "https://cdn.example.com/episodes/ep-12.mp4",
      "https://cdn.example.com/stream/ep-12",
      "https://example.com/page",
      "https://www.netflix.com/watch/1",
    ]) {
      expect(findLockedOverrides(GRAPH, { "yt-1": { youtubeUrl: link } }), link).toEqual([])
    }
  })

  it("admits the file the runner's own download made, and the link it was made for", () => {
    expect(
      findLockedOverrides(GRAPH, {
        "yt-1": {
          youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
          downloadedVideoUrl: "https://cdn.example.com/downloads/abc.mp4",
          downloadedFromUrl: "https://youtu.be/dQw4w9WgXcQ",
        },
      }),
    ).toEqual([])
  })

  it("refuses a value that is not a web link, as a `video-link` refusal", () => {
    for (const link of ["hello", "ftp://x.test/a.mp4", "//cdn.example.com/a.mp4", "https://tiktok.com\\@10.0.0.1/x"]) {
      expect(findLockedOverrides(GRAPH, { "yt-1": { youtubeUrl: link } }), link).toEqual([
        { nodeId: "yt-1", nodeType: "youtube-video", field: "youtubeUrl", kind: "video-link" },
      ])
    }
  })

  it("refuses a blanked or non-string link (a blanked destination is a re-pointed one)", () => {
    for (const value of ["", "   ", null, 42, { href: "https://youtu.be/dQw4w9WgXcQ" }, ["https://youtu.be/dQw4w9WgXcQ"]]) {
      expect(findLockedOverrides(GRAPH, { "yt-1": { youtubeUrl: value } }), JSON.stringify(value)).toEqual([
        { nodeId: "yt-1", nodeType: "youtube-video", field: "youtubeUrl", kind: "video-link" },
      ])
    }
  })

  it("keeps the server's SSRF guard on top of the link rule", () => {
    for (const link of ["http://169.254.169.254/latest/a.mp4", "http://localhost:8080/a.mp4", "http://10.0.0.5/a.mp4"]) {
      expect(findLockedOverrides(GRAPH, { "yt-1": { youtubeUrl: link } }), link).toHaveLength(1)
      expect(findLockedOverrides(GRAPH, { "yt-1": { downloadedVideoUrl: link } }), link).toHaveLength(1)
    }
  })

  it("a downloaded file must be a safe public url; the link it came from must be a video link", () => {
    expect(findLockedOverrides(GRAPH, { "yt-1": { downloadedVideoUrl: "not a url" } })).toHaveLength(1)
    expect(findLockedOverrides(GRAPH, { "yt-1": { downloadedFromUrl: "hello" } })).toEqual([
      { nodeId: "yt-1", nodeType: "youtube-video", field: "downloadedFromUrl", kind: "video-link" },
    ])
  })

  it("every OTHER destination-shaped field of the node stays locked", () => {
    for (const field of ["downloadedAudioUrl", "thumbnailUrl", "downloadedThumbnailUrl", "someOtherUrl", "channel", "target"]) {
      expect(findLockedOverrides(GRAPH, { "yt-1": { [field]: "https://attacker.example/x.mp4" } }), field).toEqual([
        { nodeId: "yt-1", nodeType: "youtube-video", field, kind: "outbound" },
      ])
    }
  })

  it("a valid link does not unlock a locked field sent beside it", () => {
    expect(
      findLockedOverrides(GRAPH, {
        "yt-1": { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", downloadedAudioUrl: "https://attacker.example/a.mp3" },
      }),
    ).toEqual([{ nodeId: "yt-1", nodeType: "youtube-video", field: "downloadedAudioUrl", kind: "outbound" }])
  })

  it("ordinary fields on the node stay overridable", () => {
    expect(findLockedOverrides(GRAPH, { "yt-1": { label: "Episode", sectionStartSec: 0, sectionEndSec: 60 } })).toEqual([])
  })

  it("the carve-out is the Video URL node's alone: another outbound node still refuses `youtubeUrl`-shaped keys", () => {
    expect(findLockedOverrides(GRAPH, { "hook-1": { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" } })).toEqual([
      { nodeId: "hook-1", nodeType: "webhook-output", field: "youtubeUrl", kind: "outbound" },
    ])
    expect(findLockedOverrides(GRAPH, { "hook-1": { url: "https://youtu.be/dQw4w9WgXcQ" } })).toHaveLength(1)
  })

  it("names the rule in the message, and the merge throws on it", () => {
    const locked = findLockedOverrides(GRAPH, { "yt-1": { youtubeUrl: "hello" } })
    const message = describeLockedOverrides(locked)
    expect(message).toContain("youtubeUrl")
    expect(message).toMatch(/YouTube/)
    expect(message).toMatch(/public web link/)
    expect(message).not.toMatch(/\.mp4/)
    expect(() => assertNoLockedOverrides(GRAPH, { "yt-1": { youtubeUrl: "hello" } })).toThrow(/youtubeUrl/)
    expect(() => assertNoLockedOverrides(GRAPH, { "yt-1": { youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" } })).not.toThrow()
  })
})

// Review round (decided 2026-10-07): the carve-out belongs to a Video URL node the
// app EXPOSES as an input. A creator's fixed reference video (analysed, dubbed)
// can not be swapped for a stranger's link, exposed neighbour or not.
describe("a Video URL node the app does not expose", () => {
  const TWO = [...GRAPH, { id: "yt-2", type: "youtube-video" }]
  const fields = ["youtubeUrl", "downloadedFromUrl", "downloadedVideoUrl"] as const
  const LINK = "https://youtu.be/dQw4w9WgXcQ"

  it("keeps every field locked, the link included", () => {
    for (const field of fields) {
      expect(findLocked(TWO, { "yt-2": { [field]: LINK } }, EXPOSED), field).toEqual([
        { nodeId: "yt-2", nodeType: "youtube-video", field, kind: "outbound" },
      ])
    }
  })

  it("is refused whatever the exposed neighbour admits, and by the merge's assertion too", () => {
    expect(findLocked(TWO, { "yt-1": { youtubeUrl: LINK }, "yt-2": { youtubeUrl: LINK } }, EXPOSED)).toEqual([
      { nodeId: "yt-2", nodeType: "youtube-video", field: "youtubeUrl", kind: "outbound" },
    ])
    expect(() => assertLocked(TWO, { "yt-2": { youtubeUrl: LINK } }, EXPOSED)).toThrow(/youtubeUrl/)
  })

  it("fails closed: a caller that passes no set admits no Video URL link", () => {
    expect(findLocked(TWO, { "yt-1": { youtubeUrl: LINK } })).toHaveLength(1)
    expect(() => assertLocked(TWO, { "yt-1": { youtubeUrl: LINK } })).toThrow()
  })

  it("an owner's lane admits all of them", () => {
    expect(findLocked(TWO, { "yt-2": { youtubeUrl: LINK } }, "all")).toEqual([])
    expect(findLocked(TWO, { "yt-2": { youtubeUrl: "hello" } }, "all")).toEqual([
      { nodeId: "yt-2", nodeType: "youtube-video", field: "youtubeUrl", kind: "video-link" },
    ])
  })
})
