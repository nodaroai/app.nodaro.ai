// @vitest-environment node
// @test-watches frontend/src/globals.css frontend/src/**/*.tsx frontend/src/**/*.ts packages/picker-ui/src/**/*.tsx packages/picker-ui/src/**/*.ts
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Pink TEXT must reach 4.5:1 on its ground (WCAG 1.4.3, SI 5568). The brand pink
 * #ff0073 gives white only 3.82:1, so pink text uses `text-primary-ink`: the CTA pink
 * #e0006f in the light theme, the brand pink in the dark one, where it is the one
 * that passes (decided 2026-10-25). A bare `text-primary` / `text-[#ff0073]` is
 * allowed only behind `dark:` and on the surfaces below that stay dark in the light
 * theme too. Icons are graphics (1.4.11, 3:1) and pass with either pink, so they
 * follow the text rule only to keep one rule.
 */

const REPO = path.resolve(__dirname, "../../../..")
const css = fs.readFileSync(path.join(REPO, "frontend/src/globals.css"), "utf8")

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  return css.slice(start, css.indexOf("\n}", start))
}
const token = (src: string, name: string) => src.match(new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase()

/**
 * Surfaces that are dark in BOTH themes (a black player, the Auto Director's cinema
 * screens, the media and audio editors): the brand pink is the one that passes there.
 * The count is how many bare pink text classes each holds. This list only shrinks.
 */
const ON_DARK: Readonly<Record<string, number>> = {
  "frontend/src/components/pipeline/ai-director-panel.tsx": 4,
  "frontend/src/components/pipeline/cinema-top-bar.tsx": 1,
  "frontend/src/components/pipeline/clip-editor.tsx": 1,
  "frontend/src/components/pipeline/composer-spec.tsx": 7,
  "frontend/src/components/pipeline/library-drawer.tsx": 2,
  "frontend/src/components/pipeline/reel-pipeline.tsx": 3,
  "frontend/src/components/pipeline/shot-inspector.tsx": 1,
  "frontend/src/components/editor/media-editor/format-panel.tsx": 1,
  "frontend/src/components/editor/media-editor/trim-panel.tsx": 4,
  "frontend/src/components/editor/audiomass-editor-modal.tsx": 1,
  "frontend/src/components/editor/freecut-import-picker.tsx": 2,
  "frontend/src/routes/pipeline-page.tsx": 1, // the clip header on the black player
}

const BARE = /(?<![\w-])((?:[a-z0-9-]+:)*)text-(?:primary|\[#(?:ff0073|FF0073)\])(?:\/\d+)?(?![\w-])/g

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

describe("pink text", () => {
  const light = block(":root")
  const dark = block(".dark")

  it("the light theme's pink ink is the CTA pink and passes on white", () => {
    expect(token(light, "--primary-ink")).toBe("#e0006f")
    expect(token(light, "--primary-ink")).toBe(token(light, "--cta"))
    expect(contrast("#e0006f", "#ffffff")).toBeGreaterThanOrEqual(4.5)
    expect(contrast("#ff0073", "#ffffff")).toBeLessThan(4.5)
  })

  it("the dark theme's pink ink is the brand pink, which passes on its ground where the CTA pink does not", () => {
    const ground = token(dark, "--background")!
    expect(token(dark, "--primary-ink")).toBe("#ff0073")
    expect(contrast("#ff0073", ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast("#e0006f", ground)).toBeLessThan(4.5)
  })

  it("is a Tailwind color, so text-primary-ink exists", () => {
    expect(css).toMatch(/--color-primary-ink:\s*var\(--primary-ink\);/)
  })

  it("the link Button variants use the pink ink", () => {
    for (const file of ["frontend/src/components/ui/button.tsx", "packages/picker-ui/src/ui/button.tsx"]) {
      expect(fs.readFileSync(path.join(REPO, file), "utf8")).toMatch(/link: "text-primary-ink /)
    }
  })

  it("no bare pink text class outside dark: and the surfaces that are dark in both themes", () => {
    const found: Record<string, number> = {}
    const offenders: string[] = []
    for (const abs of [...walk(path.join(REPO, "frontend/src")), ...walk(path.join(REPO, "packages/picker-ui/src"))]) {
      const rel = path.relative(REPO, abs).split(path.sep).join("/")
      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/)
      lines.forEach((line, i) => {
        for (const m of line.matchAll(BARE)) {
          if (m[1]!.split(":").includes("dark")) continue
          if (rel in ON_DARK) found[rel] = (found[rel] ?? 0) + 1
          else offenders.push(`${rel}:${i + 1}: ${m[0]}`)
        }
      })
    }
    expect(offenders, "use text-primary-ink (the deep pink on white, the brand pink on dark)").toEqual([])
    expect(found).toEqual(ON_DARK)
  })
})
