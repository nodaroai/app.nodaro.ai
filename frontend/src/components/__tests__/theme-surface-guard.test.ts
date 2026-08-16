/**
 * Theme-surface guard — canvas + editor chrome must follow the theme.
 *
 * The dark-mode palette hexes from frontend/CLAUDE.md (bg #121212, card
 * #1E1E1E, border #2D2D2D — plus the paint-mask card set) are the DARK
 * values. Painting one as a bare Tailwind class (`bg-[#1E1E1E]`) fixes that
 * colour in BOTH themes, so the surface renders as a black block on a light
 * canvas — the Paint Mask node, the Collect panel's Order rows, the Group
 * frame, the sub-workflow breadcrumb and the workflow viewer all did this.
 *
 * Rule: any `bg-` / `border-` / `text-` class carrying one of these hexes must
 * sit behind a `dark:` variant (light gets a theme token). Files that are dark
 * BY DESIGN — full-screen media editors where the dark surface makes the image
 * pop regardless of theme (Mask editor, FreeCut, Filerobot) — are allowlisted
 * explicitly, and the allowlist is verified so a stale entry is caught.
 *
 * Source-level, like handle-color-guard.test.ts.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const COMPONENTS_ROOT = join(__dirname, "..")
const SCAN_DIRS = ["editor", "nodes"].map((d) => join(COMPONENTS_ROOT, d))

/** Dark-by-design media editors: an intentionally dark surface in every theme. */
const DARK_BY_DESIGN: ReadonlySet<string> = new Set([
  "editor/mask-painter-modal.tsx",
  "editor/filerobot-editor-modal.tsx",
  "editor/freecut-editor-modal.tsx",
  "editor/freecut-import-picker.tsx",
])

const DARK_HEXES = ["1E1E1E", "1e1e1e", "121212", "2D2D2D", "2d2d2d", "0e0e10", "111114", "232327"]
const HEX_CLASS_RE = new RegExp(`((?:[a-z-]+:)*)(bg|border|text)-\\[#(${DARK_HEXES.join("|")})\\]`, "g")

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") out.push(...listSourceFiles(p))
    } else if (/\.tsx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

function relKey(p: string): string {
  return relative(COMPONENTS_ROOT, p).split(sep).join("/")
}

/** Bare (non-`dark:`) dark-hex surface classes in a file, deduped. */
function bareDarkClasses(src: string): string[] {
  const found = new Set<string>()
  for (const m of src.matchAll(HEX_CLASS_RE)) {
    const variants = (m[1] ?? "").split(":").filter(Boolean)
    if (!variants.includes("dark")) found.add(m[0])
  }
  return [...found]
}

const FILES = SCAN_DIRS.flatMap(listSourceFiles)

describe("theme-surface guard (canvas + editor chrome)", () => {
  it("scanned a non-trivial number of component files (>= 150)", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(150)
  })

  it("no component paints a dark-palette hex on a surface without a dark: variant", () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const key = relKey(file)
      if (DARK_BY_DESIGN.has(key)) continue
      const bare = bareDarkClasses(readFileSync(file, "utf8"))
      if (bare.length > 0) offenders.push(`${key}: ${bare.join(", ")}`)
    }
    expect(
      offenders,
      `These surfaces paint a fixed dark hex in BOTH themes (renders as a black block in light mode). ` +
        `Use a theme token (bg-card / bg-muted / border-border / text-muted-foreground) for the light value ` +
        `and keep the hex as a dark: override — or, ONLY for a full-screen media editor that is dark by design, ` +
        `add the file to DARK_BY_DESIGN in this test with a justification:\n  ${offenders.join("\n  ")}`,
    ).toEqual([])
  })

  it("every DARK_BY_DESIGN entry exists and still needs the exemption", () => {
    for (const key of DARK_BY_DESIGN) {
      const file = FILES.find((f) => relKey(f) === key)
      expect(file, `DARK_BY_DESIGN entry "${key}" no longer exists — remove it`).toBeDefined()
      expect(
        bareDarkClasses(readFileSync(file!, "utf8")).length,
        `DARK_BY_DESIGN entry "${key}" no longer has any bare dark hex — remove it from the allowlist`,
      ).toBeGreaterThan(0)
    }
  })
})
