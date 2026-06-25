import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// ---------------------------------------------------------------------------
// Invariant: an entity's `style` is persisted as FREE TEXT.
//
// The save routes (`POST /v1/{locations,characters,objects,creatures,faces}`)
// and the DB columns all store `style` as `z.string().max(50)` — and entities
// routinely inherit a style from the project's broader `visualStyle`
// vocabulary (cinematic / noir / vintage / fantasy / sci-fi / cartoon). So
// EVERY surface that forwards a persisted entity style into a generation
// request MUST accept that same free-text contract.
//
// A narrow 4-value art-style enum (`["realistic","anime","3d-pixar",
// "illustration"]`, the `CHARACTER_STYLES` shared list, or a `STYLE_ENUM`
// alias) on any of these routes 400s every variant / motion / re-create for a
// location like "Sunset Boat" (style "cinematic"). Style is only prompt
// seasoning (`${style} art style`), never a hard constraint — so the enum buys
// nothing and only drifts out of sync with the save route.
//
// This guard fails the moment anyone re-introduces a restrictive style enum on
// an entity surface, keeping the save-route and variant/motion/create/MCP
// contracts in lockstep. Regression net for the Sunset Boat outage (2026-06).
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const routesDir = join(here, "..") // backend/src/routes
const mcpToolsDir = join(here, "..", "..", "lib", "mcp", "tools") // backend/src/lib/mcp/tools

// Markers of a restrictive style enum on an entity surface. Each is unambiguous
// — a non-style field (provider, aspect, category, caption style) never matches
// these (none of those enums begin with "realistic" or reference the
// CHARACTER_STYLES / STYLE_ENUM identifiers).
const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /style:\s*z\.enum\(/, // inline `style: z.enum(...)`
  /z\.enum\(CHARACTER_STYLES\)/, // the shared canonical-list enum
  /z\.enum\(STYLE_ENUM\)/, // a local alias of CHARACTER_STYLES
  /z\.enum\(\[\s*"realistic"/, // the 4-value art-style literal, however referenced
]

// Save routes (plural) + create/asset/motion routes (generate-*) for the five
// entity families. Globbed so a NEW entity route is auto-covered.
function entityRouteFiles(): string[] {
  return readdirSync(routesDir)
    .filter(
      (f) =>
        /^generate-(character|object|location|creature|face)(-asset|-motion)?\.ts$/.test(f) ||
        /^(characters|objects|locations|creatures|faces)\.ts$/.test(f),
    )
    .map((f) => join(routesDir, f))
}

// MCP entity verb surfaces (create / variant / motion tools + the shared
// create-location/object verb helper).
const MCP_ENTITY_FILES = ["characters.ts", "objects.ts", "locations.ts", "creatures.ts", "verbs-clo.ts"].map((f) =>
  join(mcpToolsDir, f),
)

describe("entity `style` contract — free-text across every surface", () => {
  const files = [...entityRouteFiles(), ...MCP_ENTITY_FILES]

  it("discovers the full entity surface (save + create + asset + motion + MCP)", () => {
    // 5 save + 5 create + 4 asset + 4 motion (no face asset/motion) + 5 MCP.
    expect(files.length).toBeGreaterThanOrEqual(18)
  })

  it.each(files)("%s validates `style` as free text, never a restrictive enum", (file) => {
    const src = readFileSync(file, "utf8")
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(
        pattern.test(src),
        `${file} re-introduced a restrictive style enum matching ${pattern}. Entities persist free-text style (save route + DB are z.string().max(50)); a narrow enum 400s inherited styles like "cinematic". Use \`z.string().max(50).optional()\`.`,
      ).toBe(false)
    }
  })
})
