/**
 * Is the take the inspector plays cut from the edit as it stands (R1, R19,
 * decided 2026-10-06)? A render's take carries two stamps (A3-1):
 *
 *  - `planBasis`: the plan value it was cut from (`renderReadBasis`), stamped
 *    only when that was the plan's own value (the same-run rule);
 *  - `renderBasis`: the render's own settings and the effective sources of the
 *    cut (`effectiveRenderBasis`).
 *
 * The take is FRESH when both equal what the render would stamp now: the plan
 * basis a run with its pass-through nodes would read
 * (`currentRenderPlanBasis`, apply-edl-stamps.ts — with the not-yet-written
 * edit applied) and the render's settings basis (`renderSettingsBasisOf`). A
 * take without a stamp it needs is UNKNOWN: it reads stale only when the plan
 * holds an applied edit, and never blocks anything (it fails open).
 */
import { buildEffectiveEdl, effectiveRenderBasis } from "@nodaro/render-rules"
import { normalizeEdl, type RenderResultStamp } from "@nodaro/shared"
import type { ApplyEdlRenderInput, ApplyEdlRenderSettings } from "@/lib/edl-validity"

/** What the render would stamp now. */
export interface CurrentRenderBases {
  readonly planBasis?: string
  readonly renderBasis?: string
}

/** The render's settings basis for one render it makes (its EDL and Sources
 *  media), exactly as the route stamps it. `undefined` when there is no EDL to
 *  build the effective one from. */
export function renderSettingsBasisOf(
  render: Pick<ApplyEdlRenderInput, "edl" | "sources"> | undefined,
  settings: ApplyEdlRenderSettings,
): string | undefined {
  if (!render || render.edl === undefined || render.edl === null || render.edl === "") return undefined
  try {
    const raw = typeof render.edl === "string" ? JSON.parse(render.edl) : render.edl
    const effective = buildEffectiveEdl(normalizeEdl(raw), { crossfadeMs: settings.crossfadeMs, sourceOverrides: render.sources })
    return effectiveRenderBasis(effective, settings)
  } catch {
    return undefined
  }
}

/** True when both stamps equal the render's now, false when either differs,
 *  `undefined` when there is no take or a stamp (on it, or now) is missing. */
export function isFreshTake(take: RenderResultStamp | undefined, now: CurrentRenderBases): boolean | undefined {
  if (!take || !take.planBasis || !take.renderBasis || !now.planBasis || !now.renderBasis) return undefined
  return take.planBasis === now.planBasis && take.renderBasis === now.renderBasis
}

/** Does the stale-preview banner show (R4 a)? For a stale take; for an unknown
 *  one only when the plan holds an applied edit; never with no take. */
export function showsStaleTake(fresh: boolean | undefined, hasTake: boolean, planHasEdit: boolean): boolean {
  if (!hasTake) return false
  return fresh === false || (fresh === undefined && planHasEdit)
}
