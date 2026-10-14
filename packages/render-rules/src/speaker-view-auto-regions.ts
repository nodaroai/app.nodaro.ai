/**
 * Speaker View's opt-in automatic framing (`autoRegions`, decided 2026-10-13):
 * with no drawn regions, the speakers sharing the edit's ONE camera get the
 * same default boxes the region editor starts from (`defaultSpeakerRegions`)
 * — one definition of a default box, so what the panel draws is what an
 * autoRegions run renders, and `isDefaultSpeakerRegion` recognises every one.
 *
 * The boxes are dealt over the speakers ON SCREEN on that camera once the
 * node's layout is applied, in order of first appearance on the master clock
 * (`speakerViewOnScreen` + `speakerViewCameraSpeakers`) — the very list and
 * order the region editor deals its defaults over.
 *
 * One speaker needs no box (the full frame); more than six get none either
 * (the full frame, as without the flag); nor does a set of boxes that would
 * each be the whole frame (a 16:9 canvas over the assumed 16:9 camera) — the
 * same picture as no boxes, without changing what the render is stamped
 * with. Drawn regions always win. Nothing is filled for an edit with several
 * cameras, or for one clip of several the node runs over (a list row: the
 * panel frames a pack as one, so a clip's own boxes could not be shown).
 *
 * The canvas is read exactly as the region editor reads it: the node's
 * aspect, else the edit's (`speakerViewAspectOf`), at its render size
 * (`speakerViewCanvas`). The layout does not move a default box. The camera's
 * own shape is not known here — the wire carries no source dimensions, and a
 * podcast camera is 16:9 — so the boxes assume a 16:9 source
 * (`AUTO_REGIONS_SOURCE_ASPECT`).
 */
import { speakerViewTrackedOn } from "./speaker-view-attribution.js"
import type { SpeakerViewContext } from "./speaker-view-context.js"
import { defaultSpeakerRegions } from "./speaker-view-default-regions.js"
import { normalizeSpeakerViewData, speakerViewAspectOf, type SpeakerViewNodeSettings } from "./speaker-view-options.js"
import { speakerViewCameraSpeakers, speakerViewOnScreen } from "./speaker-view-on-screen.js"
import { cleanSpeakerRegions } from "./speaker-view-region-rows.js"
import { coerceSpeakerViewEdl } from "./speaker-view-rule.js"
import { speakerViewCanvas } from "./speaker-view-source-fit.js"

/** More speakers than this on one camera get no automatic boxes. */
export const AUTO_REGIONS_MAX_SPEAKERS = 6

/** The camera shape the automatic boxes assume (width / height). */
export const AUTO_REGIONS_SOURCE_ASPECT = 16 / 9

export interface AutoSpeakerRegion {
  readonly source: string
  readonly speaker: string
  readonly region: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

const isWholeFrame = (r: AutoSpeakerRegion["region"]): boolean => r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1

/**
 * The default box of each of `speakers` on camera `sourceId`, as
 * `speakerRegions` rows. `slotAspect` and `sourceAspect` are width / height,
 * as `defaultSpeakerRegions` takes them. Empty for one speaker, for more than
 * `AUTO_REGIONS_MAX_SPEAKERS`, and when every box would be the whole frame.
 */
export function autoSpeakerRegions(
  speakers: readonly string[],
  sourceId: string,
  slotAspect: number,
  sourceAspect: number,
): AutoSpeakerRegion[] {
  if (speakers.length > AUTO_REGIONS_MAX_SPEAKERS) return []
  const rows = defaultSpeakerRegions(speakers, slotAspect, sourceAspect).map((d) => ({ source: sourceId, ...d }))
  return rows.every((r) => isWholeFrame(r.region)) ? [] : rows
}

/**
 * The automatic boxes a node with `autoRegions: true` renders with, or `[]`:
 * none while any region is drawn (drawn regions always win), and only for
 * exactly one clip that is not one row of several, whose edit has exactly one
 * camera. Every reader of "what does the flag frame" asks this — the wire,
 * the panel, the region editor and the framing note.
 *
 * With face tracks wired (`ctx.tracks`), faces win (decided 2026-10-13): the
 * boxes are only the fallback for the speakers no track names
 * (`speakerViewTrackedOn`, the same test the "Which face is …?" question uses).
 */
export function speakerViewAutoRegions(data: SpeakerViewNodeSettings, ctx: SpeakerViewContext | undefined): AutoSpeakerRegion[] {
  if (data.autoRegions !== true || cleanSpeakerRegions(data.speakerRegions) || !ctx || ctx.packClip || ctx.clips.length !== 1) return []
  const clip = ctx.clips[0]!
  if (clip.cameraIds.length !== 1) return []
  const coerced = coerceSpeakerViewEdl(clip.edl)
  if ("problem" in coerced) return []
  const camera = clip.cameraIds[0]!
  const speakers = speakerViewCameraSpeakers(speakerViewOnScreen(coerced.edl, ctx.transcript, normalizeSpeakerViewData(data, ctx).data), camera)
  const canvas = speakerViewCanvas(speakerViewAspectOf(data, ctx))
  const rows = autoSpeakerRegions(speakers, camera, canvas.width / canvas.height, AUTO_REGIONS_SOURCE_ASPECT)
  if (!ctx.tracks) return rows
  // Faces win (decided 2026-10-13): a speaker a face track names is followed by
  // it, and a box sent for them would be the plugin's static fallback and its
  // zoom floor. The boxes are dealt over every speaker on screen FIRST, so a
  // speaker no track names keeps the very third the panel shows them in.
  const tracked = speakerViewTrackedOn(ctx.tracks, camera, ctx.transcript)
  return rows.filter((r) => !tracked(r.speaker))
}

/**
 * What "Split the camera by speaker" does for this node, for the panel's
 * summary line (decided 2026-10-13) — read off the very rows the run sends
 * (`speakerViewAutoRegions`), with and without the face tracks:
 *  - `off`: it frames nothing here (flag off, drawn regions, several cameras
 *    or clips, one speaker, more than six, a whole-frame set);
 *  - `boxes`: every speaker on the camera gets their default box;
 *  - `some-tracked`: the tracked speakers are followed, the others boxed;
 *  - `all-tracked`: every speaker is followed by face tracking.
 */
export type SpeakerViewAutoFraming = "off" | "boxes" | "some-tracked" | "all-tracked"

export function speakerViewAutoFraming(data: SpeakerViewNodeSettings, ctx: SpeakerViewContext | undefined): SpeakerViewAutoFraming {
  if (!ctx) return "off"
  const { tracks: _tracks, ...untracked } = ctx
  const all = speakerViewAutoRegions(data, untracked)
  if (all.length === 0) return "off"
  const sent = speakerViewAutoRegions(data, ctx)
  if (sent.length === all.length) return "boxes"
  return sent.length === 0 ? "all-tracked" : "some-tracked"
}
