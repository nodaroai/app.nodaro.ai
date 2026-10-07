/**
 * Speaker View's settings as the plugin's route takes them, and the stamps a
 * render carries (C3.2). ONE funnel for both engines and the REST route: the
 * canvas executor and the orchestrator send the same normalized body, so a
 * node renders the same wherever it runs.
 */
import { editPlanBasis, type Edl } from "@nodaro/shared"
import { normalizeSpeakerViewData, type SpeakerViewNodeSettings } from "./speaker-view-options.js"
import type { SpeakerViewContext } from "./speaker-view-context.js"
import { SPEAKER_VIEW_MIN_REGION } from "./speaker-view-settings.js"

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

/** The rows of `speakerRegions` the route will accept: ids that are strings
 *  and a region inside the frame no smaller than the minimum side. */
function cleanRegions(raw: unknown): SpeakerViewWireSettings["speakerRegions"] {
  if (!Array.isArray(raw)) return undefined
  const rows = raw.flatMap((row) => {
    const r = row as { source?: unknown; speaker?: unknown; region?: Record<string, unknown> } | null
    if (!r || typeof r.source !== "string" || !r.source || typeof r.speaker !== "string" || !r.speaker) return []
    const [x, y, w, h] = [r.region?.x, r.region?.y, r.region?.w, r.region?.h].map(num)
    if (x === undefined || y === undefined || w === undefined || h === undefined) return []
    if (x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9 || w < SPEAKER_VIEW_MIN_REGION || h < SPEAKER_VIEW_MIN_REGION) return []
    return [{ source: r.source, speaker: r.speaker, region: { x, y, w, h } }]
  })
  return rows.length > 0 ? rows : undefined
}

/**
 * The node's data as the route's settings: normalized first (a layout the
 * aspect or count rules out snaps; unknown ids fall back), then renamed to the
 * wire's nested `switch` / `emphasis`. `ctx` is the real EDL's context; leave
 * it out and only the aspect is judged.
 */
export function speakerViewWireSettings(data: SpeakerViewNodeSettings, ctx?: SpeakerViewContext): SpeakerViewWireSettings {
  const d = normalizeSpeakerViewData(data, ctx).data
  const regions = cleanRegions(d.speakerRegions)
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
 */
export function speakerViewRenderBasis(settings: SpeakerViewWireSettings, edl: Pick<Edl, "sources">): string {
  return editPlanBasis({
    kind: "speaker-view",
    settings,
    sources: edl.sources.map((s) => (typeof s.url === "string" ? s.url : "")),
  })
}

/**
 * D20 defaults for the k-th of n speakers sharing ONE camera (SV: "Default
 * regions"): full height, the slot aspect's width, centred at (2k+1)/2n of the
 * frame width — "left and right thirds" for two speakers at 9:16. A camera
 * with a single speaker needs no box (full frame), so it yields none.
 * `slotAspect` and `sourceAspect` are width / height.
 */
export function defaultSpeakerRegions(
  speakers: readonly string[],
  slotAspect: number,
  sourceAspect: number,
): Array<{ speaker: string; region: { x: number; y: number; w: number; h: number } }> {
  const n = speakers.length
  if (n < 2 || !(slotAspect > 0) || !(sourceAspect > 0)) return []
  const w = Math.min(1, slotAspect / sourceAspect)
  const round = (v: number) => Math.round(v * 1e4) / 1e4
  return speakers.map((speaker, k) => {
    const centre = (2 * k + 1) / (2 * n)
    const x = Math.min(1 - w, Math.max(0, centre - w / 2))
    return { speaker, region: { x: round(x), y: 0, w: round(w), h: 1 } }
  })
}
