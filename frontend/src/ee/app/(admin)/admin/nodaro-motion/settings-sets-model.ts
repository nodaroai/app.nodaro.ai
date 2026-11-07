// Admin → Nodaro Motion's stored settings sets, the page's side (pure, over
// the page's section bindings, settings-sections.ts): the page's values as a
// set, which sections differ from live, which stored set is live, and saving
// a loaded draft section by section through each section's own route.

import type { MotionSettings, MotionSettingsSet } from "@/ee/lib/nodaro-motion-settings-sets-api"
import { MOTION_SETTINGS_KEYS, type MotionSettingsBindings, type MotionSettingsKey } from "./settings-sections"

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Whether every section's live setting has loaded (nothing is compared, stored or loaded before). */
export function allReady(bindings: MotionSettingsBindings): boolean {
  return MOTION_SETTINGS_KEYS.every((k) => bindings[k].ready)
}

/** The page as a set: every section's draft, as its Save would send it. */
export function pageSettings(bindings: MotionSettingsBindings): MotionSettings {
  return Object.fromEntries(MOTION_SETTINGS_KEYS.map((k) => [k, bindings[k].draft]))
}

/** The live settings as a set. */
export function liveSettings(bindings: MotionSettingsBindings): MotionSettings {
  return Object.fromEntries(MOTION_SETTINGS_KEYS.map((k) => [k, bindings[k].live]))
}

/** The sections whose draft differs from live: what a Save would send. */
export function changedSections(bindings: MotionSettingsBindings): MotionSettingsKey[] {
  return MOTION_SETTINGS_KEYS.filter((k) => bindings[k].ready && !same(bindings[k].draft, bindings[k].live))
}

function isKey(key: string): key is MotionSettingsKey {
  return (MOTION_SETTINGS_KEYS as readonly string[]).includes(key)
}

/**
 * Whether the live settings are `settings`: each section it names, as the page would save it once loaded, equals the
 * live one (a section it does not name is not in it). A set that names no section matches nothing.
 */
export function matchesLive(bindings: MotionSettingsBindings, settings: MotionSettings): boolean {
  const keys = Object.keys(settings)
  if (keys.length === 0) return false
  return keys.every((k) => isKey(k) && bindings[k].ready && same(bindings[k].canon(settings[k]), bindings[k].live))
}

export type LiveMarker = { set: MotionSettingsSet; edited: false } | { set: MotionSettingsSet; edited: true } | null

const newest = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "")

/**
 * Which stored set is live: one the live settings match ("Live: <name>"; of several, the one marked live last, then
 * the one saved last); else the set they matched last ("<name>, edited"); else none. Nothing until every section loaded.
 */
export function liveMarker(bindings: MotionSettingsBindings, sets: readonly MotionSettingsSet[]): LiveMarker {
  if (!allReady(bindings)) return null
  const matching = sets.filter((s) => !s.unreadable && matchesLive(bindings, s.settings))
  if (matching.length > 0) {
    const set = [...matching].sort((a, b) => newest(b.liveAt, a.liveAt) || newest(b.updatedAt, a.updatedAt))[0]!
    return { set, edited: false }
  }
  const last = [...sets].filter((s) => s.liveAt).sort((a, b) => newest(b.liveAt, a.liveAt))[0]
  return last ? { set: last, edited: true } : null
}

/** Whether `set` must be marked as the one live now: it is live, and not the set marked live last. */
export function needsLiveMark(marker: LiveMarker, sets: readonly MotionSettingsSet[]): boolean {
  if (!marker || marker.edited) return false
  const latest = [...sets].filter((s) => s.liveAt).sort((a, b) => newest(b.liveAt, a.liveAt))[0]
  return !latest || latest.id !== marker.set.id
}

/** Fill the page from `settings`: each section it names loaded, every other one back to live. */
export function loadSettings(bindings: MotionSettingsBindings, settings: MotionSettings): void {
  for (const k of MOTION_SETTINGS_KEYS) {
    if (Object.hasOwn(settings, k)) bindings[k].load(settings[k])
    else bindings[k].reset()
  }
}

/** Every section back to its live setting. */
export function resetAll(bindings: MotionSettingsBindings): void {
  for (const k of MOTION_SETTINGS_KEYS) bindings[k].reset()
}

export type SectionSaveResult = { key: MotionSettingsKey; ok: true } | { key: MotionSettingsKey; ok: false; message: string }

/**
 * Save every section that differs from live, through each section's own route, in `order` (the server's: the Flex
 * wording first, the engine prompt last). A section its route refuses is tried once more after the others saved —
 * the engine prompt and the masking it runs with are each checked against the other's SAVED value — and the result of
 * each section is answered. Never stops at the first refusal.
 */
export async function saveChangedSections(
  bindings: MotionSettingsBindings,
  order: readonly string[],
): Promise<SectionSaveResult[]> {
  const ordered = [...order.filter(isKey), ...MOTION_SETTINGS_KEYS.filter((k) => !order.includes(k))]
  const changed = new Set(changedSections(bindings))
  let pending = ordered.filter((k) => changed.has(k))
  const results = new Map<MotionSettingsKey, SectionSaveResult>()
  for (let pass = 0; pass < 2 && pending.length > 0; pass++) {
    let saved = 0
    for (const key of pending) {
      try {
        await bindings[key].save(bindings[key].draft)
        results.set(key, { key, ok: true })
        saved++
      } catch (e) {
        results.set(key, { key, ok: false, message: e instanceof Error ? e.message : String(e) })
      }
    }
    pending = pending.filter((k) => !results.get(k)!.ok)
    // A second pass only helps when something saved in this one.
    if (saved === 0) break
  }
  return ordered.filter((k) => results.has(k)).map((k) => results.get(k)!)
}

/** The file name an export downloads as: the set's name, made safe, and the day. */
export function exportFileName(name: string, now: Date = new Date()): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `nodaro-motion-${slug || "settings"}-${now.toISOString().slice(0, 10)}.json`
}
