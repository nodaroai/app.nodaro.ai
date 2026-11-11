// @test-watches frontend/src/**/*.{ts,tsx,mts,js,mjs} packages/picker-ui/src/**/*.{ts,tsx,mts,js,mjs}
/**
 * Which picker pictures the editor shows is decided in ONE place,
 * frontend/src/lib/look-previews-bootstrap.ts, from the deployment's
 * `catalogs.images` and the edition. This guard keeps every other way to a
 * platform picture shut, so a deployment that turned them off never shows one:
 *
 * App (frontend/src):
 *  1. Only the bootstrap reads the setting (`surfaceCatalogImages`, declared in
 *     surface-selectors.ts, the one reader of `catalogs.images`) and throws the
 *     two switches: `registerLookPreviews` (the renders on the Nodaro CDN) and
 *     `setPlatformPickerPictures` (the self-hosted photos, emoji and flags).
 *     It alone names the render sets.
 *  2. Nothing imports the picture maps' module (`@nodaro/prompts/picker-art`,
 *     the package root, or the package's own files), names a picture map or
 *     base path picker-ui hands out, or writes a /picker-art/ address: a
 *     picture comes through picker-ui's helpers, which follow the switch.
 *
 * picker-ui (packages/picker-ui/src):
 *  3. Only the picture helpers (icons/character-art.ts, icons/sound-art.ts)
 *     and the render sets' re-export (look-previews/sets.ts) import the maps'
 *     module, each taking only the names listed here.
 *  4. Every use of a picture path builder or file map sits in a function that
 *     asks `platformPickerPicturesShown()`, and no other file names the maps,
 *     the base paths or the render sets, throws a switch, or writes a
 *     /picker-art/ address.
 *
 * Test files are not scanned.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import ts from "typescript"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const BOOTSTRAP = "frontend/src/lib/look-previews-bootstrap.ts"
const SELECTORS = "frontend/src/lib/surface-selectors.ts"

const SOURCE = /\.(ts|tsx|mts|js|mjs)$/
const SKIPPED_DIRS = new Set(["__tests__", "node_modules", "dist"])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) || path === join(REPO, "frontend/src/test") ? [] : sourceFiles(path)
    if (!SOURCE.test(entry.name) || /\.d\.[cm]?ts$/.test(entry.name) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return []
    return [path]
  })
}

function isPictureModule(spec: string): boolean {
  return (
    spec === "@nodaro/prompts" ||
    spec === "@nodaro/prompts/picker-art" ||
    spec.startsWith("@nodaro/prompts/picker-art/") ||
    /^@nodaro\/prompts\/(dist|src)(\/|$)/.test(spec) ||
    /(^|\/)packages\/prompts\/(dist|src)(\/|$)/.test(spec)
  )
}

/** Names the bootstrap alone may use in the app. */
const BOOTSTRAP_ONLY = ["registerLookPreviews", "setPlatformPickerPictures", "LOOK_PREVIEW_SETS", "SOUND_RENDER_SETS"]
/** Names no app file may use: a map or base path would build a picture address past the switch. */
const APP_NEVER = [
  "CHARACTER_ART_BASE",
  "SOUND_ART_BASE",
  "SOUND_ART",
  "SOUND_ART_FILES",
  "CHARACTER_ART_FILES",
  "characterArtPath",
  "characterSectionArtPath",
  "soundArtFilePath",
  "soundArtPath",
  "resetPlatformPickerPicturesForTests",
  "resetLookPreviewsForTests",
]
/** picker-ui: what each file may take from the picture maps' module. */
const PICKER_UI_TAKES: Readonly<Record<string, readonly string[]>> = {
  "packages/picker-ui/src/icons/character-art.ts": [
    "CHARACTER_ART_FILES",
    "CHARACTER_ART_PATH",
    "CharacterArtFamily",
    "characterArtPath",
    "characterSectionArtPath",
    "characterSectionSlug",
  ],
  "packages/picker-ui/src/icons/sound-art.ts": [
    "PICKER_ART_PATH",
    "SOUND_ART",
    "SoundArtCatalogId",
    "SoundArtFields",
    "SoundArtKey",
    "SoundArtMap",
    "soundArtFilePath",
  ],
  "packages/picker-ui/src/look-previews/sets.ts": ["LOOK_PREVIEW_SETS", "SOUND_RENDER_SETS"],
}
const PICTURE_HELPERS = ["packages/picker-ui/src/icons/character-art.ts", "packages/picker-ui/src/icons/sound-art.ts"]
/** picker-ui: a use of one of these must sit in a function that asks the switch. */
const GATED = ["characterArtPath", "characterSectionArtPath", "soundArtFilePath", "soundArtPath", "CHARACTER_ART_FILES", "SOUND_ART_FILES"]
/** picker-ui: names only their own module (or the helpers / the sets' re-export) may use. */
const PICKER_UI_CONFINED: Readonly<Record<string, readonly string[]>> = {
  registerLookPreviews: ["packages/picker-ui/src/look-previews/registry.ts"],
  setPlatformPickerPictures: ["packages/picker-ui/src/icons/platform-pictures.ts"],
  LOOK_PREVIEW_SETS: ["packages/picker-ui/src/look-previews/sets.ts"],
  SOUND_RENDER_SETS: ["packages/picker-ui/src/look-previews/sets.ts"],
  CHARACTER_ART_BASE: PICTURE_HELPERS,
  SOUND_ART_BASE: PICTURE_HELPERS,
  SOUND_ART: PICTURE_HELPERS,
  CHARACTER_ART_PATH: PICTURE_HELPERS,
  PICKER_ART_PATH: PICTURE_HELPERS,
  ...Object.fromEntries(GATED.map((name) => [name, PICTURE_HELPERS])),
}
const SWITCH = "platformPickerPicturesShown"

interface Scan {
  readonly violations: string[]
  /** Names taken from the picture maps' module. */
  readonly pictureNames: string[]
  /** Identifier name → how often it appears (outside comments). */
  readonly names: Map<string, number>
}

function moduleSpecifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text
  }
  if (ts.isCallExpression(node)) {
    const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
    const required = ts.isIdentifier(node.expression) && node.expression.text === "require"
    const arg = node.arguments[0]
    if ((dynamic || required) && arg && ts.isStringLiteralLike(arg)) return arg.text
  }
  return undefined
}

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

/** The text of a literal piece of a string (a quoted string, a template's fixed parts, JSX text). */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) return node.text
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text
  return undefined
}

function enclosingFunctionAsks(node: ts.Node, source: ts.SourceFile): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isFunctionLike(at) && "body" in at && at.body) return at.body.getText(source).includes(`${SWITCH}()`)
  }
  return false
}

/** Scans one file; `file` is its path from the repo root. Pure, so the self-test can feed it snippets. */
function scanFile(file: string, text: string): Scan {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const app = file.startsWith("frontend/")
  const violations: string[] = []
  const pictureNames: string[] = []
  const names = new Map<string, number>()
  const fail = (node: ts.Node, msg: string) => {
    violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${msg}`)
  }

  const visit = (node: ts.Node): void => {
    const spec = moduleSpecifierOf(node)
    if (spec !== undefined && isPictureModule(spec)) {
      if (app || !(file in PICKER_UI_TAKES)) fail(node, `imports the picture maps' module "${spec}": take pictures from picker-ui's helpers, which follow the deployment's setting`)
      else pictureNames.push(...namesTaken(node))
    }

    const literal = literalText(node)
    if (literal !== undefined && literal.includes("/picker-art/")) {
      fail(node, `writes a /picker-art/ address: ask characterArtUrl / getSoundArt, which follow the deployment's setting`)
    }

    if (ts.isIdentifier(node)) {
      const name = node.text
      names.set(name, (names.get(name) ?? 0) + 1)
      if (app) {
        if (BOOTSTRAP_ONLY.includes(name) && file !== BOOTSTRAP) fail(node, `uses ${name}: only ${BOOTSTRAP} decides which picker pictures show`)
        if (name === "surfaceCatalogImages" && file !== BOOTSTRAP && file !== SELECTORS) fail(node, `asks for surfaceCatalogImages: only ${BOOTSTRAP} reads the picture setting`)
        if (APP_NEVER.includes(name)) fail(node, `uses ${name}, which would build a picture address past the deployment's setting`)
      } else {
        const allowed = PICKER_UI_CONFINED[name]
        if (allowed && !allowed.includes(file)) fail(node, `uses ${name} outside ${allowed.join(" / ")}`)
        if (GATED.includes(name) && PICTURE_HELPERS.includes(file)) {
          const inImport = ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent)
          if (!inImport && !enclosingFunctionAsks(node, source)) fail(node, `uses ${name} in a function that does not ask ${SWITCH}()`)
        }
      }
    }

    if (
      app &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "images" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catalogs" &&
      file !== SELECTORS
    ) {
      fail(node, `reads catalogs.images off the profile: only ${SELECTORS} (surfaceCatalogImages) may`)
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
  return { violations, pictureNames, names }
}

function scanAll(): Map<string, Scan> {
  const scans = new Map<string, Scan>()
  for (const root of ["frontend/src", "packages/picker-ui/src"]) {
    for (const path of sourceFiles(join(REPO, root))) {
      const file = relative(REPO, path).split(sep).join("/")
      scans.set(file, scanFile(file, readFileSync(path, "utf8")))
    }
  }
  return scans
}

describe("picker pictures have one decider in the editor", () => {
  const scans = scanAll()

  it("scans the app and picker-ui", () => {
    for (const file of [BOOTSTRAP, SELECTORS, ...Object.keys(PICKER_UI_TAKES)]) expect(scans.has(file), file).toBe(true)
    expect(scans.size).toBeGreaterThan(500)
  })

  it("breaks none of the rules", () => {
    expect([...scans.values()].flatMap((s) => s.violations)).toEqual([])
  })

  it("the bootstrap reads the setting and throws both switches", () => {
    const names = scans.get(BOOTSTRAP)!.names
    for (const name of ["surfaceCatalogImages", "setPlatformPickerPictures", "registerLookPreviews", "isCloud"]) {
      expect(names.get(name), name).toBeGreaterThanOrEqual(2)
    }
  })

  it("picker-ui takes from the picture maps' module only in its helpers, only these names", () => {
    const taken = Object.fromEntries(
      [...scans].filter(([, s]) => s.pictureNames.length > 0).map(([file, s]) => [file, [...new Set(s.pictureNames)].sort()]),
    )
    expect(taken).toEqual(Object.fromEntries(Object.entries(PICKER_UI_TAKES).map(([file, names]) => [file, [...names].sort()])))
  })
})

describe("the guard's own matching", () => {
  const flags = (file: string, text: string, pattern: RegExp) => {
    const { violations } = scanFile(file, text)
    expect(violations.length, text).toBeGreaterThan(0)
    expect(violations.join("\n"), text).toMatch(pattern)
  }
  const ok = (file: string, text: string) => expect(scanFile(file, text).violations).toEqual([])
  const APP = "frontend/src/components/x.tsx"
  const UI = "packages/picker-ui/src/pickers/x.tsx"

  it("accepts the shapes in use", () => {
    ok(APP, 'import { characterArtUrl } from "@nodaro/picker-ui"\nconst u = characterArtUrl("person", "man")')
    ok(BOOTSTRAP, 'import { registerLookPreviews, setPlatformPickerPictures, LOOK_PREVIEW_SETS } from "@nodaro/picker-ui"\nsetPlatformPickerPictures(surfaceCatalogImages() === "default")')
    ok(UI, 'import { characterArtUrl } from "../icons/character-art"\ncharacterArtUrl("person", id)')
    ok(PICTURE_HELPERS[0]!, 'import { characterArtPath } from "@nodaro/prompts/picker-art"\nexport function a(f, id) { return platformPickerPicturesShown() ? characterArtPath(f, id) : undefined }')
  })

  it("flags the app reaching a picture past the switch", () => {
    flags(APP, 'const src = "/picker-art/character/person/man.0000abcd.webp"', /\/picker-art\/ address/)
    flags(APP, "const src = `${base}/picker-art/x/${id}.webp`", /\/picker-art\/ address/)
    flags(APP, "const el = <img src={`/picker-art/${id}`} />", /\/picker-art\/ address/)
    flags(APP, 'import { SOUND_ART_FILES } from "@nodaro/prompts/picker-art"', /picture maps' module/)
    flags(APP, 'import { CHARACTER_ART_FILES } from "@nodaro/prompts"', /picture maps' module/)
    flags(APP, 'const m = await import("@nodaro/prompts/picker-art")', /picture maps' module/)
    flags(APP, 'import { CHARACTER_ART_BASE } from "@nodaro/picker-ui"\nconst u = CHARACTER_ART_BASE + id', /past the deployment's setting/)
    flags(APP, 'import { registerLookPreviews, LOOK_PREVIEW_SETS } from "@nodaro/picker-ui"\nregisterLookPreviews(LOOK_PREVIEW_SETS)', /only frontend\/src\/lib\/look-previews-bootstrap.ts decides/)
    flags(APP, 'import { setPlatformPickerPictures } from "@nodaro/picker-ui"\nsetPlatformPickerPictures(true)', /decides/)
    flags(APP, 'import { surfaceCatalogImages } from "@/lib/surface-selectors"\nif (surfaceCatalogImages() === "none") {}', /reads the picture setting/)
    flags(APP, "const v = runtimeSurfaceProfile().catalogs?.images", /reads catalogs.images/)
  })

  it("flags picker-ui reaching a picture past the switch", () => {
    flags(UI, 'import { CHARACTER_ART_FILES } from "@nodaro/prompts/picker-art"', /picture maps' module/)
    flags(UI, 'const src = "/picker-art/emoji/x.webp"', /\/picker-art\/ address/)
    flags(UI, 'import { SOUND_ART_BASE } from "../icons/sound-art"\nconst u = SOUND_ART_BASE + key', /uses SOUND_ART_BASE outside/)
    flags(UI, 'import { registerLookPreviews } from "../look-previews/registry"\nregisterLookPreviews({})', /uses registerLookPreviews outside/)
    flags(
      PICTURE_HELPERS[1]!,
      'import { soundArtFilePath } from "@nodaro/prompts/picker-art"\nexport function soundArtUrl(key) { return soundArtFilePath(key) }',
      /does not ask platformPickerPicturesShown/,
    )
    expect(scanFile(PICTURE_HELPERS[0]!, 'import { LOOK_PREVIEW_SETS } from "@nodaro/prompts/picker-art"').pictureNames).toEqual(["LOOK_PREVIEW_SETS"])
  })
})
