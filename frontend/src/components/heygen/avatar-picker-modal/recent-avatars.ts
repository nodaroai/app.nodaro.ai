// "Recently used" for the avatar picker — the last looks this browser picked,
// most recent first. Kept in localStorage (no server round-trip: it is a
// convenience list, not data), capped, and tolerant of a broken/blocked store.

const KEY = "nodaro:heygen-recent-avatars"
const MAX = 12

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null
  } catch {
    return null
  }
}

export function readRecentAvatarIds(): string[] {
  try {
    const raw = storage()?.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX) : []
  } catch {
    return []
  }
}

/** Put `avatarId` first (deduped) and persist; returns the new list. */
export function rememberRecentAvatar(avatarId: string, prev: readonly string[] = readRecentAvatarIds()): string[] {
  const next = [avatarId, ...prev.filter((id) => id !== avatarId)].slice(0, MAX)
  try {
    storage()?.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode / quota — the list is a nicety, never a failure.
  }
  return next
}
