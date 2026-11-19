/**
 * When the prompt parts that came with the shot lock and the 3D previz clips
 * may be saved: the `previz` key of an engine's entry in
 * `nodaro_motion_prompt_parts`, and an override of the part ids `shotLock`,
 * `sound` or `referenceOnly` under any key.
 *
 * The Video Remake settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An app from before these
 * reads the row strictly: an entry holding the key, or an override of one of
 * the part ids, is invalid to it, and it drops that engine's WHOLE entry —
 * every override of that engine, for every run there. So a save that sets or
 * changes one is held (422 `platform_unsupported`) until every environment's
 * platform claims that it takes them (`PlatformSupports.previzPromptParts`,
 * fresh). A save that leaves them as they are, or removes them, is never held.
 *
 * The engine is a separate matter: one that does not declare `castSwap.previz`
 * or `castSwap.shotLock` never reads the key or writes the line, so nothing is
 * mis-read there; this environment's engine must declare `castSwap.previz` to
 * check a previz entry at all (the route's 503).
 */
import { CAST_SWAP_PREVIZ_ERA_PART_IDS } from "@nodaro/render-rules"
import { NODARO_MOTION_ENGINES } from "@nodaro/shared/models"
import { NODARO_MOTION_PROMPT_PARTS_KEYS, type NodaroMotionPromptParts, type NodaroMotionPromptPartTexts } from "../../lib/nodaro-motion-prompt-parts.js"
import { TREND_PUBLISH_ENVIRONMENTS, platformOf, type EngineEnvironment } from "./engine-environments.js"
import { PLATFORM_UNSUPPORTED, type PlatformHold } from "./nodaro-motion-face-mesh.js"

/** The refusal (400 `previz_engine`) of anything previz for Nodaro Pulse: it takes no 3D previz clip, so an entry for it would never be read. */
export const PULSE_TAKES_NO_PREVIZ_MESSAGE = "Nodaro Pulse takes no 3D previz clip, so it has no previz prompt."

/** Whether `a` and `b` hold the same texts (both absent counts as the same). */
function sameTexts(a: NodaroMotionPromptPartTexts | undefined, b: NodaroMotionPromptPartTexts | undefined): boolean {
  const ka = Object.keys(a ?? {})
  const kb = Object.keys(b ?? {})
  return ka.length === kb.length && ka.every((id) => (a as Record<string, string>)[id] === (b as Record<string, string> | undefined)?.[id])
}

/**
 * Whether `next` sets or changes, over `before`, what an app from before the
 * previz clips cannot read: an engine's `previz` entry, or an override of one
 * of the part ids that came with it under any key. Removing one does not count.
 */
export function previzPromptPartsSetOrChanged(next: NodaroMotionPromptParts, before: NodaroMotionPromptParts | null): boolean {
  return NODARO_MOTION_ENGINES.some((engine) => {
    const entry = next[engine]
    if (!entry) return false
    if (entry.previz !== undefined && !sameTexts(entry.previz, before?.[engine]?.previz)) return true
    return NODARO_MOTION_PROMPT_PARTS_KEYS.some((key) =>
      CAST_SWAP_PREVIZ_ERA_PART_IDS.some((id) => entry[key]?.[id] !== undefined && entry[key]?.[id] !== before?.[engine]?.[key]?.[id]),
    )
  })
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * platform does not claim (fresh, `platformOf`) that it takes these prompt
 * parts (`PlatformSupports.previzPromptParts`). Empty = every one does, now.
 */
export function environmentsWhosePlatformCannotTakePrevizPromptParts(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.previzPromptParts !== true)
}

/** The hold of a save that sets or changes one (`previzPromptPartsSetOrChanged`), or null: every environment's platform takes them. */
export function platformHoldOfPrevizPromptParts(environments: readonly EngineEnvironment[], now: number = Date.now()): PlatformHold | null {
  const lacking = environmentsWhosePlatformCannotTakePrevizPromptParts(environments, now)
  if (lacking.length === 0) return null
  const list = lacking.join(" and ")
  return {
    code: PLATFORM_UNSUPPORTED,
    message: `The platform in ${list} does not take the shot lock's or the 3D previz clips' prompt parts yet, and this setting is shared by every environment: leave them empty, or wait until ${list} ${lacking.length === 1 ? "is" : "are"} updated.`,
    envs: lacking,
  }
}
