import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { composeSheet, sheetSlots } from "../compositor.js"
import type { ComposeInput } from "../index.js"

const input = (mode?: "background"): ComposeInput => ({
  skin: "studio",
  aspect: "landscape",
  withText: true,
  showLabels: true,
  slotsMode: mode,
  sections: [
    { kind: "header", title: "KAIA" },
    {
      kind: "expression-board",
      title: "EXPRESSIONS",
      panels: [
        { image: Buffer.alloc(0), label: "smile" },
        { image: Buffer.alloc(0), label: "neutral" },
      ],
    },
  ],
})

describe("background mode + slot export", () => {
  it("renders a valid PNG even with empty panel buffers in background mode", async () => {
    const png = await composeSheet(input("background"))
    expect((await sharp(png).metadata()).format).toBe("png")
  })
  it("sheetSlots returns one rect per board panel, in order", () => {
    const slots = sheetSlots(input())
    expect(slots).toHaveLength(2)
    expect(slots[0]).toHaveProperty("w")
    expect(slots[0]).toHaveProperty("x")
    expect(slots[1].x).toBeGreaterThan(slots[0].x)
  })
})
