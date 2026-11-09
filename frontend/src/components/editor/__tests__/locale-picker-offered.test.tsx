import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

/**
 * The language picker on a parameter node's panel. Picking one switches the
 * whole interface, so it may offer only what the deployment offers
 * (`locale.offered`), through the one helper every language list reads.
 */

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/hooks/queries/use-user-settings-queries", () => ({
  useUpdatePreferredLocaleMutation: () => ({ mutate: vi.fn() }),
}))

const { LocalePicker } = await import("../locale-picker")

function openedLanguages(): string[] {
  render(<LocalePicker />)
  fireEvent.click(screen.getByRole("button"))
  return screen.getAllByRole("button").filter((b) => b.hasAttribute("dir")).map((b) => b.getAttribute("dir") ?? "")
}

afterEach(() => {
  cleanup()
  delete window.__NODARO_RUNTIME__
})

describe("LocalePicker", () => {
  it("with no `locale.offered`, every complete language, as before", () => {
    render(<LocalePicker />)
    fireEvent.click(screen.getByRole("button"))
    for (const name of ["English", "עברית", "日本語", "한국어"]) expect(screen.getByText(name)).toBeTruthy()
    expect(screen.queryByText("Deutsch")).toBeNull()
  })

  it("lists only the languages the deployment offers", () => {
    window.__NODARO_RUNTIME__ = { surface: { locale: { picker: true, offered: ["he", "en"] } } } as unknown as typeof window.__NODARO_RUNTIME__
    render(<LocalePicker />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("English")).toBeTruthy()
    expect(screen.getByText("עברית")).toBeTruthy()
    expect(screen.queryByText("日本語")).toBeNull()
    expect(screen.queryByText("한국어")).toBeNull()
  })

  it("rows carry their reading direction (the helper hands the registry's row, untouched)", () => {
    window.__NODARO_RUNTIME__ = { surface: { locale: { picker: true, offered: ["he"] } } } as unknown as typeof window.__NODARO_RUNTIME__
    expect(openedLanguages().sort()).toEqual(["ltr", "rtl"])
  })
})
