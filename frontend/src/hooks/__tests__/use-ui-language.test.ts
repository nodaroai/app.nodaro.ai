import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

/**
 * The interface language as both language controls (the sidebar's switcher and
 * the shared site header's pill) read and change it: the current locale, the
 * offered rows, and a pick that switches AND persists to the profile.
 */

const mutate = vi.fn()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/hooks/queries/use-user-settings-queries", () => ({ useUpdatePreferredLocaleMutation: () => ({ mutate }) }))

const { useUiLanguage } = await import("../use-ui-language")
const { useLocaleStore } = await import("@/lib/locale-store")

describe("useUiLanguage", () => {
  it("offers the menu rows for the current locale, current one included", () => {
    act(() => useLocaleStore.getState().setLocale("en"))
    const { result } = renderHook(() => useUiLanguage())
    expect(result.current.locale).toBe("en")
    expect(result.current.rows.some((row) => row.id === "en")).toBe(true)
    expect(result.current.rows.every((row) => typeof row.nativeName === "string" && row.nativeName.length > 0)).toBe(true)
  })

  it("the rows are the same array across renders of one locale", () => {
    act(() => useLocaleStore.getState().setLocale("en"))
    const { result, rerender } = renderHook(() => useUiLanguage())
    const first = result.current.rows
    rerender()
    expect(result.current.rows).toBe(first)
  })

  it("a pick switches the interface and saves it to the profile", () => {
    const { result } = renderHook(() => useUiLanguage())
    act(() => result.current.pick("he"))
    expect(useLocaleStore.getState().locale).toBe("he")
    expect(mutate).toHaveBeenCalledWith({ userId: "u1", preferredLocale: "he" })
    act(() => useLocaleStore.getState().setLocale("en"))
  })
})
