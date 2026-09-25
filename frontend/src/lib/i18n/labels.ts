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
import type { LocaleId } from "@nodaro/shared"
import { PRESET_CONTENT_HE, type PresetCopy } from "./preset-content.he"
import type { LocaleLabelTables } from "./label-tables"
import { LABELS_HE } from "./labels.he"
import { LABELS_JA } from "./labels.ja"
import { PRESET_CONTENT_JA } from "./preset-content.ja"
import { translate } from "./index"

/**
 * Every locale's label tables. The coverage guards iterate this registry, so a
 * locale added here is checked for complete tables the day it is added.
 */
export const LABEL_TABLES: Readonly<Partial<Record<LocaleId, LocaleLabelTables>>> = { he: LABELS_HE, ja: LABELS_JA }

/** Translate a node's display label for a locale; unknown/custom labels pass through. */
export function localizeNodeLabel(label: string, locale: LocaleId): string {
  return LABEL_TABLES[locale]?.node[label] ?? label
}

/** Translate a handle pip label for a locale; unknown labels pass through. */
export function localizeHandleLabel(label: string, locale: LocaleId): string {
  return LABEL_TABLES[locale]?.handle[label] ?? label
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
  // "<token> (<Qualifier>)" — translate the qualifier, keep the token.
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(label)
  if (m) {
    // Case-insensitive on the qualifier: the catalog writes "(fast)",
    // "(best)" and "(default)" in lower case next to "(Fast)" elsewhere.
    const raw = m[2]
    const q = tables.optionQualifier[raw] ?? tables.optionQualifier[raw.charAt(0).toUpperCase() + raw.slice(1)]
    // The parentheses belong to the locale: Japanese sets 16:9（横長）.
    if (q) return translate(locale, "common.qualified", { token: m[1], qualifier: q })
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
      s in t.node || s in t.handle || s in t.modelDescription || s in t.option || localizeOptionLabel(s, locale) !== s,
  )
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
export const PRESET_CONTENT_MAPS: Readonly<Partial<Record<LocaleId, Record<string, PresetCopy>>>> = { he: PRESET_CONTENT_HE, ja: PRESET_CONTENT_JA }

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
