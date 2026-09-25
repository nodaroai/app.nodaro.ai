/**
 * Guard: every option of the character pickers (Person, Styling, Held Prop,
 * Material, Animal) has a photo, and every photo the map points at is a real,
 * intact, self-hosted file.
 *
 * The runtime degrades gracefully (an option without a photo shows its drawn
 * icon, swatch or emoji), so without this test a new catalog option would
 * silently ship picture-less, and a renamed or re-encoded file would silently
 * 404. Checked here:
 *   - coverage: every option id of each catalog, read from the prompts
 *     catalogs (the source of truth), has a photo — except the explicit
 *     NO_PHOTO_YET list, which must itself stay true (an entry that gains a
 *     photo has to leave the list);
 *   - no stale entries (an id the catalog no longer has) and a round icon for
 *     every Person topic;
 *   - every file resolves through `characterArtUrl` to a root-relative URL,
 *     exists, is non-empty and carries its own content hash — the server
 *     caches these files as immutable, so a stale hash would pin a wrong image
 *     for a year;
 *   - no unreferenced file under picker-art/character/.
 */
import { describe, it, expect, vi } from "vitest"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PERSON_DIMENSION_ORDER, PERSON_DIMENSION_SECTIONS, PICKER_CATALOGS, STYLING_DIMENSION_ORDER } from "@nodaro/prompts"
import {
  CHARACTER_ART_BASE,
  CHARACTER_ART_SHAPED_DIMENSIONS,
  characterArtUrl,
  characterSectionIconUrl,
  characterSectionSlug,
  type CharacterArtFamily,
} from "../../icons/character-art"
import { CHARACTER_ART_FILES } from "@nodaro/prompts"
import { STYLING_TOPICS } from "../styling-topics"

// Hashing ~1,100 files takes a few seconds on a loaded runner.
vi.setConfig({ testTimeout: 30000 })

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..")
const PUBLIC_DIR = join(REPO_ROOT, "frontend", "public")
const ART_DIR = join(PUBLIC_DIR, "picker-art", "character")

const FAMILIES: ReadonlyArray<CharacterArtFamily> = ["person", "styling", "held-prop", "materials", "animals"]

/**
 * Options that have no photo yet: added to the catalog after the photos were
 * made, or animals the photo set does not cover. They render their fallback.
 */
const NO_PHOTO_YET: Readonly<Record<CharacterArtFamily, ReadonlyArray<string>>> = {
  person: ["texture-natural"],
  styling: ["makeup-bare", "outfit-casual-home"],
  "held-prop": [],
  materials: [],
  animals: ["capybara", "meerkat", "okapi", "pangolin", "quokka", "red-panda", "sloth"],
}

function catalogIds(family: CharacterArtFamily): ReadonlySet<string> {
  const catalog = PICKER_CATALOGS.find((c) => c.catalogId === family)
  if (!catalog) throw new Error(`no picker catalog "${family}"`)
  const options = catalog.dimensions ? catalog.dimensions.flatMap((d) => d.options) : (catalog.options ?? [])
  return new Set(options.map((o) => o.id))
}

/** The build's ASCII folding of an option id into a file name. */
const fileStem = (id: string): string =>
  id.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")

const allEntries = (): Array<[family: string, id: string, stem: string]> =>
  Object.entries(CHARACTER_ART_FILES).flatMap(([family, byId]) =>
    Object.entries(byId).map(([id, stem]) => [family, id, stem] as [string, string, string]),
  )

describe("character picker photos — coverage", () => {
  it("covers exactly the five character catalogs plus the section icons", () => {
    expect(Object.keys(CHARACTER_ART_FILES).sort()).toEqual([...FAMILIES, "sections"].sort())
  })

  it.each(FAMILIES)("%s: every option has a photo, except the listed ones", (family) => {
    const exempt = new Set(NO_PHOTO_YET[family])
    const missing = [...catalogIds(family)].filter((id) => !exempt.has(id) && characterArtUrl(family, id) === undefined)
    expect(missing, `options of ${family} without a photo`).toEqual([])
  })

  it.each(FAMILIES)("%s: the no-photo list is still true and names real options", (family) => {
    const ids = catalogIds(family)
    const wrong = NO_PHOTO_YET[family].filter((id) => !ids.has(id) || characterArtUrl(family, id) !== undefined)
    expect(wrong, `entries to drop from NO_PHOTO_YET.${family}`).toEqual([])
  })

  it.each(FAMILIES)("%s: no photo for an option the catalog no longer has", (family) => {
    const ids = catalogIds(family)
    expect(Object.keys(CHARACTER_ART_FILES[family] ?? {}).filter((id) => !ids.has(id))).toEqual([])
  })

  it("every tile shape is set for a real dimension (a renamed one would fall back to square)", () => {
    const real = new Set([...PERSON_DIMENSION_ORDER.map((d) => `person/${d}`), ...STYLING_DIMENSION_ORDER.map((d) => `styling/${d}`)])
    expect(CHARACTER_ART_SHAPED_DIMENSIONS.filter((key) => !real.has(key))).toEqual([])
  })

  it("every Person and Styling topic has its round icon, and no icon is orphaned", () => {
    const labels = [...PERSON_DIMENSION_SECTIONS.map((s) => s.label), ...STYLING_TOPICS.map((t) => t.label)]
    const slugs = labels.map(characterSectionSlug)
    expect(labels.filter((label) => characterSectionIconUrl(label) === undefined)).toEqual([])
    expect(Object.keys(CHARACTER_ART_FILES.sections ?? {}).filter((slug) => !slugs.includes(slug))).toEqual([])
  })
})

describe("character picker photos — files", () => {
  it("every url is same-origin: the root-relative base and a plain hashed file name", () => {
    // The base is the only origin decision; a generated entry that smuggled in
    // a scheme, a host, `..` or a slash would escape it.
    expect(CHARACTER_ART_BASE).toBe("/picker-art/character/")
    const bad = allEntries().filter(
      ([family, id, stem]) => !/^[a-z0-9]+(?:-[a-z0-9]+)*\.[0-9a-f]{8}$/.test(stem) || (family !== "sections" && !stem.startsWith(`${fileStem(id)}.`)),
    )
    expect(bad).toEqual([])
  })

  it("file names are unique within each family (ASCII folding never collides)", () => {
    for (const byId of Object.values(CHARACTER_ART_FILES)) {
      const stems = Object.values(byId).map((s) => s.slice(0, -9))
      expect(new Set(stems).size).toBe(stems.length)
    }
  })

  it("every file exists, is a non-empty WebP, and its name hash matches its bytes", () => {
    const problems: string[] = []
    for (const [family, id] of allEntries()) {
      const url = family === "sections" ? characterSectionIconUrl(id)! : characterArtUrl(family as CharacterArtFamily, id)!
      const path = join(PUBLIC_DIR, ...url.split("/").filter(Boolean))
      if (!existsSync(path)) {
        problems.push(`${family}/${id}: missing ${url}`)
        continue
      }
      const bytes = readFileSync(path)
      if (bytes.length === 0) problems.push(`${family}/${id}: empty ${url}`)
      // A real WebP: RIFF container, WEBP form type.
      if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") problems.push(`${family}/${id}: not a WebP file`)
      const nameHash = /\.([0-9a-f]{8})\.webp$/.exec(url)?.[1]
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 8)
      if (nameHash !== digest) problems.push(`${family}/${id}: name hash ${nameHash} ≠ content ${digest}`)
    }
    expect(problems).toEqual([])
  })

  it("ships no unreferenced file", () => {
    const referenced = new Set(allEntries().map(([family, , stem]) => `${family}/${stem}.webp`))
    const onDisk = readdirSync(ART_DIR).flatMap((family) => {
      const dir = join(ART_DIR, family)
      if (!statSync(dir).isDirectory()) return [family]
      return readdirSync(dir).map((f) => `${family}/${f}`)
    })
    expect(onDisk.filter((f) => !referenced.has(f))).toEqual([])
  })
})
