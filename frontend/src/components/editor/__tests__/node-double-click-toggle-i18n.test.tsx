import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/hooks/queries/use-user-settings-queries", () => ({ useUpdateNodeDoubleClickActionMutation: () => ({ mutate: vi.fn() }) }))
vi.mock("lucide-react", () => new Proxy({}, { get: (_t, p) => (typeof p === "string" && p !== "then" ? () => null : undefined), has: () => true }))

import { NodeDoubleClickToggle } from "../node-double-click-toggle"
import { NODE_DOUBLE_CLICK_LABEL } from "@/lib/node-double-click-action"

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("NodeDoubleClickToggle in Hebrew", () => {
  it("names the group and both radios in the user's language", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    render(<NodeDoubleClickToggle />)
    expect(screen.getByRole("radiogroup", { name: translate("he", "editor.dblClickGroup") })).toBeTruthy()
    expect(screen.getByRole("radio", { name: translate("he", "editor.dblClickTo", { what: translate("he", "editor.dblClickZoom") }) })).toBeTruthy()
    expect(screen.getByRole("radio", { name: translate("he", "editor.dblClickTo", { what: translate("he", "editor.dblClickSettings") }) })).toBeTruthy()
    expect(screen.queryByRole("radiogroup", { name: "What double-clicking a node does" })).toBeNull()
  })
  it("the label table is a live getter, not a boot-frozen constant", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    const he = NODE_DOUBLE_CLICK_LABEL().settings
    act(() => useLocaleStore.getState().setLocale("en"))
    expect(NODE_DOUBLE_CLICK_LABEL().settings).toBe("Node settings")
    expect(he).not.toBe("Node settings")
    expect(he).toMatch(/[֐-׿]/)
  })
})
