// @test-watches frontend/index.html frontend/src/globals.css
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * This page is drawn by the bundle: until it has run, the only colours on the
 * screen are what the markup and the stylesheet say. The head's inline script
 * puts the theme the app's next-themes provider will choose (the visitor's
 * `theme`, else the system's) on the html element before the first frame:
 * without it, every frame before React has run was `:root`'s light colours
 * (a white screen for most of a second on arriving from another Nodaro app).
 */
const root = resolve(__dirname, "../../..")
const indexHtml = readFileSync(resolve(root, "index.html"), "utf8")
const globalsCss = readFileSync(resolve(root, "src/globals.css"), "utf8")

function themeBoot(): () => void {
  const match = indexHtml.match(/<script>\s*\/\* theme-boot \*\/([\s\S]*?)<\/script>/)
  if (!match) throw new Error("index.html has no theme-boot script")
  return new Function(match[1]) as () => void
}

const html = document.documentElement

function run(stored: string | null, prefersDark = true): void {
  localStorage.clear()
  if (stored !== null) localStorage.setItem("theme", stored)
  html.className = ""
  html.style.colorScheme = ""
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark") ? prefersDark : !prefersDark }))
  themeBoot()()
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  html.className = ""
  html.style.colorScheme = ""
})

describe("the theme before the first frame", () => {
  it("follows the system when the visitor has chosen nothing (the provider's default)", () => {
    run(null, true)
    expect(html.classList.contains("dark")).toBe(true)
    expect(html.style.colorScheme).toBe("dark")
    run(null, false)
    expect(html.classList.contains("light")).toBe(true)
    expect(html.style.colorScheme).toBe("light")
  })

  it("keeps the visitor's own choice, from the first frame", () => {
    run("light", true)
    expect(html.classList.contains("light")).toBe(true)
    expect(html.classList.contains("dark")).toBe(false)
    run("dark", false)
    expect(html.classList.contains("dark")).toBe(true)
  })

  it("follows the system when the visitor chose that", () => {
    run("system", false)
    expect(html.classList.contains("light")).toBe(true)
    run("system", true)
    expect(html.classList.contains("dark")).toBe(true)
  })

  it("cannot throw when storage is unavailable, and follows the system", () => {
    html.className = ""
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(() => themeBoot()()).not.toThrow()
    expect(html.classList.contains("dark")).toBe(true)
    spy.mockRestore()
  })

  it("stands in the head with the page's own backgrounds for both themes", () => {
    const at = indexHtml.indexOf("/* theme-boot */")
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(indexHtml.indexOf("</head>"))
    expect(indexHtml.indexOf("/* theme-boot */")).toBeLessThan(indexHtml.indexOf("<body"))
    const dark = indexHtml.match(/html\{background:(#[0-9a-fA-F]+)\}/)?.[1]
    expect(dark).toBe(globalsCss.match(/\.dark\s*\{[^}]*?--background:\s*(#[0-9a-fA-F]+)/)?.[1])
    expect(indexHtml).toMatch(/html\.light\{background:#fff\}/)
    expect(globalsCss).toMatch(/:root\s*\{[^}]*?--background:\s*oklch\(1 0 0\)/)
  })
})
