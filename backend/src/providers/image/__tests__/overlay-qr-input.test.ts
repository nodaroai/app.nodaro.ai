/**
 * A QR layer may read its link from the node's QR link handle instead of its
 * own text. The fill is pure and per-layer; an unfilled fromInput layer is a
 * clear failure that names the handle, never a blank code.
 */
import { describe, it, expect } from "vitest"
import { applyOverlayQrText, resolveLayer, type OverlayLayerParams } from "../overlay.js"

const qrLayer = (qr: Record<string, unknown>): Partial<OverlayLayerParams> => ({ kind: "qr", width: 15, qr: qr as OverlayLayerParams["qr"] })

describe("applyOverlayQrText", () => {
  it("fills only fromInput QR layers and leaves typed ones alone", () => {
    const out = applyOverlayQrText(
      [qrLayer({ text: "", fromInput: true }), qrLayer({ text: "https://typed.example" }), { kind: "text", text: { text: "hi" } as never }],
      "  https://nodaro.ai/promo  ",
    )
    expect(out[0].qr).toMatchObject({ text: "https://nodaro.ai/promo", fromInput: true })
    expect(out[1].qr).toMatchObject({ text: "https://typed.example" })
    expect(out[2]).toMatchObject({ kind: "text" })
  })

  it("with nothing wired, a fromInput layer stays empty so resolveLayer can refuse it by name", () => {
    const out = applyOverlayQrText([qrLayer({ text: "stale", fromInput: true })], undefined)
    expect(out[0].qr?.text).toBe("")
    expect(() => resolveLayer(out[0])).toThrow(/QR link handle/)
  })

  it("a typed QR layer with an empty text is refused too", () => {
    expect(() => resolveLayer(qrLayer({ text: "   " }))).toThrow(/QR layer has no link/)
  })

  it("a filled fromInput layer resolves like any QR layer", () => {
    const [filled] = applyOverlayQrText([qrLayer({ text: "", fromInput: true })], "WIFI:S:home;;")
    expect(resolveLayer(filled).qr?.text).toBe("WIFI:S:home;;")
  })
})
