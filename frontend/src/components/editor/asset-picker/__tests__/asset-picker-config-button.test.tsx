/**
 * The entity config panels' "Choose / Replace from Library / Gallery" row.
 * Its label used to be an English literal in every language; it now comes from
 * the dictionary (the English wording is the one the public docs quote).
 */
import { afterEach, describe, it, expect, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"

vi.mock("../use-asset-picker", () => ({
  useAssetPicker: () => ({ openPicker: vi.fn(), pickerElement: null }),
}))

import { AssetPickerConfigButton } from "../asset-picker-config-button"

afterEach(() => act(() => useLocaleStore.getState().setLocale("en")))

describe("AssetPickerConfigButton", () => {
  it("reads the docs' English wording", () => {
    const { rerender } = render(<AssetPickerConfigButton kind="character" nodeId="n1" currentDbId={null} />)
    expect(screen.getByRole("button", { name: "Choose from Library / Gallery" })).toBeTruthy()
    rerender(<AssetPickerConfigButton kind="character" nodeId="n1" currentDbId="db-1" />)
    expect(screen.getByRole("button", { name: "Replace from Library / Gallery" })).toBeTruthy()
  })

  it.each(["ja", "pt-BR"] as const)("follows the interface language (%s)", (locale) => {
    act(() => useLocaleStore.getState().setLocale(locale))
    const { rerender } = render(<AssetPickerConfigButton kind="character" nodeId="n1" currentDbId={null} />)
    expect(screen.getByRole("button", { name: translate(locale, "assetPicker.chooseFromLibraryGallery") })).toBeTruthy()
    rerender(<AssetPickerConfigButton kind="character" nodeId="n1" currentDbId="db-1" />)
    expect(screen.getByRole("button", { name: translate(locale, "assetPicker.replaceFromLibraryGallery") })).toBeTruthy()
    expect(screen.queryByText(/Library \/ Gallery/)).toBeNull()
  })
})
