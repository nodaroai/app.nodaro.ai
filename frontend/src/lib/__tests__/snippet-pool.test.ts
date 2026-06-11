import { describe, it, expect } from "vitest"
import {
  buildSnippetPool,
  filterSnippets,
  computeSnippetInsertPrefix,
  appendSnippetText,
  groupSnippetsByCategory,
  type SnippetPoolItem,
} from "../snippet-pool"
import type { PromptSnippet } from "../api"

const userSnippet = (over: Partial<PromptSnippet>): PromptSnippet => ({
  id: "u1", name: "My Look", text: "my custom look", target: "prompt",
  media: [], category: undefined, sortOrder: 0,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", description: undefined,
  ...over,
})

describe("buildSnippetPool", () => {
  it("merges user (first) + factory, filtered by target & media", () => {
    const pool = buildSnippetPool({ media: "image", target: "prompt", userSnippets: [userSnippet({})] })
    expect(pool[0]).toMatchObject({ id: "u1", source: "user", category: "My snippets" })
    expect(pool.some((s) => s.id === "identity-lock" && s.source === "factory")).toBe(true)
    expect(pool.some((s) => s.id === "slow-dolly-in")).toBe(false)       // video-only
    expect(pool.some((s) => s.id === "watermark-scrub")).toBe(false)      // negative-target
  })
  it("user media [] means all modalities; non-empty narrows", () => {
    const all = userSnippet({ id: "a", name: "A", media: [] })
    const vid = userSnippet({ id: "v", name: "V", media: ["video"] })
    const pool = buildSnippetPool({ media: "image", target: "prompt", userSnippets: [all, vid] })
    expect(pool.some((s) => s.id === "a")).toBe(true)
    expect(pool.some((s) => s.id === "v")).toBe(false)
  })
  it("user snippet custom category survives; whitespace-only category falls back", () => {
    const custom = userSnippet({ id: "c", name: "C", category: "Faves" })
    const blank = userSnippet({ id: "b", name: "B", category: "   " })
    const pool = buildSnippetPool({ media: "image", target: "prompt", userSnippets: [custom, blank] })
    expect(pool.find((s) => s.id === "c")?.category).toBe("Faves")
    expect(pool.find((s) => s.id === "b")?.category).toBe("My snippets")
  })
})

describe("filterSnippets", () => {
  const pool = buildSnippetPool({ media: "image", target: "prompt", userSnippets: [] })
  it("name-prefix matches rank before substring matches", () => {
    const res = filterSnippets(pool, "go")
    expect(res[0].name).toBe("Golden Hour")
  })
  it("matches name, description, and category, case-insensitive", () => {
    expect(filterSnippets(pool, "IDENTITY").some((s) => s.id === "identity-lock")).toBe(true)
    expect(filterSnippets(pool, "lighting").length).toBeGreaterThan(3) // category
  })
  it("empty query returns the pool unchanged", () => {
    expect(filterSnippets(pool, "")).toEqual(pool)
  })
  it("matches on description alone", () => {
    // "plastic-skin" lives ONLY in real-skin-texture's description
    // ("The no-plastic-skin anchor") — not in any name, text, or category in
    // the image+prompt pool — so this exercises the description-only clause.
    expect(filterSnippets(pool, "plastic-skin").some((s) => s.id === "real-skin-texture")).toBe(true)
  })
})

describe("insert separators", () => {
  it("computeSnippetInsertPrefix", () => {
    expect(computeSnippetInsertPrefix("")).toBe("")       // line start
    expect(computeSnippetInsertPrefix(" ")).toBe("")      // after whitespace
    expect(computeSnippetInsertPrefix(",")).toBe(" ")     // after punctuation → single space
    expect(computeSnippetInsertPrefix(".")).toBe(" ")
    expect(computeSnippetInsertPrefix("t")).toBe(", ")    // mid-sentence → comma
  })
  it("appendSnippetText (button path — append at end)", () => {
    expect(appendSnippetText("", "golden hour")).toBe("golden hour")
    expect(appendSnippetText("a knight", "golden hour")).toBe("a knight, golden hour")
    expect(appendSnippetText("a knight.", "golden hour")).toBe("a knight. golden hour")
    expect(appendSnippetText("a knight,  ", "golden hour")).toBe("a knight, golden hour")
  })
})

describe("groupSnippetsByCategory", () => {
  const row = (id: string, category: string) => ({ id, category })
  it("folds consecutive same-category rows into one group each", () => {
    const groups = groupSnippetsByCategory([
      row("a", "Lighting"),
      row("b", "Lighting"),
      row("c", "Mood"),
    ])
    expect(groups).toEqual([
      { category: "Lighting", entries: [row("a", "Lighting"), row("b", "Lighting")] },
      { category: "Mood", entries: [row("c", "Mood")] },
    ])
  })
  it("preserves input order — a repeated category opens a new group, not a merge", () => {
    const groups = groupSnippetsByCategory([
      row("a", "Lighting"),
      row("b", "Mood"),
      row("c", "Lighting"),
    ])
    expect(groups.map((g) => g.category)).toEqual(["Lighting", "Mood", "Lighting"])
    expect(groups[2].entries).toEqual([row("c", "Lighting")])
  })
})
