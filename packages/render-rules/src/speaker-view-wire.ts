/**
 * Speaker View's settings as the plugin's route takes them, and the stamps a
 * render carries (C3.2). ONE funnel for both engines and the REST route: the
 * canvas executor and the orchestrator send the same normalized body, so a
 * node renders the same wherever it runs.
 */
import { editPlanBasis, type Edl } from "@nodaro/shared/edl"
import { normalizeSpeakerViewData, type SpeakerViewNodeSettings } from "./speaker-view-options.js"
import type { SpeakerViewContext } from "./speaker-view-context.js"
import type { SpeakerViewTrackedBasis } from "./speaker-view-tracks.js"
import { speakerViewAutoRegions } from "./speaker-view-auto-regions.js"
import { cleanSpeakerRegions } from "./speaker-view-region-rows.js"

/** The settings half of the route's body. Every key is absent unless set. */
export interface SpeakerViewWireSettings {
  readonly targetAspect?: string
  readonly layout?: string
  readonly switch?: { readonly type: string; readonly durationMs?: number }
  readonly emphasis?: { readonly style: string; readonly durationMs?: number }
  readonly accentColor?: string
  readonly speakerRegions?: ReadonlyArray<{ source: string; speaker: string; region: { x: number; y: number; w: number; h: number } }>
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/**
 * The node's data as the route's settings: normalized first (a layout the
 * aspect or count rules out snaps; unknown ids fall back), then renamed to the
 * wire's nested `switch` / `emphasis`. `ctx` is the real EDL's context; leave
 * it out and only the aspect is judged.
 */
export function speakerViewWireSettings(data: SpeakerViewNodeSettings, ctx?: SpeakerViewContext): SpeakerViewWireSettings {
  const d = normalizeSpeakerViewData(data, ctx).data
  // Drawn regions always win; with none, the opt-in default boxes on the
  // edit's one camera (`speakerViewAutoRegions`, read off the raw data). The
  // flag itself never goes on the wire.
  const regions = cleanSpeakerRegions(d.speakerRegions) ?? cleanSpeakerRegions(speakerViewAutoRegions(data, ctx))
  return {
    ...(typeof d.targetAspect === "string" ? { targetAspect: d.targetAspect } : {}),
    ...(typeof d.layout === "string" ? { layout: d.layout } : {}),
    ...(typeof d.switchType === "string"
      ? { switch: { type: d.switchType, ...(num(d.switchDurationMs) !== undefined ? { durationMs: num(d.switchDurationMs)! } : {}) } }
      : {}),
    ...(typeof d.emphasisStyle === "string"
      ? { emphasis: { style: d.emphasisStyle, ...(num(d.emphasisDurationMs) !== undefined ? { durationMs: num(d.emphasisDurationMs)! } : {}) } }
      : {}),
    ...(typeof d.accentColor === "string" ? { accentColor: d.accentColor } : {}),
    ...(regions ? { speakerRegions: regions } : {}),
  }
}

/**
 * The `renderBasis` a Speaker View render is stamped with (decided 2026-10-07,
 * like Apply EDL's): a fingerprint of its own settings and the URL of each
 * source of the edit it renders. A change to either changes the cut while the
 * plan value stays equal, so a take made before the change reads as stale.
 * The quality is not part of it (a Preview and its final are the same cut).
 *
 * With face tracks wired (P3.9), the tracks' part joins it
 * (`speakerViewTrackedBasis`: the body, the motion, the labels and the drawn
 * regions), so a relabel or a motion change reads as stale too. Without
 * tracks it is byte-identical to before, so no earlier take turns stale.
 */
export function speakerViewRenderBasis(settings: SpeakerViewWireSettings, edl: Pick<Edl, "sources">, tracked?: SpeakerViewTrackedBasis): string {
  return editPlanBasis({
    kind: "speaker-view",
    settings,
    sources: edl.sources.map((s) => (typeof s.url === "string" ? s.url : "")),
    ...(tracked ? { tracked } : {}),
  })
}

// D20 defaults for the k-th of n speakers sharing one camera: one definition
// with the face tracks' default-box test (`speaker-view-default-regions.ts`).
export { defaultSpeakerRegions } from "./speaker-view-default-regions.js"
