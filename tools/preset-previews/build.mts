#!/usr/bin/env -S npx --no tsx
// Builds the factory preset previews (frontend/public/preset-previews/) and
// writes the content-hashed file map
// packages/prompts/src/factory-presets/preview-files.generated.ts, which the
// API reads to hand out each factory preset's `previewUrl`.
//
// Dev-time only: the output is committed, so CI and the Docker build never run
// this. Give it a folder of new or replacement pictures:
//
//   npx --no tsx tools/preset-previews/build.mts --src <dir>
//
// laid out as <nodeType>/<slug>.<png|jpg|jpeg|webp>, where "<nodeType>/<slug>"
// is a factory preset id (generate-image/character-board → a file
// generate-image/character-board.webp). Every id is checked against the
// factory catalog, so a typo fails the build.
//
// Previews already published and not in --src are kept (an update can carry
// just the changed files); those whose preset no longer exists are dropped.
// `--remove <id>[,<id>…]` takes a preview away on purpose. Run with neither to
// only re-check and prune.
//
// Output rules: native size capped at MAX_WIDTH (never enlarged), WebP, file
// name = slug + the first 8 hex of the file's sha256, so the server can cache
// them as immutable and a regenerated picture gets a new URL. The set is built
// in tools/preset-previews/.work/ (outside public/) and published only when
// complete.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import sharp from "sharp"

if (process.env.CI) {
  console.error("tools/preset-previews/build.mts is a dev-time script; its output is committed. Refusing to run in CI.")
  process.exit(1)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const WORK_DIR = join(ROOT, "tools/preset-previews/.work")
const OUT_DIR = join(ROOT, "frontend/public/preset-previews")
const GENERATED_TS = join(ROOT, "packages/prompts/src/factory-presets/preview-files.generated.ts")

const SOURCE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"])
const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_SOURCE_SIDE = 4096
const MAX_WIDTH = 512
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** The only names this build writes — and so the only ones it may delete. */
const OUTPUT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[0-9a-f]{8}\.webp$/
/** OS clutter a copied folder tends to carry (dotfiles, Thumbs.db, desktop.ini); skipped, never an error. */
const IGNORED_SOURCE = /^(\..*|thumbs\.db|desktop\.ini)$/i

/** Preset id → `<nodeType>/<slug>.<hash8>.webp`. */
type FileMap = Record<string, string>

function parseArgs(argv: ReadonlyArray<string>): { src?: string; remove: string[] } {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag)
    if (at === -1) return undefined
    const v = argv[at + 1]
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`)
    return v
  }
  const src = value("--src")
  if (src !== undefined && (!existsSync(src) || !statSync(src).isDirectory())) throw new Error(`--src ${src} is not a folder`)
  const remove = (value("--remove") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return { src, remove }
}

/** Every factory preset id, from the catalog itself. */
async function factoryIds(): Promise<ReadonlySet<string>> {
  const presets = (await import(pathToFileURL(join(ROOT, "packages/prompts/src/factory-presets.ts")).href)) as {
    FACTORY_PRESETS: Readonly<Record<string, ReadonlyArray<{ id: string }>>>
  }
  return new Set(Object.values(presets.FACTORY_PRESETS).flatMap((list) => list.map((p) => p.id)))
}

/** The map the last build published (empty on the first run). */
async function publishedMap(): Promise<FileMap> {
  if (!existsSync(GENERATED_TS)) return {}
  const mod = (await import(pathToFileURL(GENERATED_TS).href)) as { FACTORY_PRESET_PREVIEW_FILES: FileMap }
  return { ...mod.FACTORY_PRESET_PREVIEW_FILES }
}

/** Splits a preset id into its node type and slug, refusing one that cannot be a file name. */
function idParts(id: string): { nodeType: string; slug: string } {
  const at = id.indexOf("/")
  const nodeType = id.slice(0, at)
  const slug = id.slice(at + 1)
  if (at < 1 || !SLUG.test(nodeType) || !SLUG.test(slug)) throw new Error(`preset id "${id}" does not fold to a usable file name`)
  return { nodeType, slug }
}

/** Source pictures under --src, keyed by preset id. */
function readSources(src: string, ids: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const nodeType of readdirSync(src)) {
    const dir = join(src, nodeType)
    if (IGNORED_SOURCE.test(nodeType) || !statSync(dir).isDirectory()) continue
    for (const name of readdirSync(dir)) {
      if (IGNORED_SOURCE.test(name)) continue
      const path = join(dir, name)
      const ext = extname(name).toLowerCase()
      if (!statSync(path).isFile() || !SOURCE_EXTS.has(ext)) throw new Error(`${nodeType}/${name}: not a .png/.jpg/.webp file`)
      const id = `${nodeType}/${basename(name, extname(name))}`
      if (!ids.has(id)) throw new Error(`${nodeType}/${name}: "${id}" is not a factory preset`)
      if (out.has(id)) throw new Error(`${id} has more than one source file`)
      out.set(id, path)
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

/** Relative paths ("generate-image/x.webp") of the files under `root`, one folder deep; links are never followed. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((dir) => dir.isDirectory() && SLUG.test(dir.name))
    .flatMap((dir) =>
      readdirSync(join(root, dir.name), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${dir.name}/${entry.name}`),
    )
}

/**
 * Make OUT_DIR hold exactly the finished build (never renames the folder).
 * Only files this build could have written — a node-type folder and a
 * `<slug>.<hash8>.webp` name — are ever deleted; anything else found there is
 * left alone (and fails the guard test until someone decides about it).
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

async function buildInto(
  build: string,
  sources: ReadonlyMap<string, string>,
  ids: ReadonlySet<string>,
  remove: ReadonlyArray<string>,
): Promise<FileMap> {
  const previous = await publishedMap()
  const map: FileMap = {}
  let encoded = 0
  let kept = 0
  const dropped: string[] = []

  for (const id of remove) {
    if (sources.has(id)) throw new Error(`${id} is both in --src and in --remove`)
    if (!(id in previous)) throw new Error(`--remove ${id}: it has no published preview`)
  }

  const place = (id: string, bytes: Buffer): void => {
    const { nodeType, slug } = idParts(id)
    const file = `${nodeType}/${slug}.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.webp`
    mkdirSync(join(build, nodeType), { recursive: true })
    writeFileSync(join(build, file), bytes)
    map[id] = file
  }

  for (const [id, path] of sources) {
    place(id, await encode(path))
    encoded++
  }
  for (const [id, file] of Object.entries(previous)) {
    if (sources.has(id) || remove.includes(id)) continue
    if (!ids.has(id)) {
      dropped.push(id)
      continue
    }
    const path = join(OUT_DIR, file)
    if (!existsSync(path)) throw new Error(`${id}: published file ${file} is missing — re-run with its source, or --remove it`)
    place(id, readFileSync(path))
    kept++
  }
  console.log(
    `preset-previews: ${encoded} encoded, ${kept} kept` +
      (remove.length ? `, removed: ${remove.join(", ")}` : "") +
      (dropped.length ? `, dropped (preset removed): ${dropped.join(", ")}` : ""),
  )
  return map
}

function writeGenerated(map: FileMap): void {
  const rows = Object.keys(map)
    .sort()
    .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(map[id])},\n`)
    .join("")
  writeFileSync(
    GENERATED_TS,
    `// GENERATED by tools/preset-previews/build.mts — do not edit. Factory preset id →\n` +
      `// content-hashed file under frontend/public/preset-previews/ (\`<nodeType>/<slug>.<hash8>.webp\`).\n` +
      `export const FACTORY_PRESET_PREVIEW_FILES: Readonly<Record<string, string>> = {\n${rows}}\n`,
  )
}

async function main(): Promise<void> {
  const { src, remove } = parseArgs(process.argv.slice(2))
  const ids = await factoryIds()
  const sources = src ? readSources(src, ids) : new Map<string, string>()
  const build = join(WORK_DIR, `previews-${process.pid}`)
  rmSync(build, { recursive: true, force: true })
  let map: FileMap
  try {
    map = await buildInto(build, sources, ids, remove)
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
