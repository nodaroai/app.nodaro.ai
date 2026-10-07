/**
 * A social post's job row carries { platformPostId, platformPostUrl } — the
 * publish worker's shape, not a DIRECT_OUTPUT_KEYS one. The live DAG used to
 * read an empty output from it, throw "completed but produced no output" and
 * fail the run AFTER the post had gone out (2026-10-07: a Telegram photo
 * posted as message 4, the node and the run marked failed).
 */
import { describe, expect, it } from "vitest"
import { SOCIAL_POST_NODE_TYPES } from "@nodaro/shared"
import { buildNodeOutputFromJobData } from "../output-extractor.js"

describe("buildNodeOutputFromJobData — a social post's job row", () => {
  it("a Telegram post with only a message id has that id as its output", () => {
    const out = buildNodeOutputFromJobData({ platformPostId: "4", scheduledPostId: "sp-1" }, "telegram-post")
    expect(out.text).toBe("4")
    expect(out.json).toEqual({ platformPostId: "4", platformPostUrl: null })
    expect(Object.values(out).some((v) => v != null)).toBe(true)
  })

  it("a platform that gives a URL has the URL as its text, the id beside it", () => {
    const out = buildNodeOutputFromJobData({ platformPostId: "p1", platformPostUrl: "https://x.example.test/p1" }, "x-post")
    expect(out.text).toBe("https://x.example.test/p1")
    expect(out.json).toEqual({ platformPostId: "p1", platformPostUrl: "https://x.example.test/p1" })
  })

  it("every social post type reads the row the same way", () => {
    for (const type of SOCIAL_POST_NODE_TYPES) {
      expect(buildNodeOutputFromJobData({ platformPostId: "id-1" }, type).text).toBe("id-1")
    }
  })

  it("a row with neither id nor url stays empty — the 'no output' failure still applies", () => {
    expect(buildNodeOutputFromJobData({ scheduledPostId: "sp-1" }, "telegram-post")).toEqual({})
  })

  it("a non-social node is untouched by those keys", () => {
    expect(buildNodeOutputFromJobData({ platformPostId: "4" }, "generate-image")).toEqual({})
  })
})
