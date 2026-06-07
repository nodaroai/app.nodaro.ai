import { describe, it, expect } from "vitest"
import { buildResolvedSections } from "../build-sections.js"
import { headingFor, buildSheetMetadata } from "../sheet-text.js"
import type { SheetFlavour } from "@nodaro/shared"
const fl: SheetFlavour = { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" }

describe("sheet-text", () => {
  it("headingFor maps known kinds to display labels", () => {
    expect(headingFor("expression-board")).toBe("EXPRESSIONS")
    expect(headingFor("body-turnaround")).toBe("FULL BODY VIEWS")
    expect(headingFor("zzz-unknown")).toBe("ZZZ UNKNOWN")
  })
  it("buildSheetMetadata pulls per-entity display fields", () => {
    expect(buildSheetMetadata("character", { gender: "female", style: "realistic", base_outfit: "courier jacket" }))
      .toMatchObject({ Gender: "female", Style: "realistic" })
  })
})

describe("buildResolvedSections", () => {
  it("orders sections and attaches pre-fetched buffers", () => {
    const hero = Buffer.from("h"); const sm = Buffer.from("s")
    const out = buildResolvedSections(
      [{ kind: "header" }, { kind: "expression-board", entries: [{ kind: "preset", variant: "smile" }] }, { kind: "palette" }, { kind: "notes" }],
      fl, "character",
      { title: "Kaia", metadata: { Role: "Courier" }, notes: "guarded", heroBuf: hero, palette: [{ hex: "#aa0000", label: "primary" }],
        buckets: { expressions: [{ name: "smile", url: "u1" }] }, panelBufByUrl: { u1: sm } },
    )
    expect(out.map((s) => s.kind)).toEqual(["header", "expression-board", "palette", "notes"])
    expect(out[0].hero).toBe(hero)
    expect(out[1].panels?.[0].image).toBe(sm)
    expect(out[1].title).toBe("EXPRESSIONS")
    expect(out[2].swatches?.[0].hex).toBe("#aa0000")
    expect(out[3].text).toBe("guarded")
  })
})
