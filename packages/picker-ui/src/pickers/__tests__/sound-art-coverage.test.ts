/**
 * Guard: every option of the five music / voice pickers has a picture, and
 * every picture the map points at is a real, intact, self-hosted file.
 *
 * The runtime degrades gracefully (an option without art renders its label),
 * so without this test a new catalog option would silently ship picture-less,
 * and a renamed or re-encoded file would silently 404. Checked here:
 *   - coverage: every option id of every art-bearing dimension has a key, read
 *     from the prompts catalogs (the source of truth), so a new option fails;
 *   - no stale keys (an id the catalog no longer has) and no unused sources;
 *   - every key resolves through `soundArtUrl` to a root-relative URL whose
 *     file exists, is non-empty, and whose name hash matches its bytes — the
 *     server caches these files as immutable, so a stale hash would pin a
 *     wrong image for a year;
 *   - no unreferenced files, and both upstream LICENSE.txt files ship.
 */
import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PICKER_CATALOGS } from "@nodaro/prompts"
import { SOUND_ART, SOUND_ART_BASE, soundArtUrl, type SoundArtCatalogId, type SoundArtKey } from "../../icons/sound-art"
import { SOUND_ART_FILES } from "@nodaro/prompts"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..")
const PUBLIC_DIR = join(REPO_ROOT, "frontend", "public")
const ART_DIR = join(PUBLIC_DIR, "picker-art")

const CATALOG_IDS = Object.keys(SOUND_ART) as SoundArtCatalogId[]
const artByField = (catalogId: SoundArtCatalogId) =>
  SOUND_ART[catalogId] as Readonly<Record<string, Readonly<Record<string, SoundArtKey>>>>

function catalogDimensions(catalogId: SoundArtCatalogId) {
  const catalog = PICKER_CATALOGS.find((c) => c.catalogId === catalogId)
  if (!catalog) throw new Error(`no picker catalog "${catalogId}"`)
  const dims = catalog.dimensions ?? []
  expect(dims.length, `${catalogId} has no dimensions`).toBeGreaterThan(0)
  return dims
}

const ALL_KEYS: ReadonlySet<SoundArtKey> = new Set(
  CATALOG_IDS.flatMap((c) => Object.values(artByField(c)).flatMap((byId) => Object.values(byId))),
)

describe("sound picker art — coverage", () => {
  it("covers exactly the five music / voice catalogs", () => {
    expect([...CATALOG_IDS].sort()).toEqual(
      ["instrumentation", "music-genre", "music-mood", "voice-character", "voice-delivery"],
    )
  })

  it.each(CATALOG_IDS)("%s: every option of every dimension has a picture", (catalogId) => {
    const missing: string[] = []
    for (const dim of catalogDimensions(catalogId)) {
      const byId = artByField(catalogId)[dim.field]
      expect(byId, `${catalogId}.${dim.field} has no art map`).toBeDefined()
      for (const option of dim.options) {
        if (!byId?.[option.id]) missing.push(`${dim.field}.${option.id}`)
      }
    }
    expect(missing, `options without a picture in ${catalogId}`).toEqual([])
  })

  it.each(CATALOG_IDS)("%s: no art entry for an option the catalog no longer has", (catalogId) => {
    const dims = catalogDimensions(catalogId)
    const stale: string[] = []
    for (const [field, byId] of Object.entries(artByField(catalogId))) {
      const dim = dims.find((d) => d.field === field)
      if (!dim) {
        stale.push(`${field} (no such dimension)`)
        continue
      }
      const ids = new Set(dim.options.map((o) => o.id))
      for (const id of Object.keys(byId)) if (!ids.has(id)) stale.push(`${field}.${id}`)
    }
    expect(stale, `stale art entries in ${catalogId}`).toEqual([])
  })
})

describe("sound picker art — files", () => {
  it("every key has a generated file and every generated file is used", () => {
    const files = SOUND_ART_FILES as Readonly<Record<string, string>>
    expect([...ALL_KEYS].filter((k) => !files[k])).toEqual([])
    expect(Object.keys(files).filter((k) => !ALL_KEYS.has(k as SoundArtKey))).toEqual([])
  })

  it("every url is same-origin: a root-relative base and a plain hashed file name", () => {
    // The base is the only origin decision; a generated entry that smuggled in
    // a scheme, a host, `..` or a leading slash would escape it.
    expect(SOUND_ART_BASE).toBe("/picker-art/")
    const bad = Object.entries(SOUND_ART_FILES as Readonly<Record<string, string>>).filter(
      ([key, file]) =>
        !/^(emoji|flags)\/[a-z0-9_-]+\.[0-9a-f]{8}\.webp$/.test(file) || !file.startsWith(`${key}.`),
    )
    expect(bad).toEqual([])
  })

  it("sources.json, manifest.json and the generated map agree", () => {
    const toolsDir = join(REPO_ROOT, "tools", "picker-art")
    const sources = JSON.parse(readFileSync(join(toolsDir, "sources.json"), "utf8")) as {
      emoji: { commit: string; files: Record<string, string> }
      flags: { commit: string; files: Record<string, string> }
    }
    const manifest = JSON.parse(readFileSync(join(toolsDir, "manifest.json"), "utf8")) as Record<
      string,
      { source: string; encoding: string; file: string; sha256: string }
    >
    const files = SOUND_ART_FILES as Readonly<Record<string, string>>
    const sourceKeys = [
      ...Object.keys(sources.emoji.files).map((s) => `emoji/${s}`),
      ...Object.keys(sources.flags.files).map((c) => `flags/${c}`),
    ].sort()
    expect(Object.keys(manifest).sort()).toEqual(sourceKeys)
    expect(Object.keys(files).sort()).toEqual(sourceKeys)
    for (const commit of [sources.emoji.commit, sources.flags.commit]) expect(commit).toMatch(/^[0-9a-f]{40}$/)
    const drift = Object.entries(manifest).filter(
      ([key, m]) => m.file !== files[key] || !m.file.includes(`.${m.sha256.slice(0, 8)}.webp`) || !m.encoding,
    )
    expect(drift.map(([k]) => k)).toEqual([])
  })

  it("every file exists, is non-empty, and its name hash matches its bytes", () => {
    const problems: string[] = []
    for (const key of ALL_KEYS) {
      const url = soundArtUrl(key)!
      const path = join(PUBLIC_DIR, ...url.split("/").filter(Boolean))
      if (!existsSync(path)) {
        problems.push(`${key}: missing ${url}`)
        continue
      }
      const bytes = readFileSync(path)
      if (bytes.length === 0) problems.push(`${key}: empty ${url}`)
      const nameHash = /\.([0-9a-f]{8})\.webp$/.exec(url)?.[1]
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 8)
      if (nameHash !== digest) problems.push(`${key}: name hash ${nameHash} ≠ content ${digest}`)
    }
    expect(problems).toEqual([])
  })

  it("ships no unreferenced file, and both upstream licenses", () => {
    const referenced = new Set(
      [...ALL_KEYS].map((k) => soundArtUrl(k)!.slice(SOUND_ART_BASE.length)),
    )
    // This art owns emoji/ and flags/; character/ has its own guard
    // (character-art-coverage.test.ts).
    const onDisk = ["emoji", "flags"].flatMap((dir) =>
      readdirSync(join(ART_DIR, dir)).map((f) => {
        expect(statSync(join(ART_DIR, dir, f)).isFile(), `${dir}/${f} is not a file`).toBe(true)
        return `${dir}/${f}`
      }),
    )
    const stray = readdirSync(ART_DIR).filter((f) => !["emoji", "flags", "character"].includes(f))
    expect(stray, "unexpected entries directly under picker-art/").toEqual([])
    const licenses = ["emoji/LICENSE.txt", "flags/LICENSE.txt"]
    for (const license of licenses) {
      expect(onDisk, `missing ${license}`).toContain(license)
      expect(readFileSync(join(ART_DIR, license), "utf8")).toMatch(/MIT License/)
    }
    expect(onDisk.filter((f) => !referenced.has(f) && !licenses.includes(f))).toEqual([])
  })
})
