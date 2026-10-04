import { describe, expect, it } from "vitest"
import { pickSocialPosts, type SocialPost } from "@nodaro/shared"
import type { SocialSearchNodeData } from "@/types/nodes"
import {
  applySocialSearchPickTop,
  applySocialSearchPicks,
  applySocialSearchResult,
  clearSocialSearchPatch,
  deriveSocialSearchCardState,
  socialSearchFingerprint,
  socialSearchServerRunPatch,
} from "../social-search-run-state"
import { isScrapeNodeType, scrapeResultPatch } from "../scrape-result-recovery"
import { filterPickerPosts, sortPickerPosts } from "@/components/research/social-post-picker"

function post(id: string, over: Partial<SocialPost> = {}): SocialPost {
  return {
    id: `tiktok:${id}`,
    platform: "tiktok",
    url: `https://www.tiktok.com/@maker/video/${id}`,
    text: `post ${id}`,
    author: { handle: "maker", name: "Maker" },
    metrics: {},
    media: { kind: "video" },
    hashtags: [],
    extra: {},
    ...over,
  }
}

const results = ["1", "2", "3", "4", "5", "6"].map((id) => post(id))

describe("a finished search", () => {
  it("keeps every post for the picker, clears old picks and passes on the first pickTop", () => {
    const patch = applySocialSearchResult(results, { pickTop: 2 })
    expect(patch).toMatchObject({ executionStatus: "completed", lastRunOutcome: "success", lastRunCount: 6, pickedIds: undefined })
    expect((patch.searchResults as SocialPost[]).length).toBe(6)
    expect((patch.generatedJson as SocialPost[]).map((p) => p.id)).toEqual(["tiktok:1", "tiktok:2"])
    expect(patch.generatedText).toContain("1. @maker")
  })

  it("picks exactly as the workflow engine does for a fresh search (no picks, the first pickTop)", () => {
    // The backend's buildNodeOutputFromJobData applies pickSocialPosts with no
    // ids (the payload sends only `top`); the editor's run must agree.
    const patch = applySocialSearchResult(results, { pickTop: 3 })
    expect(patch.generatedJson).toEqual(pickSocialPosts(results, undefined, 3))
  })

  it("an empty search keeps the previous results", () => {
    const patch = applySocialSearchResult([], { pickTop: 2 })
    expect(patch).toEqual(expect.objectContaining({ lastRunOutcome: "empty", lastRunCount: 0 }))
    expect(patch).not.toHaveProperty("searchResults")
    expect(patch).not.toHaveProperty("generatedJson")
  })

  it("is the patch the reload recovery applies too, reading the node's pickTop", () => {
    expect(isScrapeNodeType("social-search")).toBe(true)
    const patch = scrapeResultPatch("social-search", results, "job-9", { pickTop: 3 })
    expect(patch?.lastAppliedJobId).toBe("job-9")
    expect((patch?.generatedJson as SocialPost[]).length).toBe(3)
  })
})

describe("a search a server run finished", () => {
  const data = { label: "Social Search", platform: "tiktok", query: "a" } as SocialSearchNodeData

  it("paints every post found and the ones passed on, with no stale picks", () => {
    const patch = socialSearchServerRunPatch(data, { json: results.slice(0, 2), searchResults: results, text: "digest" })
    expect(patch).toMatchObject({ lastRunOutcome: "success", lastRunCount: 6, pickedIds: undefined, searchWarnings: undefined })
    expect((patch.searchResults as SocialPost[]).length).toBe(6)
    expect((patch.generatedJson as SocialPost[]).map((p) => p.id)).toEqual(["tiktok:1", "tiktok:2"])
    expect(patch.lastRunFingerprint).toBe(socialSearchFingerprint(data))
  })

  it("leaves a node that passed on its saved posts (skipped, or keeping picks) untouched", () => {
    expect(socialSearchServerRunPatch(data, { json: results.slice(0, 1), text: "digest" })).toEqual({})
  })

  it("records an empty search", () => {
    expect(socialSearchServerRunPatch(data, { json: [], searchResults: [] })).toMatchObject({ lastRunOutcome: "empty", lastRunCount: 0 })
  })
})

describe("picking", () => {
  const data = { label: "Social Search", searchResults: results, pickTop: 2 } as SocialSearchNodeData

  it("passes on the picks in picking order, dropping ids no longer in the results", () => {
    const patch = applySocialSearchPicks(data, ["tiktok:5", "tiktok:gone", "tiktok:2"])
    expect(patch.pickedIds).toEqual(["tiktok:5", "tiktok:2"])
    expect((patch.generatedJson as SocialPost[]).map((p) => p.id)).toEqual(["tiktok:5", "tiktok:2"])
  })

  it("clearing every pick falls back to the first pickTop", () => {
    const patch = applySocialSearchPicks(data, [])
    expect(patch.pickedIds).toBeUndefined()
    expect((patch.generatedJson as SocialPost[]).map((p) => p.id)).toEqual(["tiktok:1", "tiktok:2"])
  })

  it("changing how many to pass on re-derives the choice when nobody picked", () => {
    const patch = applySocialSearchPickTop(data, 4)
    expect(patch.pickTop).toBe(4)
    expect((patch.generatedJson as SocialPost[]).length).toBe(4)
  })
})

describe("the card's state", () => {
  it("reads never-ran, running, success and stale", () => {
    expect(deriveSocialSearchCardState({ label: "x" })).toEqual({ kind: "never-ran" })
    expect(deriveSocialSearchCardState({ label: "x", executionStatus: "running", lastRunStartedAt: 5 })).toEqual({ kind: "running", startedAt: 5 })
    const ran: SocialSearchNodeData = { label: "x", platform: "tiktok", query: "a", searchResults: results, lastRunOutcome: "success", lastRunCount: 6, lastRunAt: 9 }
    const fresh = { ...ran, lastRunFingerprint: socialSearchFingerprint(ran) }
    expect(deriveSocialSearchCardState(fresh)).toMatchObject({ kind: "success", count: 6, stale: false })
    expect(deriveSocialSearchCardState({ ...fresh, query: "b" })).toMatchObject({ kind: "success", stale: true })
  })

  it("a failure says how many results it kept", () => {
    const failed: SocialSearchNodeData = { label: "x", searchResults: results, lastRunOutcome: "failed", errorMessage: "busy", lastGoodAt: 3 }
    expect(deriveSocialSearchCardState(failed)).toMatchObject({ kind: "failed", kept: { count: 6, at: 3 }, errorMessage: "busy" })
  })
})

describe("clearing the node (its X)", () => {
  it("drops every post, the picks and the last run, keeps the settings, and reads as never run", () => {
    const settings = { platform: "instagram", mode: "account", query: "@nike", count: 20, pickTop: 3, keepPicks: true }
    const ran = {
      ...settings,
      ...applySocialSearchResult(results, settings),
      ...applySocialSearchPicks({ ...settings, searchResults: results }, ["tiktok:2"]),
      searchWarnings: ["a note"],
    } as SocialSearchNodeData
    expect(deriveSocialSearchCardState(ran).kind).toBe("success")

    const cleared = { ...ran, ...clearSocialSearchPatch() } as SocialSearchNodeData
    expect(deriveSocialSearchCardState(cleared)).toEqual({ kind: "never-ran" })
    expect(cleared).toMatchObject({ ...settings, executionStatus: "idle" })
    for (const key of ["searchResults", "pickedIds", "generatedJson", "generatedText", "searchWarnings", "lastRunOutcome", "lastRunFingerprint"]) {
      expect(cleared[key as keyof SocialSearchNodeData], key).toBeUndefined()
    }
  })
})

describe("the picker grid", () => {
  const grid = [
    post("a", { metrics: { views: 10 }, publishedAt: "2026-09-01T00:00:00Z", text: "cats" }),
    post("b", { metrics: { views: 900 }, publishedAt: "2026-08-01T00:00:00Z", text: "dogs and cats" }),
    post("c", { metrics: { likes: 50 }, publishedAt: "2026-10-01T00:00:00Z", text: "birds", hashtags: ["parrot"] }),
  ]

  it("sorts by reach or date without touching the input", () => {
    expect(sortPickerPosts(grid, "popular").map((p) => p.id)).toEqual(["tiktok:b", "tiktok:c", "tiktok:a"])
    expect(sortPickerPosts(grid, "newest").map((p) => p.id)).toEqual(["tiktok:c", "tiktok:a", "tiktok:b"])
    expect(sortPickerPosts(grid, "platform").map((p) => p.id)).toEqual(["tiktok:a", "tiktok:b", "tiktok:c"])
    expect(grid.map((p) => p.id)).toEqual(["tiktok:a", "tiktok:b", "tiktok:c"])
  })

  it("filters on every word, across text, author and hashtags", () => {
    expect(filterPickerPosts(grid, "cats").map((p) => p.id)).toEqual(["tiktok:a", "tiktok:b"])
    expect(filterPickerPosts(grid, "dogs cats").map((p) => p.id)).toEqual(["tiktok:b"])
    expect(filterPickerPosts(grid, "PARROT").map((p) => p.id)).toEqual(["tiktok:c"])
    expect(filterPickerPosts(grid, "  ")).toHaveLength(3)
  })
})
