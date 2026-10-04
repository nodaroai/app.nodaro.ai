import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * A Social Search wired into Video Analysis's `video` input: a post that came
 * with its own video file is analyzed from that file (never from its page,
 * which for Instagram gives no length); a post without one, by its page link;
 * a post whose file link has expired is flagged so the run refuses it by
 * name. The editor's connection validator allows this wire (posts output
 * only, starting in Each mode); this pins the server-side half so the two
 * engines cannot drift.
 */
function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}
function edge(source: string, target: string, sourceHandle: string, targetHandle: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle }
}

const post = (n: number) => ({
  id: `reddit:${n}`,
  platform: "reddit",
  url: `https://www.reddit.com/r/videography/comments/${n}/`,
  text: `post ${n}`,
  author: { handle: "a", name: "A" },
  metrics: {},
  media: { kind: "text" },
  hashtags: [],
  extra: {},
})

/** An Instagram reel whose signed video link ends at `endMs` (Meta's `oe`, hex seconds). */
const reel = (endMs: number) => ({
  ...post(9),
  id: "instagram:9",
  platform: "instagram",
  url: "https://www.instagram.com/reel/Dav9/",
  media: {
    kind: "video",
    videoUrl: `https://scontent-sjc6-1.cdninstagram.com/o1/v/t2/clip.mp4?oh=00_sig&oe=${Math.floor(endMs / 1000).toString(16)}`,
    durationSec: 27,
  },
})

describe("backend input-resolver — Social Search posts → Video Analysis", () => {
  const search = node("search", "social-search", { platform: "reddit", mode: "community", query: "r/videography" })
  const va = node("va", "video-analysis")
  const states = (json: unknown[]): Record<string, NodeExecutionState> => ({ search: { status: "completed", output: { json, text: "digest" } } })

  it("takes a video post's page link when no file came with it (the first of the list on a plain wire), marked as a post's page", () => {
    const tiktok = (n: number) => ({ ...post(n), id: `tiktok:${n}`, platform: "tiktok", url: `https://www.tiktok.com/@a/video/${n}`, media: { kind: "video" } })
    const r = resolveNodeInputs(va, [edge("search", "va", "json", "video")], states([tiktok(1), tiktok(2)]), [search, va])
    expect(r.videoPageUrl).toBe("https://www.tiktok.com/@a/video/1")
    expect(r.videoPageFromSocialPost).toBe(true)
    expect(r.prompt).toBeUndefined()
    expect(r.videoUrl).toBeUndefined()
  })

  it("flags an image or a text post as having no video, and hands over nothing else", () => {
    const r = resolveNodeInputs(va, [edge("search", "va", "json", "video")], states([post(1)]), [search, va])
    expect(r.socialPostNoVideo).toBe(true)
    expect(r.videoPageUrl).toBeUndefined()
    expect(r.videoUrl).toBeUndefined()
  })

  it("takes the post's own video file while its link is valid, marked as a post's file", () => {
    const live = reel(Date.now() + 2 * 24 * 3_600_000)
    const r = resolveNodeInputs(va, [edge("search", "va", "json", "video")], states([live]), [search, va])
    expect(r.videoUrl).toBe(live.media.videoUrl)
    expect(r.videoFromSocialPost).toBe(true)
    expect(r.videoPageUrl).toBeUndefined()
    // Its length is read from the file before the reserve, never taken from the post.
    expect(r.videoDuration).toBeUndefined()
  })

  it("flags a post whose video link has expired, and reads nothing else from it", () => {
    const r = resolveNodeInputs(va, [edge("search", "va", "json", "video")], states([reel(Date.now() - 60_000)]), [search, va])
    expect(r.socialPostVideoExpired).toBe(true)
    expect(r.videoUrl).toBeUndefined()
    expect(r.videoPageUrl).toBeUndefined()
  })

  it("the digest brings no link, and a Social Search into any other node is still text", () => {
    const fromDigest = resolveNodeInputs(va, [edge("search", "va", "text", "video")], states([post(1)]), [search, va])
    expect(fromDigest.videoPageUrl).toBeUndefined()

    const llm = node("llm", "llm-chat", { userInput: "" })
    const toLlm = resolveNodeInputs(llm, [edge("search", "llm", "json", "prompt")], states([post(1)]), [search, llm])
    expect(toLlm.prompt).toBe(JSON.stringify([post(1)]))
  })
})
