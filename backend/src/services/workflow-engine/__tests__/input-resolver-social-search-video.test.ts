import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * A Social Search wired into Video Analysis's `video` input: its posts are
 * analyzed by their page links, read like the node's own link field. The
 * editor's connection validator allows this wire (posts output only, starting
 * in Each mode); this pins the server-side half so the two cannot drift.
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

describe("backend input-resolver — Social Search posts → Video Analysis", () => {
  const search = node("search", "social-search", { platform: "reddit", mode: "community", query: "r/videography" })
  const va = node("va", "video-analysis")

  it("takes the post's page link, not a prompt (the first of the list on a plain wire)", () => {
    const states: Record<string, NodeExecutionState> = { search: { status: "completed", output: { json: [post(1), post(2)], text: "digest" } } }
    const r = resolveNodeInputs(va, [edge("search", "va", "json", "video")], states, [search, va])
    expect(r.videoPageUrl).toBe("https://www.reddit.com/r/videography/comments/1/")
    expect(r.prompt).toBeUndefined()
    expect(r.videoUrl).toBeUndefined()
  })

  it("the digest brings no link, and a Social Search into any other node is still text", () => {
    const states: Record<string, NodeExecutionState> = { search: { status: "completed", output: { json: [post(1)], text: "1. @a: post 1" } } }
    const fromDigest = resolveNodeInputs(va, [edge("search", "va", "text", "video")], states, [search, va])
    expect(fromDigest.videoPageUrl).toBeUndefined()

    const llm = node("llm", "llm-chat", { userInput: "" })
    const toLlm = resolveNodeInputs(llm, [edge("search", "llm", "json", "prompt")], states, [search, llm])
    expect(toLlm.prompt).toBe(JSON.stringify([post(1)]))
  })
})
