import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup, act } from "@testing-library/react"
import { I18nHtmlDir } from "../i18n-html-dir"
import { useLocaleStore } from "@/lib/locale-store"

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("I18nHtmlDir", () => {
  it("mirrors locale into <html lang> and <html dir>, live", () => {
    render(<I18nHtmlDir />)
    act(() => useLocaleStore.getState().setLocale("he"))
    expect(document.documentElement.getAttribute("dir")).toBe("rtl")
    expect(document.documentElement.getAttribute("lang")).toBe("he")
    act(() => useLocaleStore.getState().setLocale("en"))
    expect(document.documentElement.getAttribute("dir")).toBe("ltr")
    expect(document.documentElement.getAttribute("lang")).toBe("en")
  })
})
