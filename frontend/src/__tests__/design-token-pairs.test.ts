// @vitest-environment node
/**
 * A namespaced design token defined in only ONE theme is invisible text for
 * half the users, and nothing catches it at build time — the CSS fallback for
 * an undefined custom property is simply "unset".
 *
 * `copilot-theme-tokens.test.ts` pins that pair for `--copilot-*`, but it reads
 * only the FIRST `:root {` / `.dark {` block in the file. Every design handoff
 * since (`--home-*`, `--integ-*`) carries its OWN block pair further down, so
 * it was never covered — this scans every block and covers each prefix, which
 * means the next handoff's tokens are guarded the day they land rather than
 * the day someone remembers to add them to a list.
 *
 * A token that is deliberately theme-INDEPENDENT (derived from `--primary` via
 * color-mix, say) belongs in `THEME_INDEPENDENT` with the reason — that is a
 * real category, not an exemption for forgetting the dark value.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "globals.css"), "utf8")

/** Namespaced ramps that a design handoff owns. Stock shadcn tokens are not listed. */
const PREFIXES = ["integ", "home", "copilot", "canvas", "node", "pill"] as const

/** Tokens whose value does not vary by theme, with the reason they don't. */
const THEME_INDEPENDENT: Readonly<Record<string, string>> = {
  // color-mix() off --primary, which is itself identical in both themes.
  "--home-accent-hover": "derived from --primary",
}

/** Every `:root {` / `.dark {` block body in the file, concatenated per theme. */
function themeSource(selector: string): string {
  const re = new RegExp(`^${selector.replace(".", "\\.")} \\{$`, "gm")
  let out = ""
  for (const m of css.matchAll(re)) {
    const start = (m.index ?? 0) + m[0].length
    out += css.slice(start, css.indexOf("\n}", start)) + "\n"
  }
  return out
}

const LIGHT = themeSource(":root")
const DARK = themeSource(".dark")

function tokens(source: string, prefix: string): string[] {
  return [...new Set([...source.matchAll(new RegExp(`--${prefix}-[a-z0-9-]+`, "g"))].map((m) => m[0]))].sort()
}

describe("namespaced design tokens", () => {
  it("finds both theme blocks at all", () => {
    expect(LIGHT.length).toBeGreaterThan(0)
    expect(DARK.length).toBeGreaterThan(0)
  })

  it.each(PREFIXES)("--%s-* is defined in both themes", (prefix) => {
    const light = tokens(LIGHT, prefix)
    const dark = tokens(DARK, prefix)
    expect(light.length, `no --${prefix}-* tokens found`).toBeGreaterThan(0)

    const missingInDark = light.filter((t) => !dark.includes(t) && !(t in THEME_INDEPENDENT))
    expect(missingInDark, `defined in :root but not in .dark`).toEqual([])

    // The reverse is just as broken, and has no legitimate category.
    expect(dark.filter((t) => !light.includes(t)), `defined in .dark but not in :root`).toEqual([])
  })

  /**
   * Deliberately NOT a colour-syntax check: these ramps carry shadows
   * (`--node-shadow`) and gradients (`--home-dots`) too, and enumerating valid
   * CSS value shapes would be a list to forget. What actually breaks a theme is
   * a token that resolves to nothing, so that is what this asserts.
   */
  it.each(PREFIXES)("--%s-* resolves to something everywhere it is defined", (prefix) => {
    for (const [themeName, source] of [["light", LIGHT], ["dark", DARK]] as const) {
      for (const token of tokens(source, prefix)) {
        const value = new RegExp(token + String.raw`:\s*([^;]*);`).exec(source)?.[1]?.trim()
        expect(value, `${token} in ${themeName} has no value`).toBeTruthy()
        expect(["initial", "unset", "inherit", "none"], `${token} in ${themeName}`).not.toContain(value)
      }
    }
  })
})
