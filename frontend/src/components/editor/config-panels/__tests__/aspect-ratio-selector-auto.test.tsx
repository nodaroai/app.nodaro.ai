import { describe, it, expect, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { AspectRatioSelector } from "../aspect-ratio-selector"
import { SOURCE_PHOTO_AUTO_LABEL } from "../model-options"
import { useLocaleStore } from "@/lib/locale-store"
import { localizeOptionLabel } from "@/lib/i18n/labels"

/**
 * The Auto tile on a source-photo node: the tile shows the short word, the
 * tooltip the whole label, in every interface language — including the ones
 * that set the qualifier in full-width parentheses with no space before it.
 */
const options = [
  { value: "auto", label: SOURCE_PHOTO_AUTO_LABEL },
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
]

afterEach(() => {
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("the Auto tile on a source-photo node", () => {
  it("translates the qualifier in every locale that has option tables", () => {
    expect(localizeOptionLabel(SOURCE_PHOTO_AUTO_LABEL, "en")).toBe("Auto (match the photo)")
    expect(localizeOptionLabel(SOURCE_PHOTO_AUTO_LABEL, "he")).toBe("אוטומטי (לפי התמונה)")
    expect(localizeOptionLabel(SOURCE_PHOTO_AUTO_LABEL, "ja")).toBe("自動（写真に合わせる）")
    expect(localizeOptionLabel(SOURCE_PHOTO_AUTO_LABEL, "ko")).toBe("자동(사진에 맞춤)")
    expect(localizeOptionLabel(SOURCE_PHOTO_AUTO_LABEL, "pt-BR")).toBe("Automático (Conforme a foto)")
  })

  for (const [locale, word] of [["en", "Auto"], ["he", "אוטומטי"], ["ja", "自動"], ["ko", "자동"], ["pt-BR", "Automático"]] as const) {
    it(`shows "${word}" on the tile and the whole label as its tooltip (${locale})`, () => {
      act(() => useLocaleStore.getState().setLocale(locale))
      render(<AspectRatioSelector options={options} value="auto" onValueChange={() => {}} />)
      const tile = screen.getAllByRole("radio")[0]!
      expect(tile.textContent).toBe(word)
      expect(tile.getAttribute("title")).toBe(localizeOptionLabel(SOURCE_PHOTO_AUTO_LABEL, locale))
      expect(tile.getAttribute("aria-checked")).toBe("true")
    })
  }
})
