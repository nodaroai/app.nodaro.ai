// @test-watches backend/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs} backend/scripts/**/*.{ts,tsx,mts,cts,js,mjs,cjs} packages/prompts/package.json
/**
 * Which pictures a picker catalog reply carries is decided in ONE place on the
 * server, `lib/picker-images.ts` (`pickerImageOptions`, which reads the
 * deployment's `catalogs.images`). This guard keeps every other way to a
 * picture shut, so a deployment that turned the platform's pictures off can
 * never get one back through a new route, tool or script:
 *
 * 1. Only picker-images.ts imports the platform's picture maps
 *    (`@nodaro/prompts/picker-art`, the package root that re-exports it, or a
 *    path into the package's files), and from there it takes only the options
 *    type and the URL resize helper.
 * 2. Only picker-images.ts asks for the setting (`surfaceCatalogImages`), and
 *    nothing but surface-profile.ts reads `catalogs.images` off the profile.
 * 3. Every catalog projection (`projectPickerCatalog`, `projectAllCatalogs`,
 *    `summarizePickerCatalogs`) is called directly, under its own name. Its
 *    options are an object literal whose `images`, when it has one, is
 *    `pickerImageOptions(…)`, with no spread after it, or without it, that could
 *    carry another `images`. Options without `images` picture nothing.
 * 4. No other @nodaro/prompts entry hands out the same picture maps or helpers.
 *
 * Test files are not scanned: they may mock or read anything.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import ts from "typescript"
import * as pickerArt from "@nodaro/prompts/picker-art"
import * as assembly from "@nodaro/prompts/assembly"
import * as catalogPacks from "@nodaro/prompts/catalog-packs"
import * as doctrine from "@nodaro/prompts/doctrine"
import * as person from "@nodaro/prompts/person"
import * as pickerCatalogs from "@nodaro/prompts/picker-catalogs"
import * as pickers from "@nodaro/prompts/pickers"
import * as presets from "@nodaro/prompts/presets"
import * as promptBuilder from "@nodaro/prompts/prompt-builder"
import * as promptFields from "@nodaro/prompts/prompt-fields"

const OTHER_ENTRIES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "./assembly": assembly,
  "./catalog-packs": catalogPacks,
  "./doctrine": doctrine,
  "./person": person,
  "./picker-catalogs": pickerCatalogs,
  "./pickers": pickers,
  "./presets": presets,
  "./prompt-builder": promptBuilder,
  "./prompt-fields": promptFields,
}

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const REPO = join(BACKEND, "..")

/** The one file that decides, and the one that reads the setting off the profile. */
const DECIDER = "src/lib/picker-images.ts"
const PROFILE = "src/lib/surface-profile.ts"
/** What the decider may take from the picture maps' module. */
const DECIDER_TAKES = ["PickerImageOptions", "lookPreviewStillUrl"]

/** Each projection and the index of its options argument. */
const PROJECTIONS: Readonly<Record<string, number>> = {
  projectPickerCatalog: 1,
  projectAllCatalogs: 0,
  summarizePickerCatalogs: 0,
}
const GATE = "pickerImageOptions"
const SETTING = "surfaceCatalogImages"
const isProjection = (name: string): boolean => Object.hasOwn(PROJECTIONS, name)

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/
const SKIPPED_DIRS = new Set(["__tests__", "node_modules", "dist"])
/** The test setup and helpers (src/test/): test code, like __tests__. */
const TEST_SUPPORT = join(BACKEND, "src", "test")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) || path === TEST_SUPPORT ? [] : sourceFiles(path)
    if (!SOURCE.test(entry.name) || /\.d\.[cm]?ts$/.test(entry.name) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return []
    return [path]
  })
}

/** A module that hands out the platform's picture maps (or could: the root, the package's own files). */
function isPictureModule(spec: string): boolean {
  return (
    spec === "@nodaro/prompts" ||
    spec === "@nodaro/prompts/picker-art" ||
    spec.startsWith("@nodaro/prompts/picker-art/") ||
    /^@nodaro\/prompts\/(dist|src)(\/|$)/.test(spec) ||
    /(^|\/)packages\/prompts\/(dist|src)(\/|$)/.test(spec)
  )
}
const isProjectionModule = (spec: string): boolean => spec === "@nodaro/prompts/picker-catalogs"

interface ProjectionCall {
  readonly fn: string
  /** The `images` initializer as written, or "no options" / "no images". */
  readonly images: string
}

interface Scan {
  readonly violations: string[]
  /** Names this file takes from the picture maps' module. */
  readonly pictureNames: string[]
  readonly projectionCalls: ProjectionCall[]
  readonly settingRefs: number
  readonly catalogsImagesReads: number
}

function moduleSpecifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression.text
  }
  if (ts.isCallExpression(node)) {
    const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
    const required = ts.isIdentifier(node.expression) && node.expression.text === "require"
    const arg = node.arguments[0]
    if ((dynamic || required) && arg && ts.isStringLiteralLike(arg)) return arg.text
  }
  return undefined
}

/** The names an import / re-export takes ("*" for a namespace or `export *`, "default" for a default import). */
function namesTaken(node: ts.Node): string[] {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (!clause) return []
    const names: string[] = clause.name ? ["default"] : []
    const bindings = clause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) names.push("*")
    if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text)
    return names
  }
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause
    if (!clause || ts.isNamespaceExport(clause)) return ["*"]
    return clause.elements.map((el) => (el.propertyName ?? el.name).text)
  }
  return ["*"]
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

/** Checks one projection call's options; returns what it passes as `images`. */
function checkProjectionCall(call: ts.CallExpression, fn: string, source: ts.SourceFile, fail: (msg: string) => void): ProjectionCall {
  const options = call.arguments[PROJECTIONS[fn]!]
  if (!options) return { fn, images: "no options" }
  if (!ts.isObjectLiteralExpression(options)) {
    fail(`${fn}: its options are not an object literal (${options.getText(source)}), so their images cannot be checked`)
    return { fn, images: "?" }
  }
  let imagesAt = -1
  let images = "no images"
  options.properties.forEach((prop, i) => {
    if (ts.isSpreadAssignment(prop) || !prop.name) return
    if (ts.isComputedPropertyName(prop.name)) {
      fail(`${fn}: a computed option name (${prop.name.getText(source)}) could be images`)
      return
    }
    if (propertyNameText(prop.name) !== "images") return
    imagesAt = i
    if (!ts.isPropertyAssignment(prop)) {
      fail(`${fn}: images is not \`images: ${GATE}(…)\` (${prop.getText(source)})`)
      return
    }
    images = prop.initializer.getText(source)
    const init = prop.initializer
    if (!(ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === GATE)) {
      fail(`${fn}: images is ${images}, not ${GATE}(…)`)
    }
  })
  options.properties.forEach((prop, i) => {
    if (!ts.isSpreadAssignment(prop)) return
    if (imagesAt === -1) fail(`${fn}: a spread (${prop.getText(source)}) with no images after it could carry images`)
    else if (i > imagesAt) fail(`${fn}: a spread (${prop.getText(source)}) after images could replace it`)
  })
  return { fn, images }
}

/** Scans one file. `file` is its path relative to backend/. Pure, so the self-test can feed it snippets. */
function scanFile(file: string, text: string): Scan {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : undefined)
  const violations: string[] = []
  const pictureNames: string[] = []
  const projectionCalls: ProjectionCall[] = []
  let settingRefs = 0
  let catalogsImagesReads = 0
  const fail = (node: ts.Node, msg: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    violations.push(`${file}:${line + 1} ${msg}`)
  }

  const visit = (node: ts.Node): void => {
    const spec = moduleSpecifierOf(node)
    if (spec !== undefined && isPictureModule(spec)) {
      if (file !== DECIDER) fail(node, `imports the picture maps' module "${spec}": only ${DECIDER} may (ask ${GATE}() instead)`)
      else pictureNames.push(...namesTaken(node))
    }
    if (spec !== undefined && isProjectionModule(spec)) {
      const taken = namesTaken(node)
      if (taken.includes("*") || taken.includes("default")) {
        fail(node, `takes "${spec}" whole (a namespace, a default or a dynamic import), which hides its projections from this guard: import them by name`)
      }
      if (ts.isExportDeclaration(node) && taken.some(isProjection)) fail(node, `re-exports a catalog projection from "${spec}"`)
    }

    if (ts.isIdentifier(node) && isProjection(node.text)) {
      const parent = node.parent
      if (ts.isImportSpecifier(parent)) {
        if (parent.propertyName) fail(node, `imports ${parent.propertyName.text} as ${parent.name.text}: a renamed projection escapes this guard`)
      } else if (ts.isExportSpecifier(parent)) {
        fail(node, `re-exports ${node.text}`)
      } else if (ts.isCallExpression(parent) && parent.expression === node) {
        projectionCalls.push(checkProjectionCall(parent, node.text, source, (msg) => fail(parent, msg)))
      } else if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        fail(node, `reaches ${node.text} through an object (${parent.getText(source)}): call it by its imported name`)
      } else {
        fail(node, `uses ${node.text} without calling it (${parent.getText(source).slice(0, 80)})`)
      }
    }

    if (ts.isIdentifier(node) && node.text === SETTING) {
      settingRefs += 1
      const declaredHere = file === PROFILE && ts.isFunctionDeclaration(node.parent) && node.parent.name === node
      if (!declaredHere && file !== DECIDER) fail(node, `asks for ${SETTING}: only ${DECIDER} decides the pictures (ask ${GATE}() instead)`)
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "images" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catalogs"
    ) {
      catalogsImagesReads += 1
      if (file !== PROFILE) fail(node, `reads catalogs.images off the profile: only ${PROFILE} (${SETTING}) may`)
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
  return { violations, pictureNames, projectionCalls, settingRefs, catalogsImagesReads }
}

function scanBackend(): Map<string, Scan> {
  const scans = new Map<string, Scan>()
  for (const path of [...sourceFiles(join(BACKEND, "src")), ...sourceFiles(join(BACKEND, "scripts"))]) {
    const text = readFileSync(path, "utf8")
    // Every rule below needs one of these words in the file; skip parsing the rest.
    if (!/picker-art|@nodaro\/prompts|packages\/prompts|catalogs|surfaceCatalogImages|projectPickerCatalog|projectAllCatalogs|summarizePickerCatalogs/.test(text)) continue
    const file = relative(BACKEND, path).split(sep).join("/")
    scans.set(file, scanFile(file, text))
  }
  return scans
}

describe("picker pictures have one decider on the server", () => {
  const scans = scanBackend()

  it("scans the decider, the profile reader and every file that calls a projection", () => {
    expect(scans.has(DECIDER)).toBe(true)
    expect(scans.has(PROFILE)).toBe(true)
    expect(scans.has("src/routes/picker-catalogs.ts")).toBe(true)
  })

  it("breaks none of the rules", () => {
    expect([...scans.values()].flatMap((s) => s.violations)).toEqual([])
  })

  it("the decider takes only the options type and the resize helper from the picture maps' module", () => {
    expect([...scans.get(DECIDER)!.pictureNames].sort()).toEqual([...DECIDER_TAKES].sort())
  })

  it("the setting is declared once and asked for once, by the decider", () => {
    const refs = Object.fromEntries([...scans].filter(([, s]) => s.settingRefs > 0).map(([f, s]) => [f, s.settingRefs]))
    // picker-images.ts: its import and its one call.
    expect(refs).toEqual({ [PROFILE]: 1, [DECIDER]: 2 })
    const reads = Object.fromEntries([...scans].filter(([, s]) => s.catalogsImagesReads > 0).map(([f, s]) => [f, s.catalogsImagesReads]))
    expect(reads).toEqual({ [PROFILE]: 1 })
  })

  it("finds every catalog projection call (a new one is a deliberate change to this list)", () => {
    const calls = [...scans].flatMap(([file, s]) => s.projectionCalls.map((c) => `${file} ${c.fn}: ${c.images}`)).sort()
    expect(calls).toEqual(
      [
        `src/lib/mcp/tools/picker-catalogs.ts projectPickerCatalog: ${GATE}()`,
        `src/lib/mcp/tools/picker-catalogs.ts summarizePickerCatalogs: ${GATE}()`,
        // The unknown-type error lists the valid types: no pictures asked for.
        "src/lib/mcp/tools/picker-catalogs.ts summarizePickerCatalogs: no options",
        `src/routes/catalogs.ts projectAllCatalogs: ${GATE}({ srcSet: true })`,
        `src/routes/picker-catalogs.ts projectPickerCatalog: ${GATE}({ srcSet: true })`,
        `src/routes/picker-catalogs.ts summarizePickerCatalogs: ${GATE}()`,
      ].sort(),
    )
  })
})

describe("the guard's own matching", () => {
  const ok = (file: string, text: string) => expect(scanFile(file, text).violations).toEqual([])
  const flags = (file: string, text: string, pattern: RegExp) => {
    const { violations } = scanFile(file, text)
    expect(violations.length, text).toBeGreaterThan(0)
    expect(violations.join("\n"), text).toMatch(pattern)
  }
  const IMPORT = 'import { projectAllCatalogs, projectPickerCatalog, summarizePickerCatalogs } from "@nodaro/prompts/picker-catalogs"\n'

  it("accepts the shapes the routes use", () => {
    ok("src/routes/x.ts", `${IMPORT}projectAllCatalogs({ ...q.data, images: pickerImageOptions({ srcSet: true }) })`)
    ok("src/routes/x.ts", `${IMPORT}projectPickerCatalog(c, { detail: "full", images: pickerImageOptions() })`)
    ok("src/routes/x.ts", `${IMPORT}summarizePickerCatalogs()`)
    ok("src/routes/x.ts", `${IMPORT}summarizePickerCatalogs({})`)
    ok("src/routes/x.ts", 'import { getPickerCatalog } from "@nodaro/prompts/picker-catalogs"\ngetPickerCatalog("mood")')
    ok(DECIDER, 'import type { PickerImageOptions } from "@nodaro/prompts/picker-art"\nexport { lookPreviewStillUrl } from "@nodaro/prompts/picker-art"\nsurfaceCatalogImages()')
  })

  it("flags images that are not the decider's", () => {
    flags("src/routes/x.ts", `${IMPORT}projectAllCatalogs({ images: someOptions })`, /not pickerImageOptions/)
    flags("src/routes/x.ts", `${IMPORT}projectPickerCatalog(c, { images })`, /images is not/)
    flags("src/routes/x.ts", `${IMPORT}projectPickerCatalog(c, { images: { baseUrl: "https://x" } })`, /not pickerImageOptions/)
    flags("src/routes/x.ts", `${IMPORT}summarizePickerCatalogs({ "images": other() })`, /not pickerImageOptions/)
    flags("src/routes/x.ts", `${IMPORT}summarizePickerCatalogs({ [key]: pickerImageOptions() })`, /computed option name/)
  })

  it("flags options that could carry images past the check", () => {
    flags("src/routes/x.ts", `${IMPORT}projectAllCatalogs(opts)`, /not an object literal/)
    flags("src/routes/x.ts", `${IMPORT}projectAllCatalogs({ ...rest })`, /no images after it/)
    flags("src/routes/x.ts", `${IMPORT}projectAllCatalogs({ images: pickerImageOptions(), ...rest })`, /after images/)
  })

  it("flags a projection reached by another name or not called", () => {
    flags("src/routes/x.ts", 'import { projectAllCatalogs as all } from "@nodaro/prompts/picker-catalogs"\nall({})', /renamed projection/)
    flags("src/routes/x.ts", `${IMPORT}const f = summarizePickerCatalogs\nf({ images: x })`, /without calling it/)
    flags("src/routes/x.ts", `${IMPORT}[1].map(projectAllCatalogs)`, /without calling it/)
    flags("src/routes/x.ts", 'import * as pc from "@nodaro/prompts/picker-catalogs"\npc.projectAllCatalogs({ images: x })', /whole|through an object/)
    flags("src/routes/x.ts", 'const pc = await import("@nodaro/prompts/picker-catalogs")', /whole/)
    flags("src/routes/x.ts", 'export { projectAllCatalogs } from "@nodaro/prompts/picker-catalogs"', /re-exports/)
  })

  it("flags the picture maps' module anywhere but the decider", () => {
    flags("src/routes/x.ts", 'import { LOOK_PREVIEW_SETS } from "@nodaro/prompts/picker-art"', /picture maps/)
    flags("src/routes/x.ts", 'import type { PickerImageOptions } from "@nodaro/prompts/picker-art"', /picture maps/)
    flags("src/routes/x.ts", 'import { CHARACTER_ART_FILES } from "@nodaro/prompts"', /picture maps/)
    flags("src/routes/x.ts", 'const m = await import("@nodaro/prompts/picker-art")', /picture maps/)
    flags("src/routes/x.ts", 'const m = require("@nodaro/prompts/picker-art")', /picture maps/)
    flags("src/routes/x.ts", 'export * from "@nodaro/prompts/picker-art"', /picture maps/)
    flags("src/routes/x.ts", 'import { SOUND_ART } from "../../../packages/prompts/src/picker-art/index.js"', /picture maps/)
    flags("scripts/x.mts", 'import { SOUND_ART } from "@nodaro/prompts/dist/index.js"', /picture maps/)
    expect(scanFile(DECIDER, 'export * from "@nodaro/prompts/picker-art"').pictureNames).toEqual(["*"])
  })

  it("flags the setting read anywhere but the decider", () => {
    flags("src/routes/x.ts", 'import { surfaceCatalogImages } from "../lib/surface-profile.js"\nsurfaceCatalogImages()', /only src\/lib\/picker-images.ts decides/)
    flags("src/routes/x.ts", 'runtimeSurfaceProfile().catalogs?.images', /reads catalogs.images/)
    flags("src/routes/x.ts", 'profile.catalogs.images', /reads catalogs.images/)
  })
})

describe("no other @nodaro/prompts entry hands out the picture maps", () => {
  it("every entry is checked here", () => {
    const manifest = JSON.parse(readFileSync(join(REPO, "packages/prompts/package.json"), "utf8")) as { exports: Record<string, unknown> }
    const entries = Object.keys(manifest.exports).filter((k) => k !== "." && k !== "./package.json").sort()
    expect(entries).toEqual(Object.keys(OTHER_ENTRIES).concat("./picker-art").sort())
  })

  it("none exports a map or helper of @nodaro/prompts/picker-art", () => {
    const art = new Map<unknown, string>()
    for (const [name, value] of Object.entries(pickerArt)) {
      if ((typeof value === "object" && value !== null) || typeof value === "function") art.set(value, name)
    }
    expect(art.size).toBeGreaterThan(5)
    const leaks = Object.entries(OTHER_ENTRIES).flatMap(([entry, mod]) =>
      Object.entries(mod)
        .filter(([, value]) => art.has(value))
        .map(([name, value]) => `${entry} exports ${name} (picker-art's ${art.get(value)})`),
    )
    expect(leaks).toEqual([])
  })
})
