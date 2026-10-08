import { describe, it, expect } from "vitest"
import type { WorkflowNode } from "@/types/nodes"
import { areAllInputsFilled } from "../helpers"

const mk = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode)

const col = (id: string, type = "text") => ({ id, name: id, handleId: `col_${id}`, type })

// After loop→list unification, `areAllInputsFilled` validates a list/loop node
// by COLUMN COUNT, not node type: multi-column lists (former loops) validate the
// `rows` (string[][]) shape; single-column lists validate the `items` shape.

describe("areAllInputsFilled — list/loop by column count", () => {
  it("single-column list: filled when items are non-empty", () => {
    const node = mk("n1", "list", { columns: [col("c1")] })
    expect(areAllInputsFilled([node], { n1: { items: ["a"] } })).toBe(true)
    expect(areAllInputsFilled([node], { n1: { items: [""] } })).toBe(false)
    expect(areAllInputsFilled([node], { n1: { items: [] } })).toBe(false)
  })

  it("multi-column list (former loop): every cell of every row must be filled", () => {
    const node = mk("n1", "list", { columns: [col("c1"), col("c2")] })
    expect(areAllInputsFilled([node], { n1: { rows: [["a", "b"]] } })).toBe(true)
    // Column 2 empty → not filled (would have been wrongly "filled" if routed
    // through the single-column items branch, which only checks column 0)
    expect(areAllInputsFilled([node], { n1: { rows: [["a", ""]] } })).toBe(false)
  })

  it("multi-column list: under minRows is not filled", () => {
    const node = mk("n1", "list", { columns: [col("c1"), col("c2")], minRows: 2 })
    expect(areAllInputsFilled([node], { n1: { rows: [["a", "b"]] } })).toBe(false)
    expect(areAllInputsFilled([node], { n1: { rows: [["a", "b"], ["c", "d"]] } })).toBe(true)
  })

  it("multi-column list with no minRows and zero rows is allowed (optional table)", () => {
    const node = mk("n1", "list", { columns: [col("c1"), col("c2")] })
    expect(areAllInputsFilled([node], { n1: { rows: [] } })).toBe(true)
  })
})

describe("areAllInputsFilled — a Video URL input", () => {
  const YT = "https://youtu.be/AAAAAAAAAAA"
  const FILE = "https://cdn.example.com/ep.mp4"
  const node = mk("v1", "youtube-video", { youtubeUrl: YT, downloadedVideoUrl: "https://cdn/creator.mp4", downloadedFromUrl: YT })

  it("a direct file link is filled", () => {
    expect(areAllInputsFilled([node], { v1: { youtubeUrl: FILE } })).toBe(true)
  })

  it("a post link waits for its own file — the creator's sample file does not count for the runner's link", () => {
    expect(areAllInputsFilled([node], { v1: { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" } })).toBe(false)
    expect(
      areAllInputsFilled([node], { v1: { youtubeUrl: "https://youtu.be/BBBBBBBBBBB", downloadedVideoUrl: FILE, downloadedFromUrl: "https://youtu.be/BBBBBBBBBBB" } }),
    ).toBe(true)
  })

  it("empty and invalid links are not filled; an untouched node falls back to the creator's sample", () => {
    expect(areAllInputsFilled([node], { v1: { youtubeUrl: "" } })).toBe(false)
    expect(areAllInputsFilled([node], { v1: { youtubeUrl: "hello" } })).toBe(false)
    expect(areAllInputsFilled([node], {})).toBe(true)
  })
})

describe("areAllInputsFilled — a Video URL input read only for its sound or its page link (decided 2026-10-08)", () => {
  const YT = "https://youtu.be/AAAAAAAAAAA"
  const link = mk("v1", "youtube-video", { youtubeUrl: "" })
  const graph = (...consumers: string[]) => ({
    nodes: [link, ...consumers.map((type, i) => mk(`c${i}`, type, {}))],
    edges: consumers.map((_, i) => ({ source: "v1", target: `c${i}` })),
  })

  it("Transcribe alone: a post link is filled without a downloaded file", () => {
    expect(areAllInputsFilled([link], { v1: { youtubeUrl: YT } }, graph("transcribe"))).toBe(true)
  })

  it("a node that watches the video beside it: the file is still awaited", () => {
    expect(areAllInputsFilled([link], { v1: { youtubeUrl: YT } }, graph("transcribe", "video-analysis"))).toBe(false)
  })

  it("no graph given: the file is awaited (the safe default)", () => {
    expect(areAllInputsFilled([link], { v1: { youtubeUrl: YT } })).toBe(false)
  })

  it("an empty link is not filled whatever it feeds", () => {
    expect(areAllInputsFilled([link], { v1: { youtubeUrl: "" } }, graph("transcribe"))).toBe(false)
  })
})
