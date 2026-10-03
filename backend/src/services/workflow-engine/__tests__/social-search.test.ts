import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { getEffectivelySkippedIds } from "../execution-graph.js"

// Social Search in the workflow engine: the orchestrated request (the twin of
// POST /v1/social-search), the picking rule applied when the job's output
// becomes the node's output, the saved output a frozen node passes on, and the
// "keep my picks" freeze. buildPayload is pure: (node, jobId, inputs, usageLogId, ctx).

const ctx = { nodes: [], edges: [], nodeStates: {} }

const node = (data: Record<string, unknown>) => ({ id: "ss1", type: "social-search", data: { label: "Social Search", ...data } })

const build = (data: Record<string, unknown>, resolvedInputs: Record<string, unknown> = {}) =>
  buildPayload(node(data) as never, "job-1", resolvedInputs as never, "usage-1", ctx as never)

const post = (id: string, views = 0) => ({
  id: `tiktok:${id}`,
  platform: "tiktok",
  url: `https://www.tiktok.com/@maker/video/${id}`,
  text: `post ${id}`,
  author: { handle: "maker", name: "Maker" },
  metrics: { views },
  media: { kind: "video" },
  hashtags: [],
  extra: {},
})

describe("social-search payload", () => {
  it("builds the plugin's request from the node, reserves by pages, and carries the picking settings", () => {
    const out = build({ platform: "reddit", mode: "keyword", query: "ai tools", count: 60, subreddit: "videography", pickTop: 3, pickedIds: ["reddit:abc"] })
    expect(out.modelIdentifier).toBe("social-search:1")
    expect(out.payload).toMatchObject({
      jobId: "job-1",
      usageLogId: "usage-1",
      request: { platform: "reddit", mode: "keyword", query: "ai tools", subreddit: "videography" },
      nodeId: "ss1",
    })
    // A person's picks belong to the search they came from: a new search
    // starts without them, exactly as the editor's run does.
    expect((out.payload as { pick: unknown }).pick).toEqual({ top: 3 })
  })

  it("asks for at most one page where the platform returns one, and reserves one", () => {
    const keyword = build({ platform: "reddit", mode: "keyword", query: "q", count: 60 })
    expect(keyword.modelIdentifier).toBe("social-search:1")
    expect((keyword.payload as { request: { count: number } }).request.count).toBe(20)
    const community = build({ platform: "reddit", mode: "community", query: "aivideo", count: 60 })
    expect(community.modelIdentifier).toBe("social-search:3")
  })

  it("searches for the wired text when there is one (a List item under Each)", () => {
    const out = build({ platform: "x", query: "typed" }, { overridePrompt: "from the list" })
    expect((out.payload as { request: { query: string } }).request.query).toBe("from the list")
  })

  it("refuses a node with nothing to search for", () => {
    expect(() => build({ platform: "tiktok", query: "  " })).toThrow("social-search: type a keyword or an account")
  })
})

describe("social-search output", () => {
  it("passes on the picks still among the results, in picking order", () => {
    const output = buildNodeOutputFromJobData(
      { json: [post("1"), post("2"), post("3")], platform: "tiktok", pickedIds: ["tiktok:3", "tiktok:1"], pickTop: 5 },
      "social-search",
    )
    expect((output.json as Array<{ id: string }>).map((p) => p.id)).toEqual(["tiktok:3", "tiktok:1"])
    expect(output.listResults).toHaveLength(2)
    // Every post rides along for the editor's picker.
    expect(output.searchResults).toHaveLength(3)
    expect(JSON.parse(output.listResults![0]!).id).toBe("tiktok:3")
    expect(output.text).toContain("1. @maker")
  })

  it("passes on the first pickTop when no pick is among fresh results", () => {
    const output = buildNodeOutputFromJobData(
      { json: [post("1"), post("2"), post("3")], pickedIds: ["tiktok:old"], pickTop: 2 },
      "social-search",
    )
    expect((output.json as Array<{ id: string }>).map((p) => p.id)).toEqual(["tiktok:1", "tiktok:2"])
  })

  it("serves json and text by handle", () => {
    const output = buildNodeOutputFromJobData({ json: [post("1")] }, "social-search")
    expect(JSON.parse(getPrimaryOutput(output, "social-search", "json")!)[0].id).toBe("tiktok:1")
    expect(getPrimaryOutput(output, "social-search", "text")).toContain("https://www.tiktok.com/@maker/video/1")
    expect(getPrimaryOutput(output, "social-search", "image")).toBeUndefined()
  })

  it("a skipped or frozen node passes on its saved choice", () => {
    const saved = extractSavedNodeOutput(node({ generatedJson: [post("7"), post("8")] }) as never)
    expect((saved?.json as Array<{ id: string }>).map((p) => p.id)).toEqual(["tiktok:7", "tiktok:8"])
    expect(saved?.listResults).toHaveLength(2)
    expect(extractSavedNodeOutput(node({}) as never)).toBeUndefined()
  })
})

describe("keep my picks", () => {
  it("freezes a node that keeps its picks and has some, like a skipped node", () => {
    const nodes = [
      node({ keepPicks: true, generatedJson: [post("1")] }),
      { ...node({ keepPicks: true, generatedJson: [] }), id: "ss2" },
      { ...node({ keepPicks: false, generatedJson: [post("1")] }), id: "ss3" },
      { id: "t1", type: "text-prompt", data: { skipped: true } },
    ]
    expect([...getEffectivelySkippedIds(nodes as never, [])].sort()).toEqual(["ss1", "t1"])
  })
})
