import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { FACTORY_PRESETS } from "@nodaro/prompts"

/**
 * `NODE_LABELS_HE` is keyed by the English node label, and an unmapped label
 * silently passes through as English — no type error, no runtime error, just
 * an untranslated node name in the sidebar and the add-node menu.
 *
 * This reads `types/nodes.ts` as source text (rather than importing it,
 * which drags the whole editor + backend `gen:skills` parsing surface into
 * the test — and this file is NEVER edited by i18n work, only read) and
 * asserts every node-definition default `label:` has a Hebrew entry.
 *
 * Cost budget: read exactly the two files under test, no tree walk, and give
 * each assertion a generous timeout — CI runners are ~10x slower than local.
 */
const SRC = path.resolve(__dirname, "../../..")
const TIMEOUT = 20_000

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8")
}

function mappedLabels(mapName: string): Set<string> {
  const labels = read("lib/i18n/labels.ts")
  const block = new RegExp(`const ${mapName}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(labels)
  if (!block) throw new Error(`${mapName} block not found in labels.ts`)
  return new Set([...block[1].matchAll(/"([^"]+)":/g)].map((m) => m[1]))
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

describe("NODE_LABELS_HE coverage", () => {
  it(
    "every node-definition default label in types/nodes.ts has a Hebrew entry",
    () => {
      const mapped = mappedLabels("NODE_LABELS_HE")
      const extracted = nodeDefinitionLabels()
      // Floor so a reformat of types/nodes.ts (e.g. label moved off its own
      // 4-space line) fails loudly here instead of silently extracting zero
      // labels and passing the coverage check for free.
      expect(extracted.length).toBeGreaterThan(150)
      const missing = [...new Set(extracted)].filter((l) => !mapped.has(l))
      expect(missing, `untranslated node labels: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * Same trap one level down: the pip labels on a node's input/output handles
 * ("Start Frame", "Image Refs", "Video Refs" …) come from
 * `target-handle-registry.ts` and are looked up in `HANDLE_LABELS_HE` by
 * their English string — so a new handle silently renders English next to
 * otherwise Hebrew pips.
 */
describe("HANDLE_LABELS_HE coverage", () => {
  it(
    "every handle label in target-handle-registry.ts has a Hebrew entry",
    () => {
      const mapped = mappedLabels("HANDLE_LABELS_HE")
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
      const missing = [...labels].filter((l) => !mapped.has(l))
      expect(missing, `untranslated handle labels: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * Node-picker family / section headers ("Camera", "Light & Look", …) come
 * from `NODE_FAMILIES` and `COMMON_SECTIONS` in `lib/node-families.ts` and
 * are looked up in `NODE_GROUPS_HE` by their English `label` string — a new
 * family silently renders an English header in an otherwise Hebrew tab.
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

describe("NODE_GROUPS_HE coverage", () => {
  it(
    "every NODE_FAMILIES / COMMON_SECTIONS label in node-families.ts, plus the synthetic picker sections, has a Hebrew entry",
    () => {
      const mapped = mappedLabels("NODE_GROUPS_HE")
      const extracted = nodeFamilyGroupLabels()
      // Floor so a reformat of node-families.ts fails loudly here instead of
      // silently extracting zero labels and passing the check for free.
      expect(extracted.length).toBeGreaterThan(20)
      const missing = [...new Set(extracted)].filter((l) => !mapped.has(l))
      expect(missing, `untranslated node-family group labels: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * Factory-preset GROUP names (the folder/section headers in the node preset
 * dropdown) come from each `FactoryPreset.group` field in `@nodaro/prompts`
 * and are looked up in `PRESET_GROUPS_HE` by that English string — a new
 * preset group silently renders English in an otherwise Hebrew dropdown.
 *
 * Imported directly (rather than read as text) because it mirrors
 * `preset-content.test.ts`'s existing import of the same package, and the
 * group names live scattered across many preset-definition files with no
 * single line shape a regex could reliably target.
 */
describe("PRESET_GROUPS_HE coverage", () => {
  it(
    "every FACTORY_PRESETS group name has a Hebrew entry",
    () => {
      const mapped = mappedLabels("PRESET_GROUPS_HE")
      const groups = new Set(
        Object.values(FACTORY_PRESETS)
          .flatMap((list) => list.map((p) => p.group))
          .filter((g): g is string => Boolean(g)),
      )
      // Floor so a reformat/removal of factory-preset group metadata fails
      // loudly here instead of silently extracting zero groups and passing.
      expect(groups.size).toBeGreaterThan(20)
      const missing = [...groups].filter((g) => !mapped.has(g))
      expect(missing, `untranslated preset group names: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )
})
