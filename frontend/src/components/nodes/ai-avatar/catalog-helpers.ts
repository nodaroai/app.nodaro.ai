// Pure helpers behind the AI Avatar node body — catalog shaping and the small
// bits of display copy. No React, no store: everything here is unit-tested.

import type { HeygenAvatar, HeygenVoice } from "@/lib/api"
import { avatarIsUsable } from "@/components/heygen/heygen-catalog"

/**
 * HeyGen look names read "Cora Office 4" — the person, then the scene. The
 * quick-pick tile shows them on two lines (name / meta) the way the design
 * does, so split on the first space.
 */
export function splitLookName(name: string): { person: string; scene: string } {
  const trimmed = name.trim()
  const space = trimmed.indexOf(" ")
  if (space < 0) return { person: trimmed, scene: "" }
  return { person: trimmed.slice(0, space), scene: trimmed.slice(space + 1).trim() }
}

/**
 * The looks shown as the on-node quick pick. The raw catalog opens with a
 * dozen looks of the same person (Cora Office 4, Cora Livingroom 1, …), which
 * makes a poor first row — take ONE look per person in catalog order, and only
 * when the catalog has fewer persons than `n`, top up with further distinct
 * looks. Deterministic (no shuffling), so the row is stable across renders.
 * A look HeyGen is still building (or failed) is never featured — the row is
 * for picking; the full picker shows those with their status.
 */
export function pickFeaturedAvatars(
  catalog: ReadonlyArray<HeygenAvatar>,
  n: number,
): HeygenAvatar[] {
  const avatars = catalog.filter(avatarIsUsable)
  const seenPersons = new Set<string>()
  const featured: HeygenAvatar[] = []
  for (const a of avatars) {
    if (featured.length >= n) break
    const { person } = splitLookName(a.name)
    const key = person.toLowerCase()
    if (seenPersons.has(key)) continue
    seenPersons.add(key)
    featured.push(a)
  }
  if (featured.length < n) {
    const taken = new Set(featured.map((a) => a.avatarId))
    for (const a of avatars) {
      if (featured.length >= n) break
      if (taken.has(a.avatarId)) continue
      taken.add(a.avatarId)
      featured.push(a)
    }
  }
  return featured
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * Display name + "Language · Gender" for a voice. The catalog is not clean —
 * real rows carry names like "\nAllison  ", an empty language and gender
 * "unknown" (avatar default voices) — so trim and drop empty segments rather
 * than printing "· Unknown".
 */
export function describeVoice(voice: HeygenVoice): { name: string; meta: string } {
  const language = voice.language?.trim() ?? ""
  const gender = voice.gender?.trim().toLowerCase() ?? ""
  const parts = [language, gender && gender !== "unknown" ? capitalize(gender) : ""].filter(Boolean)
  return { name: voice.name.trim(), meta: parts.join(" · ") }
}

/** Rough speaking pace for the "~9s" estimate: ~15 characters a second. */
const CHARS_PER_SECOND = 15

/** Whole seconds a script of `chars` characters takes at `voiceSpeed`×. */
export function estimateSpeechSeconds(chars: number, voiceSpeed: number): number {
  if (chars <= 0) return 0
  const speed = voiceSpeed > 0 ? voiceSpeed : 1
  return Math.max(1, Math.round(chars / (CHARS_PER_SECOND * speed)))
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/** "148 chars · ~9s" — the script kicker's right-hand meta. */
export function formatScriptMeta(script: string, voiceSpeed: number): string {
  const chars = script.length
  const head = `${chars.toLocaleString("en-US")} chars`
  if (chars === 0) return head
  return `${head} · ~${formatDuration(estimateSpeechSeconds(chars, voiceSpeed))}`
}
