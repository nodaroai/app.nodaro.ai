import { describe, it, expect } from "vitest"
import type { WorkflowNode } from "@/types/nodes"
import { makeEmptyInputs, makeSnapshotInputs } from "../types"

const mk = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode)

const col = (id: string, type = "text") => ({ id, name: id, handleId: `col_${id}`, type })

// After the loop→list load migration every list/loop node is type `list`; the
// I/O SHAPE is chosen by COLUMN COUNT. These tests prove a former multi-column
// loop (now a multi-column `list`) still gets the `{rows}` shape, and a
// single-column `list` gets the `{items}` shape — i.e. columns 2+ are NOT lost.

describe("makeEmptyInputs — list/loop by column count", () => {
  it("single-column list → { items: [''] }", () => {
    const out = makeEmptyInputs([mk("n1", "list", { columns: [col("c1")] })])
    expect(out.n1).toEqual({ items: [""] })
  })

  it("multi-column list (former loop) → { rows: string[][] } with N empty cells", () => {
    const out = makeEmptyInputs([mk("n1", "list", { columns: [col("c1"), col("c2")], defaultRows: 2 })])
    expect(out.n1).toEqual({ rows: [["", ""], ["", ""]] })
  })

  it("multi-column list honors minRows over defaultRows", () => {
    const out = makeEmptyInputs([mk("n1", "list", { columns: [col("c1"), col("c2")], defaultRows: 1, minRows: 3 })])
    expect((out.n1.rows as string[][]).length).toBe(3)
  })

  it("does NOT produce an entry for a raw loop-typed node (loop is migrated to list upstream)", () => {
    // The presentation/app-runner load paths migrate loop→list before these
    // helpers ever run, so a still-`loop`-typed node is an unreachable input
    // here and intentionally yields no entry.
    const out = makeEmptyInputs([mk("n1", "loop", { columns: [col("c1"), col("c2")], defaultRows: 1 })])
    expect(out.n1).toBeUndefined()
  })
})

describe("makeSnapshotInputs — list/loop by column count", () => {
  it("multi-column list (former loop) → { rows } preserving every column", () => {
    const out = makeSnapshotInputs([
      mk("n1", "list", { columns: [col("c1"), col("c2", "image-url")], rows: [["Ana", "u1"], ["Bo", "u2"]] }),
    ])
    expect(out.n1).toEqual({ rows: [["Ana", "u1"], ["Bo", "u2"]] })
  })

  it("multi-column list with empty rows → one empty row sized to columns", () => {
    const out = makeSnapshotInputs([mk("n1", "list", { columns: [col("c1"), col("c2")], rows: [] })])
    expect(out.n1).toEqual({ rows: [["", ""]] })
  })

  it("single-column list (columns+rows) → { items } from column 0", () => {
    const out = makeSnapshotInputs([mk("n1", "list", { columns: [col("c1")], rows: [["a"], ["b"], [""]] })])
    expect(out.n1).toEqual({ items: ["a", "b"] })
  })

  it("single-column list with legacy items string → { items }", () => {
    const out = makeSnapshotInputs([mk("n1", "list", { items: "x\ny\n\nz" })])
    expect(out.n1).toEqual({ items: ["x", "y", "z"] })
  })

  it("empty single-column list → { items: [''] }", () => {
    const out = makeSnapshotInputs([mk("n1", "list", { columns: [col("c1")], rows: [] })])
    expect(out.n1).toEqual({ items: [""] })
  })
})

describe("a Video URL input", () => {
  const YT = "https://youtu.be/AAAAAAAAAAA"

  it("starts empty for a new run: the runner brings their own link", () => {
    expect(makeEmptyInputs([mk("v1", "youtube-video", { youtubeUrl: YT, downloadedVideoUrl: "https://cdn/s.mp4" })]).v1).toEqual({ youtubeUrl: "" })
  })

  it("the creator's run shows the creator's link and the file made from it", () => {
    const out = makeSnapshotInputs([
      mk("v1", "youtube-video", { youtubeUrl: YT, downloadedVideoUrl: "https://cdn/s.mp4", downloadedFromUrl: YT, title: "kept off" }),
    ])
    expect(out.v1).toEqual({ youtubeUrl: YT, downloadedVideoUrl: "https://cdn/s.mp4", downloadedFromUrl: YT })
  })

  it("a creator's node with no link yet snapshots an empty link", () => {
    expect(makeSnapshotInputs([mk("v1", "youtube-video", {})]).v1).toEqual({ youtubeUrl: "" })
  })
})
