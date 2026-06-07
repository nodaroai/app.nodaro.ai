import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { composeSheet } from "../compositor.js"
import type { ComposeInput, ResolvedSection } from "../types.js"

async function solid(hex: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 80, height: 80, channels: 3, background: hex } }).png().toBuffer()
}

describe("composeSheet", () => {
  it("renders a PNG whose dimensions match the computed layout", async () => {
    const red = await solid({ r: 200, g: 30, b: 30 })
    const sections: ResolvedSection[] = [
      { kind: "header", title: "KAIA VIRE", metadata: { Role: "Courier", Age: "28" } },
      { kind: "expression-board", title: "EXPRESSIONS", panels: [
        { image: red, label: "neutral" }, { image: red, label: "smile" },
      ] },
      { kind: "palette", title: "COLOR PALETTE", swatches: [
        { hex: "#aa3322", label: "primary" }, { hex: "#2244aa", label: "accent" },
      ] },
      { kind: "notes", title: "NOTES", text: "A determined courier with a guarded streak." },
    ]
    const input: ComposeInput = { skin: "studio", aspect: "landscape", sections, withText: true, showLabels: true }
    const png = await composeSheet(input)
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe("png")
    expect(meta.width).toBe(1600)
    expect(meta.height).toBeGreaterThan(400)
  })

  it("composites panel pixels into the canvas (the red panel appears)", async () => {
    const red = await solid({ r: 220, g: 20, b: 20 })
    const png = await composeSheet({
      skin: "studio", aspect: "landscape",
      sections: [{ kind: "expression-board", title: "X", panels: [{ image: red, label: "a" }] }],
    })
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    let redPixels = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 180 && data[i + 1] < 80 && data[i + 2] < 80) redPixels++
    }
    expect(redPixels).toBeGreaterThan(500) // the 80x80 panel got drawn
  })

  it("withText:false suppresses the notes text but still renders", async () => {
    const png = await composeSheet({
      skin: "studio", aspect: "landscape", withText: false,
      sections: [{ kind: "notes", title: "NOTES", text: "secret" }],
    })
    expect((await sharp(png).metadata()).format).toBe("png")
  })

  it("escapes a crafted swatch hex — cannot inject a flood <rect> via the palette", async () => {
    const evil = `#000" /><rect x="0" y="0" width="2000" height="2000" fill="#ff0000`
    const png = await composeSheet({
      skin: "studio", aspect: "landscape",
      sections: [{ kind: "palette", title: "P", swatches: [{ hex: evil, label: "x" }] }],
    })
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    let red = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) red++
    }
    const total = (info.width * info.height)
    expect(red / total).toBeLessThan(0.05) // no canvas flood — the breakout was escaped
  })
})
