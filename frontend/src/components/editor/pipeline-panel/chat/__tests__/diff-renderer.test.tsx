import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { DiffRenderer, describeOp, type DiffOp } from "../diff-renderer"

describe("describeOp", () => {
  it("describes scenes/N/summary as a rewrite", () => {
    expect(
      describeOp({ op: "replace", path: "/scenes/2/summary", value: "A short summary" }),
    ).toBe(`Scene 3: rewrite summary → "A short summary"`)
  })

  it("describes scenes/N/title as a retitle", () => {
    expect(
      describeOp({ op: "replace", path: "/scenes/0/title", value: "Opener" }),
    ).toBe(`Scene 1: retitle → "Opener"`)
  })

  it("describes scenes/N/duration_seconds with the s unit", () => {
    expect(
      describeOp({ op: "replace", path: "/scenes/1/duration_seconds", value: 12 }),
    ).toBe("Scene 2: duration → 12s")
  })

  it("describes scene add at end (/scenes/-)", () => {
    expect(describeOp({ op: "add", path: "/scenes/-", value: { title: "X" } })).toBe(
      "Insert scene at end",
    )
  })

  it("describes scene remove", () => {
    expect(describeOp({ op: "remove", path: "/scenes/3" })).toBe("Remove scene 4")
  })

  it("falls through scene path to op/key for unknown subkeys", () => {
    expect(
      describeOp({ op: "replace", path: "/scenes/0/foo_bar", value: "baz" }),
    ).toContain("Scene 1: replace foo_bar")
  })

  it("describes cast rename", () => {
    expect(
      describeOp({ op: "replace", path: "/cast/1/name", value: "Anna" }),
    ).toBe(`Cast #2: rename → "Anna"`)
  })

  it("describes cast visual_description update", () => {
    expect(
      describeOp({
        op: "replace",
        path: "/cast/0/visual_description",
        value: "tall, brown hair",
      }),
    ).toBe("Cast #1: update visual description")
  })

  it("describes cast add at /cast/-", () => {
    expect(
      describeOp({ op: "add", path: "/cast/-", value: { name: "Z" } }),
    ).toBe("Add cast member")
  })

  it("describes cast remove", () => {
    expect(describeOp({ op: "remove", path: "/cast/2" })).toBe("Remove cast #3")
  })

  it("describes location rename", () => {
    expect(
      describeOp({ op: "replace", path: "/locations/0/name", value: "Cafe" }),
    ).toBe(`Location #1: rename → "Cafe"`)
  })

  it("describes object rename", () => {
    expect(
      describeOp({ op: "replace", path: "/objects/3/name", value: "lantern" }),
    ).toBe(`Object #4: rename → "lantern"`)
  })

  it("describes top-level title rewrite", () => {
    expect(describeOp({ op: "replace", path: "/title", value: "Hero" })).toBe(
      `Retitle plan → "Hero"`,
    )
  })

  it("describes top-level logline rewrite", () => {
    expect(
      describeOp({ op: "replace", path: "/logline", value: "A bold tale" }),
    ).toBe(`Rewrite logline → "A bold tale"`)
  })

  it("describes has_narrator toggle", () => {
    expect(describeOp({ op: "replace", path: "/has_narrator", value: true })).toBe(
      "Narrator → enabled",
    )
    expect(
      describeOp({ op: "replace", path: "/has_narrator", value: false }),
    ).toBe("Narrator → disabled")
  })

  it("describes music_plan/mood", () => {
    expect(
      describeOp({ op: "replace", path: "/music_plan/mood", value: "epic" }),
    ).toBe(`Music mood → "epic"`)
  })

  it("describes global_style", () => {
    expect(
      describeOp({
        op: "replace",
        path: "/global_style/visual_style",
        value: "neon noir",
      }),
    ).toBe(`Style visual_style → "neon noir"`)
  })

  it("describes total_duration_seconds with the s unit", () => {
    expect(
      describeOp({ op: "replace", path: "/total_duration_seconds", value: 90 }),
    ).toBe("Total duration → 90s")
  })

  it("falls back to generic op/path for unknown paths", () => {
    expect(
      describeOp({
        op: "replace",
        path: "/unknown/path",
        value: "x",
      }),
    ).toBe(`replace /unknown/path → "x"`)
  })

  it("falls back to generic for remove on unknown path", () => {
    expect(describeOp({ op: "remove", path: "/unknown/path" })).toBe(
      "remove /unknown/path",
    )
  })

  it("truncates long string values", () => {
    const long = "a".repeat(200)
    const out = describeOp({ op: "replace", path: "/title", value: long })
    expect(out.length).toBeLessThan(200)
    expect(out).toContain("…")
  })
})

describe("DiffRenderer", () => {
  it("renders one li per op", () => {
    const ops: DiffOp[] = [
      { op: "replace", path: "/title", value: "Hero" },
      { op: "replace", path: "/scenes/0/title", value: "Opener" },
    ]
    render(<DiffRenderer ops={ops} />)
    expect(screen.getByTestId("diff-renderer").querySelectorAll("li")).toHaveLength(2)
    expect(screen.getByText(/Retitle plan/)).toBeInTheDocument()
  })

  it("renders empty-state message when ops is empty", () => {
    render(<DiffRenderer ops={[]} />)
    expect(screen.getByText("(no operations)")).toBeInTheDocument()
  })
})
