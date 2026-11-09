import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { useTheme } from "next-themes"
import { ThemeProvider } from "../theme-provider"

/**
 * The hosted Nodaro header draws in its own shadow root and follows the page's
 * light or dark through the standard `color-scheme` on <html> — the one thing
 * it reads from the page's theme. next-themes writes it by default
 * (`enableColorScheme`); these pin that, so the header never disagrees with the
 * app's theme, including when it changes.
 */

let setTheme: (theme: string) => void = () => {}
function Capture() {
  setTheme = useTheme().setTheme
  return null
}

function mount(saved: string) {
  localStorage.setItem("theme", saved)
  render(
    <ThemeProvider>
      <Capture />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  // next-themes asks for the system's preference; jsdom has no matchMedia.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.style.colorScheme = ""
  document.documentElement.className = ""
})

describe("the theme's color-scheme on <html>", () => {
  it.each(["dark", "light"] as const)("is written for a saved %s theme", (theme) => {
    mount(theme)
    expect(document.documentElement.style.colorScheme).toBe(theme)
  })

  it("follows a change of theme", () => {
    mount("dark")
    act(() => setTheme("light"))
    expect(document.documentElement.style.colorScheme).toBe("light")
  })
})
