/**
 * The run path for a Video URL app input: whatever the runner sends becomes
 * the node's output, and nothing the creator's published node held for ITS
 * link survives under the runner's.
 */
import { describe, it, expect } from "vitest"
import { resolveVideoLinkOutput } from "@nodaro/shared"
import { applyInputOverridesToNodes as applyOverrides } from "../apply-input-overrides.js"
import { extractSourceNodeOutput } from "../../services/workflow-engine/output-extractor.js"
import { LockedOverrideError } from "../../lib/input-override-lock.js"

/** The app exposes the node `ep` as an input. */
const applyInputOverridesToNodes = (nodes: Parameters<typeof applyOverrides>[0], overrides: Parameters<typeof applyOverrides>[1]) =>
  applyOverrides(nodes, overrides, new Set(["ep"]))

const CREATOR_LINK = "https://youtu.be/AAAAAAAAAAA"

const published = () => [
  {
    id: "ep",
    type: "youtube-video",
    data: {
      label: "Episode",
      youtubeUrl: CREATOR_LINK,
      videoId: "AAAAAAAAAAA",
      title: "Creator sample",
      downloadedVideoUrl: "https://cdn.example.com/creator-sample.mp4",
      downloadedFromUrl: CREATOR_LINK,
      downloadedAudioUrl: "https://cdn.example.com/creator-sample.mp3",
      videoDurationSec: 60,
      generatedVideoUrl: "https://cdn.example.com/stale-result.mp4",
    } as Record<string, unknown>,
  },
]

describe("a Video URL node overridden by an app run", () => {
  it("emits the runner's direct file link, not the creator's downloaded sample", () => {
    const nodes = published()
    applyInputOverridesToNodes(nodes, { ep: { youtubeUrl: "https://cdn.example.com/runner-episode.mp4" } })
    const data = nodes[0]!.data
    expect(resolveVideoLinkOutput(data)).toBe("https://cdn.example.com/runner-episode.mp4")
    expect(extractSourceNodeOutput(nodes[0] as never)).toEqual({ videoUrl: "https://cdn.example.com/runner-episode.mp4" })
    // Nothing of the creator's link rides along to the nodes that read the audio track or the length.
    expect(data.downloadedAudioUrl).toBeUndefined()
    expect(data.videoDurationSec).toBeUndefined()
    expect(data.title).toBeUndefined()
    expect(data.generatedVideoUrl).toBeUndefined()
    expect(data.label).toBe("Episode")
  })

  it("emits the file the runner's card downloaded for ITS link", () => {
    const nodes = published()
    const link = "https://youtu.be/BBBBBBBBBBB"
    applyInputOverridesToNodes(nodes, {
      ep: { youtubeUrl: link, downloadedVideoUrl: "https://cdn.example.com/runner-download.mp4", downloadedFromUrl: link },
    })
    expect(extractSourceNodeOutput(nodes[0] as never)).toEqual({ videoUrl: "https://cdn.example.com/runner-download.mp4" })
    expect(nodes[0]!.data.downloadedAudioUrl).toBeUndefined()
  })

  it("a social link with no file of its own never falls back to the creator's file (no file bound to it)", () => {
    const nodes = published()
    // The old node shape: a file with no `downloadedFromUrl` binding is trusted — so the merge must have dropped it.
    delete nodes[0]!.data.downloadedFromUrl
    applyInputOverridesToNodes(nodes, { ep: { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" } })
    expect(extractSourceNodeOutput(nodes[0] as never)).toEqual({ videoUrl: "https://youtu.be/BBBBBBBBBBB" })
  })

  it("re-sending the creator's own link changes nothing", () => {
    const nodes = published()
    applyInputOverridesToNodes(nodes, { ep: { youtubeUrl: CREATOR_LINK } })
    expect(extractSourceNodeOutput(nodes[0] as never)).toEqual({ videoUrl: "https://cdn.example.com/creator-sample.mp4" })
    expect(nodes[0]!.data.downloadedAudioUrl).toBe("https://cdn.example.com/creator-sample.mp3")
  })

  it("refuses a link the node would not download, before touching the graph", () => {
    const nodes = published()
    expect(() => applyInputOverridesToNodes(nodes, { ep: { youtubeUrl: "not a link" } })).toThrow(LockedOverrideError)
    expect(nodes[0]!.data.youtubeUrl).toBe(CREATOR_LINK)
  })
})

describe("a Video URL node the app does not expose", () => {
  it("refuses the caller's link and leaves the creator's node as published", () => {
    const nodes = published()
    const before = JSON.stringify(nodes)
    expect(() => applyOverrides(nodes, { ep: { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" } }, new Set())).toThrow(LockedOverrideError)
    expect(() => applyOverrides(nodes, { ep: { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" } })).toThrow(LockedOverrideError)
    expect(JSON.stringify(nodes)).toBe(before)
  })
  it("a live-workflow run (the owner's) passes `all`", () => {
    const nodes = published()
    applyOverrides(nodes, { ep: { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" } }, "all")
    expect(nodes[0]!.data.youtubeUrl).toBe("https://youtu.be/BBBBBBBBBBB")
  })
})
