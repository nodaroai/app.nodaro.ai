/**
 * The settings basis each clip's render would stamp now, keyed by its clip
 * (A4-2; any render since C3.4): `renders` are the render's rows, `basisOf` the
 * render's own basis of one row (`renderSettingsBasisFor`: Apply EDL's or
 * Speaker View's), `planOutput` the plan's list as the canvas holds it (a hole
 * at a dropped clip). A row with no EDL (a hole) has none.
 */
import { renderClipKey, type RenderPlanHop } from "@nodaro/shared"

export function clipRenderBasesBy<R extends { readonly row?: number }>(
  renders: readonly R[],
  basisOf: (render: R) => string | undefined,
  planOutput: unknown,
  hops: readonly RenderPlanHop[],
): Map<string, string> {
  const bases = new Map<string, string>()
  for (const render of renders) {
    const key = renderClipKey(planOutput, render.row, hops)
    const basis = key ? basisOf(render) : undefined
    if (key && basis && !bases.has(key)) bases.set(key, basis)
  }
  return bases
}
