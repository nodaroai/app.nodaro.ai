/**
 * User-owned direction references: `direction.colorLook: "palette:<id>"` and
 * `direction.style: "moodboard:<id>"`. The grammar, the wording of the
 * resolved clauses, and how a resolved clause takes its row's place in the
 * fold — without changing a single byte of a fold that carries none.
 */
import { describe, it, expect } from "vitest"
import {
  parseUserDirectionRef,
  userDirectionRefValue,
  renderPaletteClause,
  renderMoodboardClause,
  styleReferenceDescription,
} from "../user-direction-refs.js"
import { nearestColorName } from "../color-names.js"
import {
  DIRECTION_FIELDS,
  directionKeyForUserRef,
  userRefKindOfDirectionKey,
  renderDirectionHints,
  renderDirectionHintClauses,
} from "../direction-registry.js"
import { partitionStyleClauses } from "../prompt-style-section.js"
import { getColorLookPromptHint } from "../color-look.js"
import { getStylePromptHint } from "../style.js"

const UUID = "0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const PALETTE = `palette:${UUID}`
const MOODBOARD = `moodboard:${UUID}`
const IMAGE = { surface: "image" as const }

describe("parseUserDirectionRef", () => {
  it("reads a palette and a moodboard reference", () => {
    expect(parseUserDirectionRef(PALETTE)).toEqual({ kind: "palette", id: UUID, wellFormed: true })
    expect(parseUserDirectionRef(MOODBOARD)).toEqual({ kind: "moodboard", id: UUID, wellFormed: true })
  })

  it("marks a prefix followed by anything but a uuid as malformed, not as a catalog id", () => {
    expect(parseUserDirectionRef("palette:warm")).toEqual({ kind: "palette", id: "warm", wellFormed: false })
    expect(parseUserDirectionRef("moodboard:")).toEqual({ kind: "moodboard", id: "", wellFormed: false })
  })

  it("is null for a catalog id, an empty string and a non-string", () => {
    expect(parseUserDirectionRef("teal-orange")).toBeNull()
    expect(parseUserDirectionRef("")).toBeNull()
    expect(parseUserDirectionRef(undefined)).toBeNull()
    expect(parseUserDirectionRef(["palette:x"])).toBeNull()
  })

  it("builds the wire value back", () => {
    expect(userDirectionRefValue("palette", UUID)).toBe(PALETTE)
    expect(userDirectionRefValue("moodboard", UUID)).toBe(MOODBOARD)
  })
})

describe("which direction keys take a reference", () => {
  it("colorLook takes a palette and style takes a moodboard", () => {
    expect(directionKeyForUserRef("palette")).toBe("colorLook")
    expect(directionKeyForUserRef("moodboard")).toBe("style")
    expect(userRefKindOfDirectionKey("colorLook")).toBe("palette")
    expect(userRefKindOfDirectionKey("style")).toBe("moodboard")
    expect(userRefKindOfDirectionKey("mood")).toBeUndefined()
    expect(userRefKindOfDirectionKey("not-a-key")).toBeUndefined()
  })

  it("only single-pick rows take one, so a reference is never sliced away by a pick budget", () => {
    const rows = DIRECTION_FIELDS.filter((f) => "userRef" in f)
    expect(rows.map((f) => f.key).sort()).toEqual(["colorLook", "style"])
    for (const row of rows) expect(row.maxPicks, row.key).toBe(1)
  })
})

describe("nearestColorName", () => {
  it("names the primaries and the neutrals plainly", () => {
    expect(nearestColorName("#000000")).toBe("black")
    expect(nearestColorName("#FFFFFF")).toBe("white")
    expect(nearestColorName("#FF0000")).toBe("red")
    expect(nearestColorName("#0000FF")).toBe("blue")
    expect(nearestColorName("#808080")).toBe("gray")
  })

  it("accepts lowercase hex and answers the same name", () => {
    expect(nearestColorName("#ff0000")).toBe(nearestColorName("#FF0000"))
  })

  it("answers a name for any valid colour and nothing for an invalid one", () => {
    expect(nearestColorName("#0F4C5C").length).toBeGreaterThan(0)
    expect(nearestColorName("#E3B23C").length).toBeGreaterThan(0)
    expect(nearestColorName("teal")).toBe("")
    expect(nearestColorName("#12345")).toBe("")
  })

  it("puts a dark blue-green near teal, not near a warm colour", () => {
    expect(nearestColorName("#0F4C5C")).toMatch(/teal|petrol|blue|green/)
  })
})

describe("renderPaletteClause", () => {
  it("names every colour with its hex, in the palette's order", () => {
    const clause = renderPaletteClause(["#0f4c5c", "#E3B23C"])
    expect(clause).toBe(`color palette: ${nearestColorName("#0F4C5C")} #0F4C5C, ${nearestColorName("#E3B23C")} #E3B23C`)
  })

  it("skips an entry that is not a #RRGGBB colour, and renders nothing for none", () => {
    expect(renderPaletteClause(["#FF0000", "red", "#00FF00"])).toBe("color palette: red #FF0000, " + `${nearestColorName("#00FF00")} #00FF00`)
    expect(renderPaletteClause([])).toBe("")
    expect(renderPaletteClause(["nope"])).toBe("")
  })
})

describe("renderMoodboardClause", () => {
  it("is the description, on one line, trimmed", () => {
    expect(renderMoodboardClause("  Moody Nordic interiors,\n\nsoft   daylight  ")).toBe("Moody Nordic interiors, soft daylight")
  })

  it("cannot open a section of its own: newlines collapse", () => {
    expect(renderMoodboardClause("calm\n\n[style]:\nloud")).not.toContain("\n")
  })

  it("renders nothing without a description", () => {
    expect(renderMoodboardClause(null)).toBe("")
    expect(renderMoodboardClause(undefined)).toBe("")
    expect(renderMoodboardClause("   ")).toBe("")
  })
})

describe("styleReferenceDescription", () => {
  it("tells the model what to take from the first style reference, and keeps the rest short", () => {
    expect(styleReferenceDescription(0)).toMatch(/style reference/)
    expect(styleReferenceDescription(0)).toMatch(/not its subject/)
    expect(styleReferenceDescription(1)).toBe("another style reference")
  })

  it("carries the image's caption, on one line", () => {
    expect(styleReferenceDescription(1, "  linen\nand oak ")).toBe("another style reference (linen and oak)")
    expect(styleReferenceDescription(0, "soft daylight")).toContain("(soft daylight)")
  })
})

describe("the fold with resolved references", () => {
  const refs = new Map([
    [PALETTE, "color palette: deep teal #0F4C5C"],
    [MOODBOARD, "Moody Nordic interiors"],
  ])

  it("renders a resolved palette in the colorLook row and a moodboard in the style row", () => {
    expect(renderDirectionHints({ colorLook: PALETTE, style: MOODBOARD }, { ...IMAGE, refs })).toEqual([
      "color palette: deep teal #0F4C5C",
      "Moody Nordic interiors",
    ])
  })

  it("keeps the table's fold order around a resolved clause", () => {
    const hints = renderDirectionHints({ style: MOODBOARD, colorLook: "warm", era: "1970s" }, { ...IMAGE, refs })
    expect(hints[0]).toBe(getColorLookPromptHint("warm"))
    expect(hints[1]).toBe("Moody Nordic interiors")
  })

  it("lands both on the film line of the [style] section", () => {
    const slots = partitionStyleClauses({ colorLook: PALETTE, style: MOODBOARD }, { ...IMAGE, refs })
    expect(slots.map((c) => c.slot)).toEqual(["film", "film"])
    const clauses = renderDirectionHintClauses({ colorLook: PALETTE }, { ...IMAGE, refs })
    expect(clauses[0]).toMatchObject({ key: "colorLook", family: "look", styleGroup: "film" })
  })

  it("renders nothing for a reference it was not handed, like an unknown catalog id", () => {
    expect(renderDirectionHints({ colorLook: PALETTE }, IMAGE)).toEqual([])
    expect(renderDirectionHints({ colorLook: PALETTE }, { ...IMAGE, refs: new Map() })).toEqual([])
  })

  it("renders nothing for a reference on a row that does not take that kind", () => {
    expect(renderDirectionHints({ style: PALETTE, colorLook: MOODBOARD, mood: PALETTE }, { ...IMAGE, refs })).toEqual([])
  })

  it("leaves a fold with no reference byte-identical, refs or not", () => {
    const direction = { colorLook: "warm", style: "anime", mood: ["happy", "joyful"] }
    expect(renderDirectionHints(direction, { ...IMAGE, refs })).toEqual(renderDirectionHints(direction, IMAGE))
    expect(renderDirectionHints({ style: "anime" }, { ...IMAGE, refs })).toEqual([getStylePromptHint("anime")])
  })
})
