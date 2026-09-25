#!/usr/bin/env -S npx --no tsx
// Builds the character-picker photos (frontend/public/picker-art/character/)
// and writes the content-hashed file map
// packages/picker-ui/src/icons/character-art-files.generated.ts.
//
// Dev-time only: the output is committed, so CI and the Docker build never run
// this. Give it a folder of new or replacement pictures:
//
//   npx --no tsx tools/picker-art/character-art.mts --src <dir>
//
// laid out as <family>/<optionId>.<png|jpg|jpeg|webp>, where <family> is a
// picker catalog id (person, styling, held-prop, materials, animals) or
// `sections` (the round icon of a picker section, named by its slug). Every
// option id is checked against the picker catalogs, so a typo fails the build.
//
// Pictures already published and not in --src are kept (an update can carry
// just the changed files); those whose option no longer exists are dropped.
// Run without --src to only re-check and prune.
//
// Output rules: native size capped at MAX_WIDTH (never enlarged), WebP, file
// name = ASCII-folded option id + the first 8 hex of the file's sha256, so the
// server can cache them as immutable. The set is built in tools/picker-art/.work/
// (outside public/) and published only when complete.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import sharp from "sharp"

if (process.env.CI) {
  console.error("tools/picker-art/character-art.mts is a dev-time script; its output is committed. Refusing to run in CI.")
  process.exit(1)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const WORK_DIR = join(ROOT, "tools/picker-art/.work")
const OUT_DIR = join(ROOT, "frontend/public/picker-art/character")
const GENERATED_TS = join(ROOT, "packages/picker-ui/src/icons/character-art-files.generated.ts")

const CATALOG_FAMILIES = ["person", "styling", "held-prop", "materials", "animals"] as const
const SECTIONS = "sections"
const FAMILIES: ReadonlyArray<string> = [...CATALOG_FAMILIES, SECTIONS]
const SOURCE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"])
const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_SOURCE_SIDE = 4096
const MAX_WIDTH = 480
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** The only names this build writes — and so the only ones it may delete. */
const OUTPUT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[0-9a-f]{8}\.webp$/
/** OS clutter a copied folder tends to carry (dotfiles, Thumbs.db, desktop.ini); skipped, never an error. */
const IGNORED_SOURCE = /^(\..*|thumbs\.db|desktop\.ini)$/i

type FileMap = Record<string, Record<string, string>>

function parseArgs(argv: ReadonlyArray<string>): { src?: string } {
  const at = argv.indexOf("--src")
  if (at === -1) return {}
  const src = argv[at + 1]
  if (!src) throw new Error("--src needs a folder")
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`--src ${src} is not a folder`)
  return { src }
}

/** ASCII file stem for an option id ("madrileña" → "madrilena"). */
function fileStem(id: string): string {
  const stem = id.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!SLUG.test(stem)) throw new Error(`option id "${id}" does not fold to a usable file name`)
  return stem
}

/** Every option id of each catalog family, read from the picker catalogs funnel. */
async function catalogIds(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const prompts = (await import(pathToFileURL(join(ROOT, "packages/prompts/src/index.ts")).href)) as {
    PICKER_CATALOGS: ReadonlyArray<{
      catalogId: string
      options?: ReadonlyArray<{ id: string }>
      dimensions?: ReadonlyArray<{ options: ReadonlyArray<{ id: string }> }>
    }>
  }
  const out = new Map<string, ReadonlySet<string>>()
  for (const family of CATALOG_FAMILIES) {
    const catalog = prompts.PICKER_CATALOGS.find((c) => c.catalogId === family)
    if (!catalog) throw new Error(`no picker catalog "${family}"`)
    const options = catalog.dimensions ? catalog.dimensions.flatMap((d) => d.options) : (catalog.options ?? [])
    out.set(family, new Set(options.map((o) => o.id)))
  }
  return out
}

/** The map the last build published (empty on the first run). */
async function publishedMap(): Promise<FileMap> {
  if (!existsSync(GENERATED_TS)) return {}
  const mod = (await import(pathToFileURL(GENERATED_TS).href)) as { CHARACTER_ART_FILES: FileMap }
  return mod.CHARACTER_ART_FILES
}

/** Source pictures under --src, keyed "<family>/<id>". */
function readSources(src: string, ids: ReadonlyMap<string, ReadonlySet<string>>): Map<string, string> {
  const out = new Map<string, string>()
  for (const family of readdirSync(src)) {
    const dir = join(src, family)
    if (!statSync(dir).isDirectory()) continue
    if (!FAMILIES.includes(family)) throw new Error(`unknown family folder "${family}" (expected one of ${FAMILIES.join(", ")})`)
    for (const name of readdirSync(dir)) {
      if (IGNORED_SOURCE.test(name)) continue
      const path = join(dir, name)
      const ext = extname(name).toLowerCase()
      if (!statSync(path).isFile() || !SOURCE_EXTS.has(ext)) throw new Error(`${family}/${name}: not a .png/.jpg/.webp file`)
      const id = basename(name, extname(name)).normalize("NFC")
      if (family === SECTIONS ? !SLUG.test(id) : !ids.get(family)?.has(id)) {
        throw new Error(`${family}/${name}: "${id}" is not ${family === SECTIONS ? "a section slug" : `an option of the ${family} catalog`}`)
      }
      const key = `${family}/${id}`
      if (out.has(key)) throw new Error(`${key} has more than one source file`)
      out.set(key, path)
    }
  }
  return out
}

async function encode(path: string): Promise<Buffer> {
  const bytes = readFileSync(path)
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) throw new Error(`${path}: size ${bytes.length} is out of range`)
  const meta = await sharp(bytes).metadata()
  if (!meta.width || !meta.height || meta.width > MAX_SOURCE_SIDE || meta.height > MAX_SOURCE_SIDE) {
    throw new Error(`${path}: ${meta.width}x${meta.height} is not a usable picture`)
  }
  const out = await sharp(bytes)
    .rotate() // apply an EXIF orientation before the metadata is dropped
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80, alphaQuality: 80, effort: 6 })
    .toBuffer()
  const check = await sharp(out).metadata()
  if (check.format !== "webp" || !check.width || !check.height) throw new Error(`${path}: encoded output is not a valid WebP`)
  return out
}

/** Relative paths ("person/x.webp") of the files under `root`, one level of family folders deep; links are never followed. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((family) => family.isDirectory() && FAMILIES.includes(family.name))
    .flatMap((family) =>
      readdirSync(join(root, family.name), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${family.name}/${entry.name}`),
    )
}

/**
 * Make OUT_DIR hold exactly the finished build (never renames the watched
 * folder). Only files this build could have written — a known family folder
 * and a `<slug>.<hash8>.webp` name — are ever deleted; anything else found
 * there is left alone.
 */
function publish(build: string): void {
  mkdirSync(OUT_DIR, { recursive: true })
  const wanted = new Set(filesUnder(build))
  for (const rel of filesUnder(OUT_DIR)) {
    if (!wanted.has(rel) && OUTPUT_NAME.test(rel.slice(rel.indexOf("/") + 1))) rmSync(join(OUT_DIR, rel))
  }
  for (const rel of wanted) {
    mkdirSync(dirname(join(OUT_DIR, rel)), { recursive: true })
    copyFileSync(join(build, rel), join(OUT_DIR, rel))
  }
}

async function buildInto(build: string, sources: ReadonlyMap<string, string>, ids: ReadonlyMap<string, ReadonlySet<string>>): Promise<FileMap> {
  const previous = await publishedMap()
  const map: FileMap = {}
  let encoded = 0
  let kept = 0
  const dropped: string[] = []

  const place = (family: string, id: string, bytes: Buffer): void => {
    const file = `${fileStem(id)}.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}`
    const byId = (map[family] ??= {})
    if (Object.values(byId).some((f) => f.slice(0, -9) === file.slice(0, -9))) {
      throw new Error(`${family}/${id}: file name "${fileStem(id)}" collides with another option`)
    }
    mkdirSync(join(build, family), { recursive: true })
    writeFileSync(join(build, family, `${file}.webp`), bytes)
    byId[id] = file
  }

  for (const [key, path] of sources) {
    const [family, id] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)]
    place(family, id, await encode(path))
    encoded++
  }
  for (const [family, byId] of Object.entries(previous)) {
    for (const [id, file] of Object.entries(byId)) {
      if (sources.has(`${family}/${id}`)) continue
      if (family !== SECTIONS && !ids.get(family)?.has(id)) {
        dropped.push(`${family}/${id}`)
        continue
      }
      const path = join(OUT_DIR, family, `${file}.webp`)
      if (!existsSync(path)) throw new Error(`${family}/${id}: published file ${file}.webp is missing — re-run with its source`)
      place(family, id, readFileSync(path))
      kept++
    }
  }
  console.log(`character-art: ${encoded} encoded, ${kept} kept${dropped.length ? `, dropped (option removed): ${dropped.join(", ")}` : ""}`)
  return map
}

function writeGenerated(map: FileMap): void {
  const families = Object.keys(map).sort()
  const body = families
    .map((family) => {
      const rows = Object.keys(map[family])
        .sort()
        .map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(map[family][id])},`)
      return `  ${JSON.stringify(family)}: {\n${rows.join("\n")}\n  },`
    })
    .join("\n")
  writeFileSync(
    GENERATED_TS,
    `// GENERATED by tools/picker-art/character-art.mts — do not edit. Family → option\n` +
      `// id → content-hashed file stem under frontend/public/picker-art/character/<family>/.\n` +
      `export const CHARACTER_ART_FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {\n${body}\n}\n`,
  )
}

async function main(): Promise<void> {
  const { src } = parseArgs(process.argv.slice(2))
  const ids = await catalogIds()
  const sources = src ? readSources(src, ids) : new Map<string, string>()
  const build = join(WORK_DIR, `character-${process.pid}`)
  rmSync(build, { recursive: true, force: true })
  let map: FileMap
  try {
    map = await buildInto(build, sources, ids)
  } catch (err) {
    rmSync(build, { recursive: true, force: true })
    throw err
  }
  publish(build)
  rmSync(build, { recursive: true, force: true })
  writeGenerated(map)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
