// @vitest-environment node
// @test-watches frontend/src/globals.css frontend/src/**/*.tsx frontend/src/**/*.ts
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * White text on a solid pink fill must reach 4.5:1 (WCAG 1.4.3, SI 5568).
 * The brand pink #ff0073 gives white only 3.8:1, so a solid fill under white
 * text uses the CTA tokens (`bg-cta`, `hover:bg-cta-hover`); pink TEXT and
 * rings keep the brand pink. This holds the tokens' contrast and keeps a new
 * `bg-[#ff0073] … text-white` from coming back.
 */

const SRC = path.resolve(__dirname, "../..")

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}

function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(p)
  }
  return out
}

describe("CTA pink", () => {
  const css = fs.readFileSync(path.join(SRC, "globals.css"), "utf8")

  it("the brand pink itself is below 4.5:1 under white (why the tokens exist)", () => {
    expect(contrastWithWhite("#ff0073")).toBeLessThan(4.5)
  })

  const valuesOf = (token: string) =>
    [...css.matchAll(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map((m) => m[1]!.toLowerCase())

  for (const token of ["--cta", "--cta-hover"]) {
    it(`${token} gives white text at least 4.5:1 in both themes`, () => {
      const values = valuesOf(token)
      expect(values.length).toBe(2)
      for (const hex of values) expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it("is the pair every Nodaro product shares: #e0006f, hover #c90060 (decided 2026-10-25)", () => {
    expect(valuesOf("--cta")).toEqual(["#e0006f", "#e0006f"])
    expect(valuesOf("--cta-hover")).toEqual(["#c90060", "#c90060"])
    expect(contrastWithWhite("#e0006f")).toBeCloseTo(4.77, 2)
    expect(contrastWithWhite("#c90060")).toBeCloseTo(5.75, 2)
  })

  it("the hover is darker than the fill, never lighter, so the hover passes too", () => {
    expect(luminance("#c90060")).toBeLessThan(luminance("#e0006f"))
    for (const [fill, hover] of valuesOf("--cta").map((f, i) => [f, valuesOf("--cta-hover")[i]!] as const)) {
      expect(luminance(hover)).toBeLessThan(luminance(fill))
    }
  })

  it("no class list puts white text on a brand-pink fill", () => {
    // Every "…" and '…' string is its own class list, the branches of a ternary
    // inside a template literal included. White = text-white or the primary
    // foreground; a pink fill = bg-[#ff0073] or bg-primary, solid or >= 80 %.
    // The shadcn primitives in components/ui are checked by their own variants.
    const white = /(^|\s)(?:[a-z-]+:)*text-(?:white|primary-foreground)(?=\s|$)/
    const fill = /(^|\s)(?:[a-z-]+:)*bg-(?:\[#(?:ff0073|FF0073)\]|primary)(?:\/(?:80|90))?(?=\s|$)/
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      if (file.includes(`${path.sep}ui${path.sep}`)) continue
      const src = fs.readFileSync(file, "utf8")
      for (const m of src.matchAll(/(["'])((?:(?!\1)[^\\\n`$]|\\.)*)\1/g)) {
        const body = m[2]!
        if (white.test(body) && fill.test(body)) offenders.push(`${path.relative(SRC, file)}: ${body.slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("the shadcn Button and Badge fill with the CTA pink", () => {
    for (const file of ["components/ui/button.tsx", "components/ui/badge.tsx"]) {
      const src = fs.readFileSync(path.join(SRC, file), "utf8")
      expect(src).toMatch(/default: "bg-cta text-primary-foreground/)
    }
  })
})
