import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { FACTORY_PRESETS } from "@nodaro/prompts"
import { LABEL_TABLES } from "../labels"
import type { LocaleLabelTables } from "../label-tables"

/**
 * Every locale's `node` table (labels.<locale>.ts, registered in LABEL_TABLES)
 * is keyed by the English node label, and an unmapped label silently passes
 * through as English — no type error, no runtime error, just an untranslated
 * node name in the sidebar and the add-node menu.
 *
 * This reads `types/nodes.ts` as source text (rather than importing it,
 * which drags the whole editor + backend `gen:skills` parsing surface into
 * the test — and this file is NEVER edited by i18n work, only read) and
 * asserts every node-definition default `label:` has an entry in every locale.
 *
 * Cost budget: read exactly the two files under test, no tree walk, and give
 * each assertion a generous timeout — CI runners are ~10x slower than local.
 */
const SRC = path.resolve(__dirname, "../../..")
const TIMEOUT = 20_000

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8")
}

/** "locale: label" for every label a registered locale's table is missing. */
function missingIn(table: keyof LocaleLabelTables, labels: Iterable<string>): string[] {
  const unique = [...new Set(labels)]
  return Object.entries(LABEL_TABLES).flatMap(([locale, tables]) =>
    unique.filter((l) => !(l in (tables?.[table] ?? {}))).map((l) => `${locale}: ${l}`),
  )
}

/**
 * `NODE_DEFINITIONS` entries hold their default label on its own line at
 * 4-space indent — `    label: "X",` directly under `{ type: "...", ... }`.
 * The SAME string is repeated a line or two later inside `defaultData: {`
 * (either inline on the same line as other fields, or on its own line at
 * 6-space indent when defaultData spans multiple lines) — that's a mirror of
 * the node-def label, not a distinct string, so only the 4-space form is
 * extracted. This also naturally skips handle/option labels (nested pickers,
 * column meta, etc.), which never appear at exactly this indent + shape.
 */
function nodeDefinitionLabels(): string[] {
  const src = read("types/nodes.ts")
  return [...src.matchAll(/^ {4}label: "([^"]+)",$/gm)].map((m) => m[1])
}

describe("node label tables coverage", () => {
  it(
    "every node-definition default label in types/nodes.ts has an entry in every locale",
    () => {
      const extracted = nodeDefinitionLabels()
      // Floor so a reformat of types/nodes.ts (e.g. label moved off its own
      // 4-space line) fails loudly here instead of silently extracting zero
      // labels and passing the coverage check for free.
      expect(extracted.length).toBeGreaterThan(150)
      const missing = missingIn("node", extracted)
      expect(missing, `untranslated node labels: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * A new node's header renders the label it was created with — its PERSISTED
 * default, `defaultData.label` — which is not always the definition label the
 * check above reads ("New group" vs "Group", "Era" vs "Era / Period"). An
 * unmapped one puts English on every new node of that type, in every locale.
 * Two shapes: the label on the `defaultData: {` line, or first on the next.
 */
function persistedDefaultLabels(): string[] {
  const src = read("types/nodes.ts")
  const sameLine = [...src.matchAll(/defaultData:\s*\{[^\n}]*?\blabel:\s*"([^"]+)"/g)].map((m) => m[1])
  const nextLine = [...src.matchAll(/defaultData:\s*\{\s*\n\s*label:\s*"([^"]+)"/g)].map((m) => m[1])
  return [...sameLine, ...nextLine]
}

/** Persisted defaults that read the same in every language. */
const LANGUAGE_NEUTRAL_DEFAULT_LABELS = new Set([
  "A", // Teleport Send / Receive: the default channel letter
])

describe("persisted default node labels have an entry in every locale", () => {
  it(
    "every defaultData.label in types/nodes.ts is in every locale's node table",
    () => {
      const extracted = persistedDefaultLabels()
      expect(extracted.length).toBeGreaterThan(150)
      const missing = missingIn("node", extracted.filter((l) => !LANGUAGE_NEUTRAL_DEFAULT_LABELS.has(l)))
      expect(missing, `persisted default labels with no entry: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * The add-node popup and the sidebar render `NODE_OPTIONS` labels, looked up in
 * the same `node` tables. An option label is NOT always the node
 * definition's label ("Create Face" vs "Face", "Suno Create Music" vs "Suno
 * Generate"), so the definition check above does not cover it — and one
 * unmapped option shows English in an otherwise translated menu.
 */
describe("NODE_OPTIONS labels have an entry in every locale", () => {
  it(
    "every add-node menu label in lib/node-options.tsx is in every locale's node table",
    () => {
      const labels = [...read("lib/node-options.tsx").matchAll(/^ {4}label: "([^"]+)",?$/gm)].map((m) => m[1])
      expect(labels.length).toBeGreaterThan(150)
      const missing = missingIn("node", labels)
      expect(missing, `add-node menu labels with no entry: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * Same trap one level down: the pip labels on a node's input/output handles
 * ("Start Frame", "Image Refs", "Video Refs" …) come from
 * `target-handle-registry.ts` and are looked up in each locale's `handle` table by
 * their English string — so a new handle silently renders English next to
 * otherwise translated pips.
 */
describe("handle label tables coverage", () => {
  it(
    "every handle label in target-handle-registry.ts has an entry in every locale",
    () => {
      const registry = read("lib/target-handle-registry.ts")
      // Display strings in this registry are `key: "Capitalised value"`
      // pairs (handleId/label entries); ids/handleIds are camelCase or
      // kebab-case, so the leading-capital filter isolates the user-visible
      // ones. Bare string literals with no preceding colon (e.g. the
      // multi-line console.error guard message) are excluded by construction.
      const labels = new Set(
        [...registry.matchAll(/:\s*"([A-Z][^"]*)"/g)].map((m) => m[1]),
      )
      // Floor so a reformat of target-handle-registry.ts fails loudly here
      // instead of silently extracting zero labels and passing for free.
      expect(labels.size).toBeGreaterThan(20)
      const missing = missingIn("handle", labels)
      expect(missing, `untranslated handle labels: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * Node-picker family / section headers ("Camera", "Light & Look", …) come
 * from `NODE_FAMILIES` and `COMMON_SECTIONS` in `lib/node-families.ts` and
 * are looked up in each locale's `nodeGroup` table by their English `label` string — a new
 * family silently renders an English header in an otherwise translated tab.
 *
 * Read as source text for the same reason as `types/nodes.ts` above: this
 * file is never edited by i18n work, only read, and a plain regex scan over
 * `label: "X",` lines is enough — no need to import the module (and its
 * `types/nodes.ts` dependency) into the test.
 */
function nodeFamilyGroupLabels(): string[] {
  // Matches both `NODE_FAMILIES`'s own-line `label: "X",` entries and
  // `COMMON_SECTIONS`'s single-line `{ id: "...", label: "X", types: [...] }`
  // entries — the only `label: "..."` occurrences in node-families.ts are
  // these two arrays' data, so a plain scan (no end-of-line anchor) is safe.
  // node-picker-sections.ts contributes the synthetic section headers it
  // mints itself (`Popular`); its `label: family.label` / template-literal
  // forms carry no quote and are skipped by construction.
  const src = read("lib/node-families.ts") + read("lib/node-picker-sections.ts")
  return [...src.matchAll(/label: "([^"]+)"/g)].map((m) => m[1])
}

describe("node-group tables coverage", () => {
  it(
    "every NODE_FAMILIES / COMMON_SECTIONS label in node-families.ts, plus the synthetic picker sections, has an entry in every locale",
    () => {
      const extracted = nodeFamilyGroupLabels()
      // Floor so a reformat of node-families.ts fails loudly here instead of
      // silently extracting zero labels and passing the check for free.
      expect(extracted.length).toBeGreaterThan(20)
      const missing = missingIn("nodeGroup", extracted)
      expect(missing, `untranslated node-family group labels: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * Factory-preset GROUP names (the folder/section headers in the node preset
 * dropdown) come from each `FactoryPreset.group` field in `@nodaro/prompts`
 * and are looked up in each locale's `presetGroup` table by that English string — a new
 * preset group silently renders English in an otherwise translated dropdown.
 *
 * Imported directly (rather than read as text) because it mirrors
 * `preset-content.test.ts`'s existing import of the same package, and the
 * group names live scattered across many preset-definition files with no
 * single line shape a regex could reliably target.
 */
describe("preset-group tables coverage", () => {
  it(
    "every FACTORY_PRESETS group name has an entry in every locale",
    () => {
      const groups = new Set(
        Object.values(FACTORY_PRESETS)
          .flatMap((list) => list.map((p) => p.group))
          .filter((g): g is string => Boolean(g)),
      )
      // Floor so a reformat/removal of factory-preset group metadata fails
      // loudly here instead of silently extracting zero groups and passing.
      expect(groups.size).toBeGreaterThan(20)
      const missing = missingIn("presetGroup", groups)
      expect(missing, `untranslated preset group names: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})
