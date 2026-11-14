import { describe, it, expect } from "vitest"
import { localizeOptionLabel } from "../labels"

/**
 * Option labels in the config panels' dropdowns are data, not chrome: aspect
 * ratios ("16:9 (Landscape)"), resolutions ("2K (Standard)"), sources ("From
 * image"). They ship as `label:` strings in option tables and were the last
 * English in a Hebrew dropdown. Localized by their English string; the ratio /
 * resolution token stays, the parenthetical translates.
 */
describe("localizeOptionLabel", () => {
  it("translates a parenthetical qualifier and keeps the token", () => {
    expect(localizeOptionLabel("16:9 (Landscape)", "he")).toBe("16:9 (לרוחב)")
    expect(localizeOptionLabel("2K (Standard)", "he")).toBe("2K (רגיל)")
    expect(localizeOptionLabel("4:5 (Social)", "he")).toBe("4:5 (רשתות חברתיות)")
  })
  it("translates a whole-label entry", () => {
    expect(localizeOptionLabel("From image", "he")).toBe("מתמונה")
    expect(localizeOptionLabel("Wired Audio", "he")).toBe("אודיו מחובר")
  })
  it("translates the token too when it is itself a whole-label entry", () => {
    // The transition styles name their default look "<choice> (default)".
    expect(localizeOptionLabel("Full cover (default)", "he")).toBe("כיסוי מלא (ברירת מחדל)")
    expect(localizeOptionLabel("Full cover (default)", "ja")).toBe("全面を覆う（デフォルト）")
    expect(localizeOptionLabel("Full cover (default)", "pt-BR")).toBe("Cobertura total (Padrão)")
    expect(localizeOptionLabel("Full cover (default)", "en")).toBe("Full cover (default)")
  })
  it("translates the image output formats and SVG levels, the format names kept", () => {
    expect(localizeOptionLabel("GIF (animated)", "he")).toBe("GIF (מונפש)")
    expect(localizeOptionLabel("SVG (vector)", "ja")).toBe("SVG（ベクター）")
    expect(localizeOptionLabel("GIF (animated)", "ko")).toBe("GIF(애니메이션)")
    expect(localizeOptionLabel("SVG (vector)", "pt-BR")).toBe("SVG (Vetorial)")
    expect(localizeOptionLabel("SVG Detailed", "he")).toBe("SVG מפורט")
    expect(localizeOptionLabel("SVG Max", "pt-BR")).toBe("SVG máximo")
    expect(localizeOptionLabel("WebP", "he")).toBe("WebP")
    expect(localizeOptionLabel("GIF (animated)", "en")).toBe("GIF (animated)")
  })
  it("reads the Video Analysis Ultra tier as a tier name, and the (Ultra) qualifier as a picture-quality grade", () => {
    expect(localizeOptionLabel("Ultra", "he")).toBe("אולטרה")
    expect(localizeOptionLabel("Ultra", "ja")).toBe("ウルトラ")
    expect(localizeOptionLabel("Ultra", "ko")).toBe("울트라")
    expect(localizeOptionLabel("Ultra", "pt-BR")).toBe("Ultra")
    expect(localizeOptionLabel("Ultra", "en")).toBe("Ultra")
    expect(localizeOptionLabel("4K (Ultra)", "ja")).toBe("4K（超高画質）")
    expect(localizeOptionLabel("4K (Ultra)", "ko")).toBe("4K(초고화질)")
  })
  it("passes tokens, brand names and unknown copy through", () => {
    expect(localizeOptionLabel("1080p", "he")).toBe("1080p")
    expect(localizeOptionLabel("Nano Banana Pro", "he")).toBe("Nano Banana Pro")
    expect(localizeOptionLabel("Something new", "he")).toBe("Something new")
    expect(localizeOptionLabel("16:9 (Landscape)", "en")).toBe("16:9 (Landscape)")
  })
})
