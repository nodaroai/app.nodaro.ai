// @test-watches backend/src/**/*.ts
/**
 * `presetCatalog` (lib/presets/app-presets.ts) is the backend's ONE reader of
 * the bundled factory presets. It is where a deployment's preset packs join the
 * catalog and where `catalogs.factoryPresets: false` removes it, so a second
 * reader would serve the bundled presets around both — on a deployment that
 * switched them off, or without the presets it registered. Every surface that
 * lists or resolves factory presets (the REST catalog, the MCP preset tools,
 * `resolvePreset`) asks `presetCatalog` instead.
 *
 * The watched names are the ones the funnel itself imports from
 * `@nodaro/prompts/presets` to read the catalog, so a new way in that the
 * funnel starts using is watched by construction. Tests are not product
 * readers and are not scanned. Its reach: an identifier written in source
 * (comments stripped) — not a name assembled at run time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..", "..", "..")
const FUNNEL = "lib/presets/app-presets.ts"

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || path === join(SRC, "test")) continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** Source without its comments (strings kept: a name in a string is a read too). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
}

/** The value names the funnel imports from the presets entry. */
function catalogReaders(): string[] {
  const funnel = readFileSync(join(SRC, FUNNEL), "utf8")
  const imports = [...funnel.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s*from\s*"@nodaro\/prompts\/presets"/g)]
  return imports
    .flatMap((m) => m[1]!.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("type "))
    .map((s) => s.split(/\s+as\s+/)[0]!.trim())
}

describe("presetCatalog is the one reader of the bundled factory presets", () => {
  const watched = catalogReaders()

  it("watches the names the funnel reads the catalog by", () => {
    expect(watched).toEqual(expect.arrayContaining(["getFactoryPresets", "FACTORY_PRESETS"]))
  })

  it("no other backend source reads the catalog", () => {
    const pattern = new RegExp(`\\b(${watched.join("|")})\\b`)
    const readers = sourceFiles(SRC)
      .map((path) => relative(SRC, path).split("\\").join("/"))
      .filter((file) => file !== FUNNEL && pattern.test(withoutComments(readFileSync(join(SRC, file), "utf8"))))
    expect(readers, "read factory presets through presetCatalog (lib/presets/app-presets.ts)").toEqual([])
  })
})
