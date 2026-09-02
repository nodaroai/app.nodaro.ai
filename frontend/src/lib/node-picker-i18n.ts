/**
 * Locale-aware text for the node picker's chrome: the tab names and the
 * `TAB · FAMILY` section headers.
 *
 * The section builders in `node-picker-sections.ts` stay locale-independent —
 * they also drive search partitioning and the flat keyboard index — so they
 * emit structured parts (`family`, the English `NODE_FAMILIES` label, and on
 * the All tab the owning `tab`) and the render path localizes here: the tab
 * name through the chrome dict (`en`/`he`), the family through the node-group
 * table in `i18n/labels.ts`, joined by the same " · " the English header uses.
 * In English every result is byte-identical to the builders' own `label`.
 */
import { useCallback } from "react"
import type { LocaleId } from "@nodaro/shared"
import { useLocaleStore } from "@/lib/locale-store"
import { translate, type MessageKey } from "@/lib/i18n"
import { localizeNodeGroup } from "@/lib/i18n/labels"
import type { NodeFamily, PickerTab } from "@/lib/node-families"

/** A picker tab, or the Creative Controls pseudo-tab that prefixes control
 *  families on the All tab and names the sidebar's last section. */
export type PickerHeaderTab = PickerTab | NodeFamily["tab"]

export const PICKER_TAB_LABEL_KEY: Record<PickerHeaderTab, MessageKey> = {
  common: "addnode.tabCommon",
  image: "addnode.tabImage",
  video: "addnode.tabVideo",
  audio: "addnode.tabAudio",
  models: "addnode.tabModels",
  assets: "addnode.tabAssets",
  automate: "addnode.tabAutomate",
  publish: "addnode.tabPublish",
  all: "addnode.tabAll",
  controls: "addnode.creativeControls",
}

export function pickerTabLabel(tab: PickerHeaderTab, locale: LocaleId): string {
  return translate(locale, PICKER_TAB_LABEL_KEY[tab])
}

/** The parts of a section a header is built from — `PickerSection` and the
 *  sidebar's family entries both satisfy it. */
export interface LocalizablePickerSection {
  /** English family / section name, e.g. "Add Your Own". */
  readonly family: string
  /** Owning tab when the header carries a `TAB · ` prefix (the All tab). */
  readonly tab?: NodeFamily["tab"]
}

/** Header text for a section in a locale: `TAB · FAMILY` when the section is
 *  tab-prefixed, else the family alone. Unknown families pass through in
 *  English rather than rendering blank. */
export function pickerSectionLabel(section: LocalizablePickerSection, locale: LocaleId): string {
  const family = localizeNodeGroup(section.family, locale)
  return section.tab ? `${pickerTabLabel(section.tab, locale)} · ${family}` : family
}

/** Hook: section-header localizer bound to the current locale. Memoized on
 *  locale so callers can list it in dependency arrays. */
export function usePickerSectionLabel(): (section: LocalizablePickerSection) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((section: LocalizablePickerSection) => pickerSectionLabel(section, locale), [locale])
}

/** Hook: tab-name localizer bound to the current locale. */
export function usePickerTabLabel(): (tab: PickerHeaderTab) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((tab: PickerHeaderTab) => pickerTabLabel(tab, locale), [locale])
}
