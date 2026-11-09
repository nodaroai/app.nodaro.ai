// @test-watches frontend/src/**/*.{ts,tsx}
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A deployment names the languages a visitor may pick (`locale.offered`), and
 * every language list in the app honours it through ONE helper,
 * `languageMenuRows` (`lib/i18n/offered-locales.ts`), which `useUiLanguage`
 * hands out as `rows`. A new picker that walks the registry, or that narrows
 * for itself, would offer every language the product ships, and picking one
 * switches the whole interface. So this fails the build on either.
 *
 * Reading ONE language's row (`LANGUAGES.find`) lists nothing and is fine.
 */

const SRC = join(__dirname, "..", "..", "..")

/**
 * Sources that may iterate the registry or read the deployment's list, each
 * for a reason that is not "offering languages to a viewer".
 */
const EXEMPT: Record<string, string> = {
  "lib/i18n/offered-locales.ts": "the funnel itself",
  "lib/i18n/index.ts": "defines registeredChromeLocales (and re-exports the funnel)",
  "lib/surface-selectors.ts": "defines the locale.offered selector the funnel reads",
  "lib/locale-store.ts": "matches a saved or detected tag against the registry; lists nothing",
}
/** The operator's own screens: per-language CONTENT authoring (a trend's text in every language), not the interface language. */
const EXEMPT_DIRS = ["ee/app/(admin)/"]

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : []
  })
}

/** Walks the registry as a list. `LANGUAGES` is only the registry where the file imports it from the i18n entry. */
const WALKS_REGISTRY = /(?<![\w.])LANGUAGES\s*\.\s*(?:map|flatMap|filter|forEach|reduce|some|every|slice|entries|values|keys)\s*\(|\bof\s+LANGUAGES\b|\.\.\.LANGUAGES\b|Object\.(?:entries|values|keys)\(\s*LANGUAGES\b/
const IMPORTS_REGISTRY = /\bimport\s*\{[^}]*\bLANGUAGES\b[^}]*\}\s*from\s*["']@nodaro\/shared\/i18n["']/
/** Another way to a language list that skips the narrowing, or narrows on its own: the app's offered list, the deployment's own, the registered dictionaries, the platform's list. */
const BYPASSES = /\bofferedLanguages\s*\(|\bsurfaceLocaleOffered\s*\(|\bregisteredChromeLocales\s*\(|\bPLATFORM_LANGUAGES\s*\.\s*(?:map|flatMap|filter|forEach)\s*\(/

function offendingLines(source: string): readonly string[] {
  const registryImported = IMPORTS_REGISTRY.test(source)
  return source.split("\n").filter((line) => {
    const code = line.trimStart()
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*") || code.startsWith("import ")) return false
    return (registryImported && WALKS_REGISTRY.test(line)) || BYPASSES.test(line)
  })
}

describe("every language list in the app goes through languageMenuRows", () => {
  it("no source walks the language registry or narrows it for itself", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const rel = relative(SRC, file).replaceAll("\\", "/")
      if (EXEMPT[rel] !== undefined || EXEMPT_DIRS.some((dir) => rel.startsWith(dir))) return []
      return offendingLines(readFileSync(file, "utf8")).map((line) => `${rel}: ${line.trim()}`)
    })
    expect(
      offenders,
      `A language list must come from languageMenuRows (lib/i18n/offered-locales.ts) or useUiLanguage().rows, so a deployment's locale.offered reaches it. Found:\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("the scan catches what it says it catches", () => {
    const withRegistry = (body: string) => `import { LANGUAGES } from "@nodaro/shared/i18n"\n${body}`
    expect(offendingLines(withRegistry("const a = LANGUAGES.map((l) => l.id)"))).toHaveLength(1)
    expect(offendingLines(withRegistry("for (const l of LANGUAGES) x(l)"))).toHaveLength(1)
    expect(offendingLines(withRegistry("const a = [...LANGUAGES]"))).toHaveLength(1)
    expect(offendingLines("const a = offeredLanguages().map((l) => l)")).toHaveLength(1)
    expect(offendingLines("const a = surfaceLocaleOffered()?.includes(x)")).toHaveLength(1)
    expect(offendingLines("const a = registeredChromeLocales().map((l) => l)")).toHaveLength(1)
    expect(offendingLines("const a = PLATFORM_LANGUAGES.map((l) => l)")).toHaveLength(1)
    // Reading one row lists nothing; a registry of another domain is another domain.
    expect(offendingLines(withRegistry("const c = LANGUAGES.find((l) => l.id === locale) ?? LANGUAGES[0]"))).toEqual([])
    expect(offendingLines("const ALL = ALL_LANGUAGES.map((l) => l)")).toEqual([])
    expect(offendingLines("const a = languageMenuRows(locale).map((l) => l)")).toEqual([])
  })
})
