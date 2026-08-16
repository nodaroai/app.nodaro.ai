// Pure model behind the Avatar Picker modal ("Choose an avatar" — design:
// Avatar Picker Modal). The HeyGen catalog is a flat list of LOOKS ("Cora
// Office 4", "Cora Livingroom 1", …); the modal browses PEOPLE — one card per
// presenter (HeyGen avatar group) with the count of their looks — and lets
// you pick a look inside. Everything here is data-only and unit-tested; the
// components render it.

import type { HeygenAvatar } from "@/lib/api"
import { avatarIsUsable, avatarSupportsV, normalizeGender } from "@/components/heygen/heygen-catalog"
import { personKeyOf, splitLookName } from "@/components/nodes/ai-avatar/catalog-helpers"

/** One presenter and every look of theirs, in catalog order. */
export interface Person {
  /** The grouping key (`personKeyOf`): HeyGen's avatar group, else the first name. */
  readonly key: string
  /** Display name — see `personDisplayName`. */
  readonly name: string
  readonly looks: readonly HeygenAvatar[]
  /** Folded gender of the looks ("female" | "male" | "unknown"). */
  readonly gender: string
  /** Distinct scenes across the looks ("Office", "Livingroom", …), catalog order. */
  readonly scenes: readonly string[]
  /** Any look supports Avatar V. */
  readonly supportsV: boolean
  /** Any look is the account's own. */
  readonly own: boolean
  /** The look shown on the card. */
  readonly cover: HeygenAvatar
}

export type PickerLibrary = "all" | "own" | "recent"
export type PickerGender = "all" | string
export type PickerScene = "all" | string

export interface PickerFilters {
  readonly query: string
  readonly library: PickerLibrary
  readonly gender: PickerGender
  readonly scene: PickerScene
  readonly onlyAvatarV: boolean
}

export const DEFAULT_FILTERS: PickerFilters = {
  query: "",
  library: "all",
  gender: "all",
  scene: "all",
  onlyAvatarV: false,
}

/** "female" → "Female"; "" → "". */
export function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "Office 4" → "Office"; "Modern Corporate 2" → "Modern Corporate"; "" → "". */
export function sceneOf(look: HeygenAvatar): string {
  return splitLookName(look.name).scene.replace(/\s*\d+$/, "").trim()
}

/** HeyGen spells the same scene several ways ("Living Room" / "Livingroom",
 *  "LIVING ROOM"): one facet key for all of them — the label is the first
 *  spelling seen. */
export function sceneKey(scene: string): string {
  return scene.toLowerCase().replace(/[\s_-]+/g, "")
}

/** Count looks per scene key, keeping the first spelling as the label. */
function sceneCounts(looks: readonly HeygenAvatar[]): Map<string, { label: string; n: number }> {
  const counts = new Map<string, { label: string; n: number }>()
  for (const look of looks) {
    const s = sceneOf(look)
    if (!s) continue
    const k = sceneKey(s)
    const cur = counts.get(k)
    counts.set(k, cur ? { label: cur.label, n: cur.n + 1 } : { label: s, n: 1 })
  }
  return counts
}

/** The first word of a look name without trailing punctuation ("VERA," → "VERA"). */
function firstWord(name: string): string {
  return splitLookName(name).person.replace(/[,:;.!]+$/, "")
}

/**
 * The name to show for a group of looks. HeyGen names looks three ways —
 * "Cora Office 4" (person first), a bare "Zion" (the base look), or a
 * descriptive "Charismatic Professional 3" — so: a bare single-word look wins
 * (that IS the person's name), else the most common first word across the
 * group; an all-caps source is title-cased ("AINA" → "Aina").
 */
export function personDisplayName(looks: readonly HeygenAvatar[]): string {
  const bare = looks.find((l) => l.name.trim().length > 0 && !l.name.trim().includes(" "))
  let raw = bare?.name.trim() ?? ""
  if (!raw) {
    const counts = new Map<string, { label: string; n: number }>()
    for (const l of looks) {
      const label = firstWord(l.name)
      const k = label.toLowerCase()
      if (!k) continue
      const cur = counts.get(k)
      counts.set(k, cur ? { label: cur.label, n: cur.n + 1 } : { label, n: 1 })
    }
    let best: { label: string; n: number } | undefined
    for (const e of counts.values()) if (!best || e.n > best.n) best = e
    raw = best?.label ?? looks[0]?.name.trim() ?? ""
  }
  return raw.length > 1 && raw === raw.toUpperCase() ? capitalize(raw.toLowerCase()) : raw
}

/** Is the look named "Person Scene N" (its first word IS the person's name)?
 *  "Vera, la Consultante 2" is not — the comma makes it a title, kept whole. */
function isPersonFirst(look: HeygenAvatar, person: Person): boolean {
  return splitLookName(look.name).person.toLowerCase() === person.name.toLowerCase()
}

/**
 * The label of one look inside its person: the scene when the look is named
 * "Person Scene N", the whole name when it is descriptive ("Charismatic
 * Professional 3"), the name itself for a bare base look.
 */
export function lookLabel(look: HeygenAvatar, person: Person): string {
  const { scene } = splitLookName(look.name)
  if (!scene) return look.name.trim()
  return isPersonFirst(look, person) ? scene : look.name.trim()
}

/** Group the flat look list into people, catalog order (private looks come
 *  first in the merged catalog, so an account's own presenters lead). */
export function groupByPerson(looks: readonly HeygenAvatar[]): Person[] {
  const order: string[] = []
  const buckets = new Map<string, HeygenAvatar[]>()
  for (const look of looks) {
    const key = personKeyOf(look)
    const bucket = buckets.get(key)
    // The bucket is local to this pass (it never escapes until it becomes a
    // Person below), so appending in place is not a mutation anyone can see.
    if (bucket) bucket.push(look)
    else {
      buckets.set(key, [look])
      order.push(key)
    }
  }
  return order.map((key) => {
    const bucket = buckets.get(key) ?? []
    return {
      key,
      name: personDisplayName(bucket),
      looks: bucket,
      gender: bucket.map((l) => normalizeGender(l.gender)).find((g) => g !== "unknown") ?? "unknown",
      scenes: Array.from(sceneCounts(bucket).values()).map((e) => e.label),
      supportsV: bucket.some(avatarSupportsV),
      own: bucket.some((l) => l.ownership === "private"),
      cover: bucket.find(avatarIsUsable) ?? bucket[0],
    }
  })
}

/** The scene facet: scenes by how many looks they cover, most common first
 *  (spelling variants merged — see sceneKey). */
export function deriveScenes(looks: readonly HeygenAvatar[], max = 10): string[] {
  return Array.from(sceneCounts(looks).values())
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, max)
    .map((e) => e.label)
}

/** The person's most common scene ("Office") — the card's meta line. Only
 *  looks named "Person Scene N" count: a descriptive look name ("Charismatic
 *  Professional 3") has no scene part worth the name. */
export function dominantScene(person: Person): string {
  const named = person.looks.filter((l) => isPersonFirst(l, person))
  let best: { label: string; n: number } | undefined
  for (const e of sceneCounts(named).values()) if (!best || e.n > best.n) best = e
  return best?.label ?? ""
}

/** Distinct (folded) genders present among the people, sorted. */
export function derivePersonGenders(people: readonly Person[]): string[] {
  return Array.from(new Set(people.map((p) => p.gender))).sort()
}

/**
 * Filter people (and, inside each, their looks) by the active controls. A
 * person stays when at least one look survives; the returned person carries
 * only the surviving looks so the detail column and the counts reflect the
 * filters. `recentIds` feeds the "Recently used" library; "Your own looks"
 * keeps only the account's own looks of a person.
 */
export function filterPeople(
  people: readonly Person[],
  filters: PickerFilters,
  recentIds: readonly string[] = [],
): Person[] {
  const q = filters.query.trim().toLowerCase()
  const recent = new Set(recentIds)
  const out: Person[] = []
  for (const person of people) {
    if (filters.gender !== "all" && person.gender !== filters.gender) continue
    let looks = person.looks
    if (filters.library === "own") looks = looks.filter((l) => l.ownership === "private")
    if (filters.library === "recent") looks = looks.filter((l) => recent.has(l.avatarId))
    if (filters.scene !== "all") looks = looks.filter((l) => sceneKey(sceneOf(l)) === sceneKey(filters.scene))
    if (filters.onlyAvatarV) looks = looks.filter(avatarSupportsV)
    if (q) looks = looks.filter((l) => l.name.toLowerCase().includes(q))
    if (looks.length === 0) continue
    out.push(looks === person.looks ? person : { ...person, looks, cover: looks.find(avatarIsUsable) ?? looks[0] })
  }
  return out
}

/** Sort for the "Recently used" library: most recent first. */
export function sortByRecency(people: readonly Person[], recentIds: readonly string[]): Person[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]))
  const best = (p: Person) =>
    p.looks.reduce((m, l) => Math.min(m, rank.get(l.avatarId) ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
  return [...people].sort((a, b) => best(a) - best(b))
}

/** How many of the account's own looks the people hold. */
export function countOwnLooks(people: readonly Person[]): number {
  return people.reduce((n, p) => n + p.looks.filter((l) => l.ownership === "private").length, 0)
}

/** "12 people · 42 looks in view" */
export function describeSelection(people: readonly Person[]): string {
  const looks = people.reduce((n, p) => n + p.looks.length, 0)
  return `${people.length.toLocaleString("en-US")} ${people.length === 1 ? "person" : "people"} · ${looks.toLocaleString("en-US")} ${looks === 1 ? "look" : "looks"} in view`
}

/** Where the current avatar sits: its person and look — or the first person. */
export function locateLook(people: readonly Person[], avatarId: string | undefined): { person: Person; look: HeygenAvatar } | null {
  if (avatarId) {
    for (const person of people) {
      const look = person.looks.find((l) => l.avatarId === avatarId)
      if (look) return { person, look }
    }
  }
  const first = people[0]
  return first ? { person: first, look: first.cover } : null
}

/** "Female · Office" — gender, then the person's most common scene (the
 *  count of looks is the pill on the image, not repeated here). */
export function personMeta(person: Person): string {
  const gender = capitalize(person.gender === "unknown" ? "" : person.gender)
  const scene = dominantScene(person)
  return [gender, scene].filter(Boolean).join(" · ") || "—"
}

/** Human labels for HeyGen engine ids. */
export function engineLabels(look: HeygenAvatar): string[] {
  const map: Record<string, string> = { avatar_v: "Avatar V", avatar_iv: "Avatar IV", avatar_iii: "Avatar III" }
  const known = (look.supportedEngines ?? []).map((e) => map[e]).filter((s): s is string => !!s)
  return known.length ? known : ["Avatar IV"]
}
