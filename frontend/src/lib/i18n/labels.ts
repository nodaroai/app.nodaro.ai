// Node-header + handle-label localization, and the other string-keyed tables.
//
// The canvas renders a node's *persisted* `data.label` (Title Case, e.g.
// "Generate Image"), which for default nodes equals the node definition's
// default label and which the user can rename. To show EXISTING + new node
// headers in the interface language while leaving user renames untouched, we
// translate by the English default-label STRING at render time: a label present
// in the table is swapped; anything else (a custom name) passes through verbatim.
//
// Handle pips, preset groups, node-family headers, model descriptions and
// dropdown options work the same way. Each locale's tables live in
// labels.<locale>.ts and are registered in LABEL_TABLES below; a locale with no
// tables, or a string with no entry, renders the English.
import { useCallback } from "react"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared/i18n"
import { PRESET_CONTENT_HE, type PresetCopy } from "./preset-content.he"
import type { LocaleLabelTables } from "./label-tables"
import { LABELS_HE } from "./labels.he"
import { LABELS_JA } from "./labels.ja"
import { PRESET_CONTENT_JA } from "./preset-content.ja"
import { LABELS_KO } from "./labels.ko"
import { PRESET_CONTENT_KO } from "./preset-content.ko"
import { LABELS_PT_BR } from "./labels.pt-br"
import { PRESET_CONTENT_PT_BR } from "./preset-content.pt-br"
// The Create Image tiles' copy, generated from tools/preset-tiles/ledger.json (its build writes these four files).
import { PRESET_TILES_HE } from "./preset-content-tiles.he.generated"
import { PRESET_TILES_JA } from "./preset-content-tiles.ja.generated"
import { PRESET_TILES_KO } from "./preset-content-tiles.ko.generated"
import { PRESET_TILES_PT_BR } from "./preset-content-tiles.pt-br.generated"
import { translate, type MessageKey } from "./index"
import { UNIT_LABELS } from "@/nodes/_generated/labels"
import { unitNodeLabels } from "@/lib/unit-compose"

// Each node unit's node-label translations (frontend/src/nodes/<type>/strings.json
// `labels`, projected into labels.generated.ts), by locale.
const UNIT_NODE_LABELS = unitNodeLabels(Object.values(UNIT_LABELS))

/** A locale's tables with the node units' node labels added (a legacy row of the same English label wins). */
function withUnitLabels(locale: "he" | "ja" | "ko" | "pt-BR", tables: LocaleLabelTables): LocaleLabelTables {
  const add = UNIT_NODE_LABELS[locale]
  return add ? { ...tables, node: { ...add, ...tables.node } } : tables
}

/**
 * Every locale's label tables. The coverage guards iterate this registry, so a
 * locale added here is checked for complete tables the day it is added.
 * Legacy tables ∪ the node units' node labels.
 */
export const LABEL_TABLES: Readonly<Partial<Record<LocaleId, LocaleLabelTables>>> = {
  he: withUnitLabels("he", LABELS_HE),
  ja: withUnitLabels("ja", LABELS_JA),
  ko: withUnitLabels("ko", LABELS_KO),
  "pt-BR": withUnitLabels("pt-BR", LABELS_PT_BR),
}

/** Translate a node's display label for a locale; unknown/custom labels pass through. */
export function localizeNodeLabel(label: string, locale: LocaleId): string {
  return LABEL_TABLES[locale]?.node[label] ?? label
}

/**
 * Handle labels the code numbers, one pip per slot ("Layer 3" on the overlay
 * nodes, "Screenshot 3" on UGC Script). A table cannot hold every number, so
 * these translate as a whole through the dictionary key that carries the number.
 */
const NUMBERED_HANDLE_LABELS: ReadonlyArray<readonly [RegExp, MessageKey]> = [
  [/^Layer (\d+)$/, "proccfg.overlay.layerN"],
  [/^Screenshot (\d+)$/, "ugc.screenshotN"],
]

/** Translate a handle pip label for a locale; unknown labels pass through. */
export function localizeHandleLabel(label: string, locale: LocaleId): string {
  const hit = LABEL_TABLES[locale]?.handle[label]
  if (hit) return hit
  for (const [pattern, key] of NUMBERED_HANDLE_LABELS) {
    const m = pattern.exec(label)
    if (m) return translate(locale, key, { n: m[1] })
  }
  return label
}

/** Hook: returns a node-label localizer bound to the current locale.
 *  Stable across renders (memoized on locale) so callers can safely list it in
 *  effect/memo dependency arrays without re-running on every render. */
export function useLocalizeNodeLabel(): (label: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((label: string) => localizeNodeLabel(label, locale), [locale])
}

/** Hook: returns a handle-label localizer bound to the current locale. */
export function useLocalizeHandleLabel(): (label: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return (label: string) => localizeHandleLabel(label, locale)
}

/** Translate a factory-preset group name; unknown names pass through. */
export function localizePresetGroup(name: string, locale: LocaleId): string {
  return LABEL_TABLES[locale]?.presetGroup[name] ?? name
}

/** Hook: returns a preset-group localizer bound to the current locale. */
export function useLocalizePresetGroup(): (name: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return (name: string) => localizePresetGroup(name, locale)
}

/** Translate a node-toolbar group header; unknown names pass through. */
export function localizeNodeGroup(name: string, locale: LocaleId): string {
  return LABEL_TABLES[locale]?.nodeGroup[name] ?? name
}

/** Hook: returns a node-group localizer bound to the current locale. */
export function useLocalizeNodeGroup(): (name: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return (name: string) => localizeNodeGroup(name, locale)
}

/** Translate a model description for a locale; unknown copy passes through. */
export function localizeModelDescription(desc: string, locale: LocaleId): string {
  return LABEL_TABLES[locale]?.modelDescription[desc] ?? desc
}

/** Hook: model-description localizer bound to the current locale. */
export function useLocalizeModelDescription(): (desc: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((desc: string) => localizeModelDescription(desc, locale), [locale])
}

/** Translate a dropdown option label for a locale; unknown copy passes through. */
export function localizeOptionLabel(label: string, locale: LocaleId): string {
  const tables = LABEL_TABLES[locale]
  if (!tables) return label
  const whole = tables.option[label]
  if (whole) return whole
  // "<token> (<Qualifier>)" — translate the qualifier. The token stays as
  // written ("16:9", "2K") unless it is itself a whole option label: the
  // transition styles name their default look "Full cover (default)".
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(label)
  if (m) {
    // Case-insensitive on the qualifier: the catalog writes "(fast)",
    // "(best)" and "(default)" in lower case next to "(Fast)" elsewhere.
    const raw = m[2]
    const q = tables.optionQualifier[raw] ?? tables.optionQualifier[raw.charAt(0).toUpperCase() + raw.slice(1)]
    // The parentheses belong to the locale: Japanese sets 16:9（横長）.
    if (q) return translate(locale, "common.qualified", { token: tables.option[m[1]] ?? m[1], qualifier: q })
  }
  return label
}

/**
 * Guard helper: is this English string a KEY of one of the label tables
 * above (a node/handle name, a model description, a dropdown option)? Such a
 * string in a data module is localized at render time by the matching hook,
 * so a raw-English source scan must not count it as a leak.
 */
export function isLocalizedTableKey(s: string): boolean {
  return (Object.entries(LABEL_TABLES) as [LocaleId, LocaleLabelTables][]).some(
    ([locale, t]) =>
      s in t.node || s in t.handle || s in t.modelDescription || s in t.option || s in t.picker || localizeOptionLabel(s, locale) !== s,
  )
}

/**
 * Translate an interface label a parameter picker renders (a section, group,
 * topic or field name). The picker table first, then the option table (the
 * Lighting / Color-Look / Loop Subject section names and the reference-role
 * words live there), then the English.
 */
export function localizePickerLabel(label: string, locale: LocaleId): string {
  const tables = LABEL_TABLES[locale]
  if (!tables) return label
  return tables.picker[label] ?? tables.option[label] ?? label
}

/** Hook: picker-label localizer bound to the current locale (stable per locale). */
export function useLocalizePickerLabel(): (label: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((label: string) => localizePickerLabel(label, locale), [locale])
}

/** Hook: option-label localizer bound to the current locale. */
export function useLocalizeOptionLabel(): (label: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((label: string) => localizeOptionLabel(label, locale), [locale])
}

/**
 * Factory-preset display copy (name + description), keyed by preset id.
 * Partial per locale — a preset with no entry falls back to the catalog's
 * English, so upstream additions never render blank.
 */
export const PRESET_CONTENT_MAPS: Readonly<Partial<Record<LocaleId, Record<string, PresetCopy>>>> = {
  he: { ...PRESET_CONTENT_HE, ...PRESET_TILES_HE },
  ja: { ...PRESET_CONTENT_JA, ...PRESET_TILES_JA },
  ko: { ...PRESET_CONTENT_KO, ...PRESET_TILES_KO },
  "pt-BR": { ...PRESET_CONTENT_PT_BR, ...PRESET_TILES_PT_BR },
}

/** Hook: returns a preset-copy resolver bound to the current locale.
 *  Stable across renders (memoized on locale) so callers can list it in
 *  effect/memo dependency arrays without re-running on every render. */
export function useLocalizePresetCopy(): (id: string, name: string, description?: string) => PresetCopy {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((id: string, name: string, description?: string) => {
    const hit = PRESET_CONTENT_MAPS[locale]?.[id]
    return {
      name: hit?.name ?? name,
      description: hit?.description ?? description,
    }
  }, [locale])
}
