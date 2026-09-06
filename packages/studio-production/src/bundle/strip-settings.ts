/**
 * The keys of `settings.studio` that must not leave the owner's account.
 *
 * A shared production is read by anyone with the link. Four things inside the
 * document are the OWNER'S working state and nobody else's business:
 *
 * - `trash` — the recycle bin, which holds every shot, still and clip they
 *   deleted, with prompts and urls intact. A share viewer receiving the bin is
 *   the sharpest of the four: it hands out work the owner explicitly threw away.
 * - `pendingStills` / `pendingClips` — jobs in flight. A viewer cannot land them
 *   and does not own them; all they carry across is job ids.
 * - `freecutDraftUrl` — an unsaved editor draft.
 *
 * The bundle exporter already strips them on its own path. This is the same
 * list, so the two cannot disagree about what "transient" means.
 */
export const TRANSIENT_STUDIO_KEYS = [
  "trash",
  "pendingStills",
  "pendingClips",
  "freecutDraftUrl",
] as const

/**
 * A production's `settings` with the owner's working state removed.
 *
 * Copy-on-write, and structurally: it rebuilds the object without those keys
 * rather than deleting from the caller's, so the stored row is untouched. A
 * `settings` with no `studio` comes back unchanged — this is a studio concern,
 * and a workflow that is not a production has nothing here to strip.
 */
export function stripTransientSettings(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!settings || typeof settings !== "object") return settings
  const studio = (settings as { studio?: unknown }).studio
  if (!studio || typeof studio !== "object" || Array.isArray(studio)) return settings

  const source = studio as Record<string, unknown>
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if ((TRANSIENT_STUDIO_KEYS as ReadonlyArray<string>).includes(key)) continue
    kept[key] = value
  }
  // Every key survived — hand back the original object so an ordinary share
  // read allocates nothing.
  if (Object.keys(kept).length === Object.keys(source).length) return settings
  return { ...settings, studio: kept }
}
