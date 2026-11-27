/**
 * Video Remake's part of the clip and short clips (decided 2026-11-25), two engine features behind
 * per-deployment engine switches.
 *
 *   A part of the clip   request (run, estimate, plan-roles)  portionStart (seconds, ≥ 0), portionSec (seconds)
 *                        an ordinary run of that length, priced by it; not with `preview: true`, never
 *                        on a trend run; with a part (or a 4 s preview) the source may be longer than
 *                        30 s, up to 10 minutes. The job's input echoes both fields; the completed
 *                        output's `durationSec` is the part's length.
 *   Short clips          a clip of 2–30 s instead of 4–30 s (padded in time, run and cut back; priced at
 *                        the padded length). A 4 s preview of a clip under 4 s stays refused.
 *
 * The engine is the authority on every rule and refusal (400 `portion_unavailable`,
 * `portion_incomplete`, `portion_with_preview`, `portion_not_for_trends`, `portion_out_of_range`,
 * `source_too_long`, `long_source_unpriceable`). The platform only says whether the loaded engine
 * declares each one (`castSwap.portion`, `castSwap.shortClips`, read at load), never from a setting.
 */
import type { PluginSupports } from "./private-plugins/types.js"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

/** Whether an engine's supports take a part of the clip (`castSwap.portion`). */
export function engineTakesPortion(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.portion === true
}

/** Whether this process's Cast Swap engine takes a part of the clip. An engine without it is never sent the fields by MCP. */
export function loadedEngineTakesPortion(): boolean {
  return engineTakesPortion(getPluginSupports().castSwap)
}

/** Whether an engine's supports take a clip of 2 s or more (`castSwap.shortClips`); absent: 4 s or more. */
export function engineTakesShortClips(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.shortClips === true
}
