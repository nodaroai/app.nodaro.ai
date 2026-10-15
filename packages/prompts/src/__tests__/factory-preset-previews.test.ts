// @test-watches frontend/public/preset-previews/**
/**
 * Factory preset previews: one small example picture per preset, committed
 * under frontend/public/preset-previews/<nodeType>/<slug>.<hash8>.webp and
 * served by the app at /preset-previews/… (cached as immutable, so the name
 * must carry the file's own content hash). The generated map
 * (preview-files.generated.ts, written by tools/preset-previews/build.mts) is
 * what the API reads to hand out `previewUrl`.
 *
 * The API must never point at a file that does not exist — the CDN in front
 * keeps a 404 for a long time — so the map and the folder must agree exactly:
 *   - every mapped file exists, is non-empty and carries its own hash;
 *   - every mapped id is a factory preset, and the file sits under its node
 *     type with its slug as the name;
 *   - no file in the folder is missing from the map (a dropped-in file that
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
  PRESET_PREVIEW_PATH,
  factoryPresetPreviewUrl,
} from "../factory-presets.js"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const PREVIEW_DIR = join(REPO_ROOT, "frontend", "public", "preset-previews")
const FILE_NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([0-9a-f]{8})\.webp$/

/** Every file under the folder, as `<nodeType>/<name>` (dotfiles skipped). */
function filesOnDisk(): string[] {
  if (!existsSync(PREVIEW_DIR)) return []
  return readdirSync(PREVIEW_DIR, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return []
    if (!entry.isDirectory()) return [entry.name]
    return readdirSync(join(PREVIEW_DIR, entry.name))
      .filter((name) => !name.startsWith("."))
      .map((name) => `${entry.name}/${name}`)
  })
}

const factoryIds = new Set(Object.values(FACTORY_PRESETS).flatMap((list) => list.map((p) => p.id)))

describe("factory preset previews — the map and the folder agree", () => {
  it("every mapped id is a factory preset, filed under its node type and slug", () => {
    const wrong: string[] = []
    for (const [id, file] of Object.entries(FACTORY_PRESET_PREVIEW_FILES)) {
      if (!factoryIds.has(id)) wrong.push(`${id}: not a factory preset`)
      const [nodeType, name] = file.split("/")
      const match = FILE_NAME.exec(name ?? "")
      const slug = id.slice(id.indexOf("/") + 1)
      if (`${nodeType}/${match?.[1]}` !== `${id.slice(0, id.indexOf("/"))}/${slug}`) {
        wrong.push(`${id}: filed as ${file}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("every mapped file exists, is non-empty and is named by its own content hash", () => {
    const wrong: string[] = []
    for (const [id, file] of Object.entries(FACTORY_PRESET_PREVIEW_FILES)) {
      const path = join(PREVIEW_DIR, file)
      if (!existsSync(path) || !statSync(path).isFile()) {
        wrong.push(`${id}: ${file} is missing`)
        continue
      }
      const bytes = readFileSync(path)
      if (bytes.length === 0) wrong.push(`${id}: ${file} is empty`)
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8)
      if (FILE_NAME.exec(file.split("/")[1] ?? "")?.[2] !== hash) wrong.push(`${id}: ${file} does not carry its hash ${hash}`)
    }
    expect(wrong).toEqual([])
  })

  it("no file in the folder is missing from the map (run tools/preset-previews/build.mts)", () => {
    const mapped = new Set(Object.values(FACTORY_PRESET_PREVIEW_FILES))
    expect(filesOnDisk().filter((f) => !mapped.has(f))).toEqual([])
  })

  it("each file is mapped from exactly one preset", () => {
    const files = Object.values(FACTORY_PRESET_PREVIEW_FILES)
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
