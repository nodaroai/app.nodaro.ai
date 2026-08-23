/**
 * A `--copilot-*` token defined in only one theme is invisible text for half
 * the users and nothing catches it at build time — the fallback is simply
 * "unset". This pins the pair.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "globals.css"), "utf8")

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block not found`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf("\n}", start))
}

function copilotTokens(source: string): string[] {
  return [...source.matchAll(/--copilot-[a-z-]+/g)].map((m) => m[0]).sort()
}

describe("copilot theme tokens", () => {
  it("defines the same set in light and dark", () => {
    const light = copilotTokens(block(":root"))
    const dark = copilotTokens(block(".dark"))
    expect(light.length).toBeGreaterThan(0)
    expect(dark).toEqual(light)
  })

  it("gives every token a real value in both themes", () => {
    for (const selector of [":root", ".dark"]) {
      const source = block(selector)
      for (const token of copilotTokens(source)) {
        // Built with a String.raw so the \s stays a regex class rather than
        // becoming a literal "s" the way it would inside a plain template.
        const value = new RegExp(token + String.raw`:\s*([^;]+);`).exec(source)?.[1]?.trim()
        expect(value, `${token} in ${selector}`).toMatch(/^(#[0-9A-Fa-f]{6}|rgba?\(|oklch\()/)
      }
    }
  })
})
