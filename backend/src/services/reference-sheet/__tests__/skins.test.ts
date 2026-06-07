import { describe, it, expect } from "vitest"
import sharp from "sharp"
import type { SheetSkin } from "@nodaro/shared"
import { composeSheet } from "../compositor.js"
import type { ComposeInput } from "../index.js"

const base = (skin: SheetSkin): ComposeInput => ({
  skin, aspect: "landscape", withText: true, showLabels: true,
  sections: [
    { kind: "header", title: "KAIA", metadata: { Role: "Courier" } },
    { kind: "palette", title: "PALETTE", swatches: [{ hex: "#aa3322", label: "primary" }] },
    { kind: "notes", title: "NOTES", text: "guarded" },
  ],
})

describe("skins", () => {
  for (const skin of ["studio", "cinematic", "blueprint", "illustrated"] as const) {
    it(`${skin} composes a valid PNG`, async () => {
      const png = await composeSheet(base(skin))
      const meta = await sharp(png).metadata()
      expect(meta.format).toBe("png")
      expect(meta.width).toBeGreaterThan(0)
    })
  }

  // Count pixels whose alpha-composited luminance differs from the canvas's
  // background (top-left) pixel — i.e. anything the overlay actually drew. The
  // blueprint grid is intentionally faint (0.25 opacity), so use a low threshold
  // that still registers those thin lines against the dark-blue ground.
  async function nonBgPixels(png: Buffer): Promise<number> {
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    const bg = data[0]
    let varied = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (Math.abs(data[i] - bg) > 3) varied++
    }
    return varied
  }

  it("blueprint draws grid chrome — far more non-bg pixels than a flat skin for the same content", async () => {
    // Both skins render the same header/palette/notes content; the only structural
    // difference is the blueprint grid + corner ticks, so the delta isolates the chrome.
    // The grid blankets the whole canvas, so blueprint carries multiples of the flat
    // skin's non-bg pixels (observed ~8×; assert a conservative 3× to stay robust).
    const [bp, flat] = await Promise.all([
      nonBgPixels(await composeSheet(base("blueprint"))),
      nonBgPixels(await composeSheet(base("studio"))),
    ])
    expect(bp).toBeGreaterThan(flat * 3)
  })
})
