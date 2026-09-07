/**
 * The parts of `settings.studio` that must not leave the owner's account.
 *
 * A shared production is read by anyone with the link. Three things inside the
 * document are the OWNER'S working state and nobody else's business:
 *
 * - `trash` — the recycle bin, which holds every shot, still and clip they
 *   deleted, with prompts and urls intact. A share viewer receiving the bin is
 *   the sharpest of the three: it hands out work the owner explicitly threw away.
 * - the in-flight job markers — `pendingClips` / `pendingStills`. A viewer
 *   cannot land them and does not own them; all they carry across is job ids.
 * - `freecutDraftUrl` — an unsaved editor draft.
 *
 * They do NOT all live at the same level, and that is the whole reason this
 * file exists rather than one array: the codec writes `trash` and
 * `freecutDraftUrl` on `settings.studio` itself, and writes the in-flight
 * markers PER SHOT, on the `settings.studio.shots[]` entry
 * (`shot-graph-write.ts` — `pendingClips`; `pendingStills` lands there with the
 * generation routes, D5, and `view.ts` already reads it there). A strip that
 * walked only the top level would pass its own test and still hand a share
 * viewer every marker in the production.
 */

/**
 * `settings.studio`'s OWN transient keys.
 *
 * The pending lists are on this list as well as the per-shot one on purpose:
 * nothing writes them here today, and a stray one from an older client — or
 * from something that is not this codec at all — still must not ride out to a
 * viewer.
 */
export const TRANSIENT_STUDIO_KEYS = [
  "trash",
  "pendingStills",
  "pendingClips",
  "freecutDraftUrl",
] as const

/**
 * ...and a SHOT entry's, which is where the markers actually are.
 *
 * `pendingClip` (singular) is the pre-concurrent-markers shape; `readPendingClips`
 * still migrates it on parse, so a row can still be carrying one and it is still
 * in-flight state.
 */
export const TRANSIENT_SHOT_KEYS = ["pendingClips", "pendingClip", "pendingStills"] as const

function withoutKeys(
  source: Record<string, unknown>,
  drop: ReadonlyArray<string>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (drop.includes(key)) continue
    kept[key] = value
  }
  return kept
}

/**
 * `settings.studio.shots` with every shot's in-flight markers removed.
 *
 * Returns the SAME array when no shot carried one, so an idle production's
 * share read allocates nothing. Anything that is not a shot-shaped object rides
 * through untouched: this runs on whatever is in the column, and a projection
 * that threw on an unexpected row would take the share read down with it.
 */
function stripShots(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  let changed = false
  const out = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry
    const shot = entry as Record<string, unknown>
    if (!TRANSIENT_SHOT_KEYS.some((key) => key in shot)) return entry
    changed = true
    return withoutKeys(shot, TRANSIENT_SHOT_KEYS)
  })
  return changed ? out : value
}

/**
 * A production's `settings` with the owner's working state removed.
 *
 * Copy-on-write, and structurally: it rebuilds the objects without those keys
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
  const kept = withoutKeys(source, TRANSIENT_STUDIO_KEYS)
  const shots = stripShots(source.shots)
  if (source.shots !== undefined) kept.shots = shots

  // Nothing to drop at either level — hand back the original object so an
  // ordinary share read allocates nothing.
  if (
    Object.keys(kept).length === Object.keys(source).length &&
    shots === source.shots
  ) {
    return settings
  }
  return { ...settings, studio: kept }
}
