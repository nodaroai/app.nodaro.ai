import { describe, it, expect, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useAppDir, usePickerDir, useLocaleStore } from "../locale-store"

afterEach(() => {
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("direction hooks", () => {
  it("usePickerDir is pinned ltr regardless of locale", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    const { result } = renderHook(() => usePickerDir())
    expect(result.current).toBe("ltr")
  })

  it("useAppDir follows the locale live", () => {
    const { result } = renderHook(() => useAppDir())
    act(() => useLocaleStore.getState().setLocale("he"))
    expect(result.current).toBe("rtl")
    act(() => useLocaleStore.getState().setLocale("en"))
    expect(result.current).toBe("ltr")
  })
})
