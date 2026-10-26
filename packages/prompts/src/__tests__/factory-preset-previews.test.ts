// @test-watches frontend/public/preset-previews/**
/**
 * Factory preset previews: two example pictures per preset, committed under
 * frontend/public/preset-previews/ — the tile picture at
 * <nodeType>/<slug>.<hash8>.webp (at most 512px wide) and the full-screen one
 * at 1024/<nodeType>/<slug>.<hash8>.webp (1024px wide) — and served by the app
 * at /preset-previews/… (cached as immutable, so the name must carry the
 * file's own content hash). The generated maps (preview-files.generated.ts,
 * written by tools/preset-previews/build.mts) are what the API reads to hand
 * out `previewUrl` and `previewSrcSet`.
 *
 * The API must never point at a file that does not exist — the CDN in front
 * keeps a 404 for a long time — so the maps and the folder must agree exactly:
 *   - every mapped file exists, is non-empty and carries its own hash;
 *   - every mapped id is a factory preset, and the file sits under its node
 *     type (the large one under 1024/ first) with its slug as the name;
 *   - a preset with a large picture also has the small one;
 *   - no file in the folder is missing from the maps (a dropped-in file that
 *     was never built, or a stale one).
 * With no previews at all (the folder absent) every check holds and every
 * `previewUrl` is null.
 */
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  FACTORY_PRESETS,
  FACTORY_PRESET_PREVIEW_FILES,
  FACTORY_PRESET_PREVIEW_LARGE_FILES,
  PRESET_PREVIEW_LARGE_WIDTH,
  PRESET_PREVIEW_PATH,
  PRESET_PREVIEW_WIDTH,
  factoryPresetPreviewSrcSet,
  factoryPresetPreviewUrl,
} from "../factory-presets.js"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const PREVIEW_DIR = join(REPO_ROOT, "frontend", "public", "preset-previews")
const LARGE_DIR = String(PRESET_PREVIEW_LARGE_WIDTH)
const FILE_NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([0-9a-f]{8})\.webp$/

/** Every file under a node-type folder of `root`, as `<nodeType>/<name>` (dotfiles skipped). */
function filesIn(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === LARGE_DIR) return []
    if (!entry.isDirectory()) return [entry.name]
    return readdirSync(join(root, entry.name))
      .filter((name) => !name.startsWith("."))
      .map((name) => `${entry.name}/${name}`)
  })
}

/** Every file under the folder: the small ones as `<nodeType>/<name>`, the large ones as `1024/<nodeType>/<name>`. */
function filesOnDisk(): string[] {
  return [...filesIn(PREVIEW_DIR), ...filesIn(join(PREVIEW_DIR, LARGE_DIR)).map((f) => `${LARGE_DIR}/${f}`)]
}

const factoryIds = new Set(Object.values(FACTORY_PRESETS).flatMap((list) => list.map((p) => p.id)))

/** The file's path split as the map states it: the large prefix (or none), the node type and the name. */
function parts(file: string, large: boolean): { prefix: string; nodeType: string; name: string } {
  const segments = file.split("/")
  const prefix = large ? segments.shift() ?? "" : ""
  return { prefix, nodeType: segments[0] ?? "", name: segments[1] ?? "" }
}

function checkMap(map: Readonly<Record<string, string>>, large: boolean): void {
  it("every mapped id is a factory preset, filed under its node type and slug", () => {
    const wrong: string[] = []
    for (const [id, file] of Object.entries(map)) {
      if (file !== file.toLowerCase() || file.includes("\\")) wrong.push(`${id}: ${file} is not a plain forward-slash path`)
      if (!factoryIds.has(id)) wrong.push(`${id}: not a factory preset`)
      const { prefix, nodeType, name } = parts(file, large)
      const match = FILE_NAME.exec(name)
      const slug = id.slice(id.indexOf("/") + 1)
      if (prefix !== (large ? LARGE_DIR : "") || `${nodeType}/${match?.[1]}` !== `${id.slice(0, id.indexOf("/"))}/${slug}`) {
        wrong.push(`${id}: filed as ${file}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("every mapped file exists, is non-empty and is named by its own content hash", () => {
    const wrong: string[] = []
    for (const [id, file] of Object.entries(map)) {
      const path = join(PREVIEW_DIR, file)
      if (!existsSync(path) || !statSync(path).isFile()) {
        wrong.push(`${id}: ${file} is missing`)
        continue
      }
      const bytes = readFileSync(path)
      if (bytes.length === 0) wrong.push(`${id}: ${file} is empty`)
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8)
      if (FILE_NAME.exec(parts(file, large).name)?.[2] !== hash) wrong.push(`${id}: ${file} does not carry its hash ${hash}`)
    }
    expect(wrong).toEqual([])
  })
}

const LARGE_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FACTORY_PRESET_PREVIEW_LARGE_FILES).map(([id, { file }]) => [id, file]),
)

describe("factory preset previews — the maps and the folder agree", () => {
  describe("the tile pictures", () => checkMap(FACTORY_PRESET_PREVIEW_FILES, false))
  describe("the full-screen pictures", () => checkMap(LARGE_FILES, true))

  it("a preset with a full-screen picture also has its tile picture", () => {
    const small = new Set(Object.keys(FACTORY_PRESET_PREVIEW_FILES))
    expect(Object.keys(FACTORY_PRESET_PREVIEW_LARGE_FILES).filter((id) => !small.has(id))).toEqual([])
  })

  it("every full-screen picture's recorded width is wider than the tile and at most the large width", () => {
    const wrong = Object.entries(FACTORY_PRESET_PREVIEW_LARGE_FILES)
      .filter(([, { width }]) => !Number.isInteger(width) || width <= PRESET_PREVIEW_WIDTH || width > PRESET_PREVIEW_LARGE_WIDTH)
      .map(([id, { width }]) => `${id}: ${width}`)
    expect(wrong).toEqual([])
  })

  it("no file in the folder is missing from the maps (run tools/preset-previews/build.mts)", () => {
    const mapped = new Set([...Object.values(FACTORY_PRESET_PREVIEW_FILES), ...Object.values(LARGE_FILES)])
    expect(filesOnDisk().filter((f) => !mapped.has(f))).toEqual([])
  })

  it("each file is mapped from exactly one preset", () => {
    const files = [...Object.values(FACTORY_PRESET_PREVIEW_FILES), ...Object.values(LARGE_FILES)]
    expect(files.length).toBe(new Set(files).size)
  })
})

describe("factoryPresetPreviewUrl", () => {
  const FILES = { "generate-image/character-board": "generate-image/character-board.1a2b3c4d.webp" }

  it("is an absolute URL on the installation's origin for a preset that has a preview", () => {
    expect(factoryPresetPreviewUrl("generate-image/character-board", "https://app.nodaro.ai", FILES)).toBe(
      "https://app.nodaro.ai/preset-previews/generate-image/character-board.1a2b3c4d.webp",
    )
    expect(factoryPresetPreviewUrl("generate-image/character-board", "http://localhost:3000/", FILES)).toBe(
      "http://localhost:3000/preset-previews/generate-image/character-board.1a2b3c4d.webp",
    )
  })

  it("is null for a preset without a preview", () => {
    expect(factoryPresetPreviewUrl("generate-image/pose-board", "https://app.nodaro.ai", FILES)).toBeNull()
    expect(factoryPresetPreviewUrl("not-a/preset", "https://app.nodaro.ai", FILES)).toBeNull()
  })

  it("is null when the base URL is unusable, rather than a broken link", () => {
    for (const base of ["", "not a url", "javascript:alert(1)", "ftp://host"]) {
      expect(factoryPresetPreviewUrl("generate-image/character-board", base, FILES)).toBeNull()
    }
  })

  it("reads the committed map by default, and every committed preview resolves under /preset-previews/", () => {
    for (const id of Object.keys(FACTORY_PRESET_PREVIEW_FILES)) {
      expect(factoryPresetPreviewUrl(id, "https://app.nodaro.ai")).toMatch(
        new RegExp(`^https://app\\.nodaro\\.ai${PRESET_PREVIEW_PATH}[a-z0-9-]+/[a-z0-9-]+\\.[0-9a-f]{8}\\.webp$`),
      )
    }
    expect(factoryPresetPreviewUrl("not-a/preset", "https://app.nodaro.ai")).toBeNull()
  })
})

describe("factoryPresetPreviewSrcSet", () => {
  const FILES = { "generate-image/character-board": "generate-image/character-board.1a2b3c4d.webp" }
  const LARGE = { "generate-image/character-board": { file: "1024/generate-image/character-board.5e6f7a8b.webp", width: 1024 } }

  it("names the tile picture at 512w and the full-screen one at its recorded width", () => {
    expect(factoryPresetPreviewSrcSet("generate-image/character-board", "https://app.nodaro.ai", FILES, LARGE)).toBe(
      "https://app.nodaro.ai/preset-previews/generate-image/character-board.1a2b3c4d.webp 512w, " +
        "https://app.nodaro.ai/preset-previews/1024/generate-image/character-board.5e6f7a8b.webp 1024w",
    )
    const portrait = { "generate-image/character-board": { file: "1024/generate-image/character-board.5e6f7a8b.webp", width: 768 } }
    expect(factoryPresetPreviewSrcSet("generate-image/character-board", "https://app.nodaro.ai", FILES, portrait)).toMatch(/ 768w$/)
    expect(PRESET_PREVIEW_WIDTH).toBe(512)
    expect(PRESET_PREVIEW_LARGE_WIDTH).toBe(1024)
  })

  it("is null when either size is missing, or the base URL is unusable", () => {
    expect(factoryPresetPreviewSrcSet("generate-image/character-board", "https://app.nodaro.ai", FILES, {})).toBeNull()
    expect(factoryPresetPreviewSrcSet("generate-image/character-board", "https://app.nodaro.ai", {}, LARGE)).toBeNull()
    expect(factoryPresetPreviewSrcSet("generate-image/pose-board", "https://app.nodaro.ai", FILES, LARGE)).toBeNull()
    expect(factoryPresetPreviewSrcSet("generate-image/character-board", "not a url", FILES, LARGE)).toBeNull()
  })

  it("reads the committed maps by default, and every committed large picture has a srcset", () => {
    for (const id of Object.keys(FACTORY_PRESET_PREVIEW_LARGE_FILES)) {
      expect(factoryPresetPreviewSrcSet(id, "https://app.nodaro.ai")).toMatch(
        new RegExp(`^https://app\\.nodaro\\.ai${PRESET_PREVIEW_PATH}[a-z0-9-]+/[a-z0-9-]+\\.[0-9a-f]{8}\\.webp 512w, https://app\\.nodaro\\.ai${PRESET_PREVIEW_PATH}1024/[a-z0-9-]+/[a-z0-9-]+\\.[0-9a-f]{8}\\.webp [0-9]+w$`),
      )
    }
  })
})
