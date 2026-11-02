import { describe, expect, it, vi } from "vitest"
import type { CommitSummary } from "../github.js"

// No model is ever asked here: the client is replaced, and every test hands in its own `ask`.
vi.mock("../../../../lib/llm-client.js", () => ({ llmCompleteStructured: vi.fn(async () => ({ output: { summary: "from the client" } })) }))

import { createReleaseSummaries } from "../release-summary.js"

const commit = (message: string, parents = 1): CommitSummary => ({ message, parents, committedAt: null })
const RELEASE = [
  commit("feat: row off (0.13.0)\n\nThe links lead to pages that answer 404.\n\nCo-Authored-By: Someone <a@b.c>\nClaude-Session: https://claude.ai/code/session_x"),
  commit("Merge pull request #22 from a/b\n\nfeat: row off (0.13.0)", 2),
]

/** Lets the background writing finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createReleaseSummaries", () => {
  it("never makes a page wait: the first ask starts the writing, a later one gets it; asked once", async () => {
    const texts: string[] = []
    const summarize = createReleaseSummaries({
      ask: async (text) => {
        texts.push(text)
        return "Products can hide the links."
      },
    })
    expect(summarize("0.13.0", RELEASE)).toBeNull()
    await settle()
    expect(summarize("0.13.0", RELEASE)).toBe("Products can hide the links.")
    expect(summarize("0.13.0", RELEASE)).toBe("Products can hide the links.")
    expect(texts).toHaveLength(1)
  })

  it("reads the commits' own words: a merge as its pull request's title, never trailers naming people or sessions", async () => {
    const texts: string[] = []
    const summarize = createReleaseSummaries({ ask: async (text) => (texts.push(text), "ok") })
    summarize("0.13.0", RELEASE)
    expect(texts[0]).toContain("Release 0.13.0")
    expect(texts[0]).toContain("The links lead to pages that answer 404.")
    expect(texts[0]).not.toContain("Merge pull request")
    expect(texts[0]).not.toMatch(/Co-Authored-By|Claude-Session|claude\.ai/)
  })

  it("a long release keeps its newest commits", async () => {
    const texts: string[] = []
    const summarize = createReleaseSummaries({ ask: async (text) => (texts.push(text), "ok") })
    summarize("1.0.0", [commit(`feat: first\n\n${"a".repeat(20_000)}`), commit("feat: the last word")])
    expect(texts[0]).toContain("the last word")
    expect(texts[0]!.length).toBeLessThan(12_100)
  })

  it("callers at once start one writing", async () => {
    let asked = 0
    const summarize = createReleaseSummaries({ ask: async () => (asked++, "One answer.") })
    expect([summarize("0.13.0", RELEASE), summarize("0.13.0", RELEASE)]).toEqual([null, null])
    await settle()
    expect(asked).toBe(1)
  })

  it("a release no model could explain is asked about again only after an hour", async () => {
    let clock = 0
    let asked = 0
    const summarize = createReleaseSummaries({ now: () => clock, ask: async () => (++asked === 1 ? null : "Second try.") })
    summarize("0.13.0", RELEASE)
    await settle()
    clock = 59 * 60_000
    expect(summarize("0.13.0", RELEASE)).toBeNull()
    expect(asked).toBe(1)
    clock = 61 * 60_000
    expect(summarize("0.13.0", RELEASE)).toBeNull()
    await settle()
    expect(summarize("0.13.0", RELEASE)).toBe("Second try.")
    expect(asked).toBe(2)
  })

  it("a model that throws leaves the summary empty, and a release with no commits asks nothing", async () => {
    const ask = vi.fn(async (): Promise<string | null> => {
      throw new Error("lane down")
    })
    const summarize = createReleaseSummaries({ ask })
    summarize("0.13.0", RELEASE)
    await settle()
    expect(summarize("0.13.0", RELEASE)).toBeNull()
    expect(summarize("0.1.0", [])).toBeNull()
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("without a seam, the platform's client answers", async () => {
    const summarize = createReleaseSummaries()
    summarize("0.13.0", RELEASE)
    await settle()
    expect(summarize("0.13.0", RELEASE)).toBe("from the client")
  })
})
