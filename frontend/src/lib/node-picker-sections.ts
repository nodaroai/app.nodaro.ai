/**
 * Turns the family registry into the ordered sections each picker tab renders.
 *
 * Every builder takes the already-filtered option pool (`getNodeOptions()`,
 * which drops `CLOUD_ONLY_NODE_TYPES` when `hasCredits()` is false) and drops
 * any section left with zero rows — so a Community build never renders a
 * header over an empty family (e.g. Video · ANALYZE, whose only two nodes are
 * Cloud-only).
 */
import type { NodeOption } from "@/lib/node-compatibility"
import type { SceneNodeType } from "@/types/nodes"
import {
  AUDIO_ONLY_CONTROL_FAMILY_ID,
  COMMON_SECTIONS,
  CREATIVE_CONTROL_FAMILY_IDS,
  NODE_FAMILIES,
  POPULAR_TYPES,
  TAB_SUPERSET,
  familyById,
  type PickerTab,
} from "@/lib/node-families"

export interface PickerSection {
  /** Stable key — family id, or a `common-*` / `popular` sentinel. */
  readonly id: string
  /** Header text as written; the header style uppercases it. */
  readonly label: string
  readonly options: readonly NodeOption[]
  /** Creative-control sections render as a 2-column grid of shorter rows. */
  readonly control?: boolean
}

const MEDIA_TABS = new Set<PickerTab>(["image", "video", "audio"])
export const isMediaTab = (tab: PickerTab): boolean => MEDIA_TABS.has(tab)

/** Resolve types → options in the given order, silently skipping anything the
 *  pool has filtered out (edition gating, admin-only). */
function pick(
  byType: ReadonlyMap<SceneNodeType, NodeOption>,
  types: readonly SceneNodeType[],
): NodeOption[] {
  const out: NodeOption[] = []
  for (const t of types) {
    const opt = byType.get(t)
    if (opt) out.push(opt)
  }
  return out
}

const indexPool = (pool: readonly NodeOption[]): ReadonlyMap<SceneNodeType, NodeOption> =>
  new Map(pool.map((o) => [o.type, o]))

/** POPULAR — up to 3 shortcuts above the families. Every entry also renders
 *  inside its own family below, so this never hides a node. */
export function popularSection(
  pool: readonly NodeOption[],
  tab: PickerTab,
): PickerSection | null {
  const types = POPULAR_TYPES[tab]
  if (!types) return null
  const options = pick(indexPool(pool), types)
  return options.length ? { id: "popular", label: "Popular", options } : null
}

/** The families a tab renders: the ones it owns (with any superset members
 *  merged in place), then families owned elsewhere that this tab also shows. */
export function tabSections(
  pool: readonly NodeOption[],
  tab: PickerTab,
): PickerSection[] {
  const byType = indexPool(pool)
  const superset = TAB_SUPERSET[tab] ?? {}
  const sections: PickerSection[] = []

  for (const family of NODE_FAMILIES) {
    if (family.tab === "controls") continue
    const isOwned = family.tab === tab
    const extra = superset[family.id]
    if (!isOwned && !extra) continue
    const options = isOwned
      ? [...pick(byType, family.types), ...(extra ? pick(byType, extra) : [])]
      : pick(byType, extra ?? [])
    if (options.length) sections.push({ id: family.id, label: family.label, options })
  }
  return sections
}

/** Creative Controls sub-families. MUSIC & VOICE is Audio-only. */
export function creativeControlSections(
  pool: readonly NodeOption[],
  tab: PickerTab,
): PickerSection[] {
  if (!isMediaTab(tab)) return []
  const byType = indexPool(pool)
  const sections: PickerSection[] = []
  for (const id of CREATIVE_CONTROL_FAMILY_IDS) {
    if (id === AUDIO_ONLY_CONTROL_FAMILY_ID && tab !== "audio") continue
    const family = familyById(id)
    if (!family) continue
    const options = pick(byType, family.types)
    if (options.length) sections.push({ id, label: family.label, options, control: true })
  }
  return sections
}

/** Curated Common tab. Its members all live in a family on another tab too. */
export function commonSections(pool: readonly NodeOption[]): PickerSection[] {
  const byType = indexPool(pool)
  const sections: PickerSection[] = []
  for (const section of COMMON_SECTIONS) {
    const options = pick(byType, section.types)
    if (options.length) sections.push({ id: section.id, label: section.label, options })
  }
  return sections
}

const TAB_PREFIX: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  models: "Models",
  assets: "Assets",
  automate: "Automate",
  publish: "Publish",
  controls: "Creative Controls",
}

/** The All tab — every family exactly once, under a `TAB · FAMILY` header,
 *  in registry order. POPULAR and the curated Common sections are views over
 *  these same nodes and are deliberately not repeated here. */
export function allTabSections(pool: readonly NodeOption[]): PickerSection[] {
  const byType = indexPool(pool)
  const sections: PickerSection[] = []
  for (const family of NODE_FAMILIES) {
    const options = pick(byType, family.types)
    if (!options.length) continue
    sections.push({
      id: family.id,
      label: `${TAB_PREFIX[family.tab] ?? family.tab} · ${family.label}`,
      options,
      control: family.tab === "controls",
    })
  }
  return sections
}

/** Every node type a tab renders, families and Creative Controls included.
 *  Search uses it to split "matches on this tab" from "From other tabs", so
 *  the split can never disagree with what browsing the tab would show. */
export function tabTypeSet(
  pool: readonly NodeOption[],
  tab: PickerTab,
): ReadonlySet<SceneNodeType> {
  const { sections, controls } = sectionsForTab(pool, tab)
  const types = new Set<SceneNodeType>()
  for (const section of [...sections, ...controls])
    for (const option of section.options) types.add(option.type)
  return types
}

/** Every section a tab renders, in order — the flat list keyboard navigation
 *  and the footer count are both derived from this. */
export function sectionsForTab(
  pool: readonly NodeOption[],
  tab: PickerTab,
): { readonly sections: PickerSection[]; readonly controls: PickerSection[] } {
  if (tab === "all") return { sections: allTabSections(pool), controls: [] }
  if (tab === "common") return { sections: commonSections(pool), controls: [] }
  const popular = popularSection(pool, tab)
  return {
    sections: [...(popular ? [popular] : []), ...tabSections(pool, tab)],
    controls: creativeControlSections(pool, tab),
  }
}

/** A collapsible sidebar section: one picker tab, its families inside. */
export interface SidebarSection {
  /** Tab key — the persistence key for open/closed state. */
  readonly id: string
  /** Header text, e.g. "Image". */
  readonly label: string
  readonly families: readonly PickerSection[]
  /** Nodes across all families, shown beside the header. */
  readonly count: number
}

const SIDEBAR_TAB_ORDER = [
  "image", "video", "audio", "models", "assets", "automate", "publish", "controls",
] as const

/** The sidebar's whole tree: tab sections, each holding its families.
 *
 *  The tab is the section rather than a prefix on every header, which is what
 *  gives the family names their context back — "Create" under "Image" reads
 *  correctly, where a bare "Create" under an "AI" category did not, and
 *  Image's Create can no longer collide with Video's. Empty families and empty
 *  sections drop out, so an edition with fewer nodes simply shows less. */
export function sidebarSections(pool: readonly NodeOption[]): SidebarSection[] {
  const byType = indexPool(pool)
  const out: SidebarSection[] = []
  for (const tab of SIDEBAR_TAB_ORDER) {
    const families: PickerSection[] = []
    for (const family of NODE_FAMILIES) {
      if (family.tab !== tab) continue
      const options = pick(byType, family.types)
      if (options.length)
        families.push({ id: family.id, label: family.label, options, control: tab === "controls" })
    }
    if (!families.length) continue
    out.push({
      id: tab,
      label: TAB_PREFIX[tab] ?? tab,
      families,
      count: families.reduce((n, f) => n + f.options.length, 0),
    })
  }
  return out
}
