// @vitest-environment node
// @test-watches frontend/src/**/*.tsx frontend/src/**/*.ts frontend/src/globals.css
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Text stays readable (SI 5568 / WCAG 1.4.3 contrast, and the 11px floor the
 * owner chose for 1.4.4):
 *  - no text class under 11px (text-[6px] … text-[10px]);
 *  - no faded grey text: `text-muted-foreground/NN` without a variant prefix
 *    falls under 4.5:1 (a `disabled:` one is exempt; `placeholder:` / `hover:`
 *    states are left to the variant);
 *  - the grey tokens themselves keep 4.5:1 on their backgrounds.
 */

const SRC = path.resolve(__dirname, "../..")

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe("readable text", () => {
  const files = walk(SRC)

  it("scans the app (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(500)
  })

  it("no text class under 11px, decimals included", () => {
    const hits = files.flatMap((f) =>
      [...fs.readFileSync(f, "utf8").matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)]
        .filter((m) => Number(m[1]) < 11)
        .map((m) => `${path.relative(SRC, f)}: ${m[0]}`),
    )
    expect(hits).toEqual([])
  })

  it("no page font size under 11px set in code (canvas, 3D and video renderers draw pixels and are left out)", () => {
    const canvas = /react-konva|from "konva"|@react-three|remotion|getContext\(|ctx\.font|from "three"/
    const hits = files.flatMap((f) => {
      const src = fs.readFileSync(f, "utf8")
      if (canvas.test(src)) return []
      return [...src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)(?![\d.])/g)]
        .filter((m) => Number(m[1]) < 11)
        .map((m) => `${path.relative(SRC, f)}: ${m[0]}`)
    })
    expect(hits).toEqual([])
  })

  it("the app grey keeps 4.5:1 on its own surfaces, light and dark", () => {
    const css = fs.readFileSync(path.join(SRC, "globals.css"), "utf8")
    // Light mode is oklch(L 0 0) greys: relative luminance is L^3.
    const lightFg = Number(/--muted-foreground:\s*oklch\(([\d.]+) 0 0\)/.exec(css)?.[1])
    const lightMuted = Number(/--muted:\s*oklch\(([\d.]+) 0 0\)/.exec(css)?.[1])
    expect(lightFg).toBeGreaterThan(0)
    expect((lightMuted ** 3 + 0.05) / (lightFg ** 3 + 0.05)).toBeGreaterThanOrEqual(4.5)
    const darkFg = /--muted-foreground:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]
    const darkMuted = /--muted:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]
    const darkCard = /--card:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]
    expect(contrast(darkFg!, darkMuted!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(darkFg!, darkCard!)).toBeGreaterThanOrEqual(4.5)
  })

  it("no faded grey text (text-muted-foreground/NN without a variant prefix)", () => {
    const hits = files.flatMap((f) =>
      [...fs.readFileSync(f, "utf8").matchAll(/(?:^|[\s"'`{(])text-muted-foreground\/\d+/gm)].map(() => path.relative(SRC, f)),
    )
    expect([...new Set(hits)]).toEqual([])
  })

  it("the home grey keeps 4.5:1 on the home background, light and dark", () => {
    const css = fs.readFileSync(path.join(SRC, "globals.css"), "utf8")
    const muted = [...css.matchAll(/--home-muted:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!)
    const bg = [...css.matchAll(/--home-bg:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!)
    expect(muted.length).toBe(2)
    expect(bg.length).toBe(2)
    for (let i = 0; i < 2; i++) expect(contrast(muted[i]!, bg[i]!)).toBeGreaterThanOrEqual(4.5)
  })
})
