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
 * cameras.
 *
 * A clip pack (decided 2026-10-14) — one clip of several the node runs over (a
 * list row, `ctx.packClip`), or the pack judged whole (the panel's view of a
 * batch) — is framed as one: the boxes are dealt ONCE over the speakers of the
 * episode's transcript who really talk, first heard first
 * (`speakerViewPackSpeakers`: 10 s, or 5% of the talk — decided 2026-10-18),
 * so every clip gets the same boxes, whoever is on screen in it. Every clip
 * must show the same one camera; with no transcript nothing is filled.
 *
 * The canvas is read exactly as the region editor reads it: the node's
 * aspect, else the edit's (`speakerViewAspectOf`), at its render size
 * (`speakerViewCanvas`). The layout does not move a default box. The camera's
 * own shape is not known here — the wire carries no source dimensions, and a
 * podcast camera is 16:9 — so the boxes assume a 16:9 source
 * (`AUTO_REGIONS_SOURCE_ASPECT`).
 */
import { speakerViewTrackedOn } from "./speaker-view-attribution.js"
import type { SpeakerViewClip, SpeakerViewContext } from "./speaker-view-context.js"
import { defaultSpeakerRegions } from "./speaker-view-default-regions.js"
import { normalizeSpeakerViewData, speakerViewAspectOf, type SpeakerViewNodeSettings } from "./speaker-view-options.js"
import { speakerViewCameraSpeakers, speakerViewOnScreen } from "./speaker-view-on-screen.js"
import { cleanSpeakerRegions } from "./speaker-view-region-rows.js"
import { speakerViewPackSpeakers } from "./speaker-view-pack-speakers.js"
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
 * none while any region is drawn (drawn regions always win). One edit: over
 * the speakers on screen on its one camera. A clip pack (a list row, or the
 * batch the panel reads): over the episode's speakers, the same on every clip
 * (decided 2026-10-14). Every reader of "what does the flag frame" asks this —
 * the wire, the panel, the region editor, the framing note, the review and
 * pricing.
 *
 * With face tracks wired (`ctx.tracks`), faces win (decided 2026-10-13): the
 * boxes are only the fallback for the speakers no track names
 * (`speakerViewTrackedOn`, the same test the "Which face is …?" question uses).
 */
export function speakerViewAutoRegions(data: SpeakerViewNodeSettings, ctx: SpeakerViewContext | undefined): AutoSpeakerRegion[] {
  const dealt = autoDeal(data, ctx)
  if (!dealt || !ctx) return []
  const { camera, rows } = dealt
  if (!ctx.tracks) return rows
  // Faces win (decided 2026-10-13): a speaker a face track names is followed by
  // it, and a box sent for them would be the plugin's static fallback and its
  // zoom floor. The boxes are dealt over every speaker FIRST, so a speaker no
  // track names keeps the very third the panel shows them in.
  const tracked = speakerViewTrackedOn(ctx.tracks, camera, ctx.transcript)
  return rows.filter((r) => !tracked(r.speaker))
}

/** The camera the automatic boxes frame and the speakers they are dealt over, in order. */
export interface SpeakerViewAutoSpeakers { readonly camera: string; readonly speakers: readonly string[] }

/**
 * Whom "Split the camera by speaker" deals its boxes over, and on which
 * camera, or `undefined` when it draws no box at all (flag off, drawn
 * regions, no edit, several cameras, a pack with no transcript, one speaker,
 * more than `AUTO_REGIONS_MAX_SPEAKERS`, a set that would be all whole frame).
 * One edit: the speakers on screen on its one camera (with
 * `autoRegionsTalkFloor`, only those over the talk-time floor). A clip pack (a list
 * row, or the batch the panel and the region editor read): the episode's
 * speakers who really talk, first heard first (`speakerViewPackSpeakers`).
 * The region editor deals its own default boxes over this very list, so it
 * never shows a box the run will not draw, nor in another order. Face tracks
 * are applied after (`speakerViewAutoRegions`): a tracked speaker keeps their
 * place in the deal.
 */
export function speakerViewAutoSpeakers(data: SpeakerViewNodeSettings, ctx: SpeakerViewContext | undefined): SpeakerViewAutoSpeakers | undefined {
  const dealt = autoDeal(data, ctx)
  return dealt ? { camera: dealt.camera, speakers: dealt.speakers } : undefined
}

/** The deal and the boxes it makes, before the face tracks; undefined when it makes none. */
function autoDeal(data: SpeakerViewNodeSettings, ctx: SpeakerViewContext | undefined): (SpeakerViewAutoSpeakers & { readonly rows: AutoSpeakerRegion[] }) | undefined {
  if (data.autoRegions !== true || cleanSpeakerRegions(data.speakerRegions) || !ctx) return undefined
  const framed = ctx.packClip === true || ctx.clips.length > 1 ? packFraming(ctx) : editFraming(data, ctx)
  if (!framed) return undefined
  const canvas = speakerViewCanvas(speakerViewAspectOf(data, ctx))
  const rows = autoSpeakerRegions(framed.speakers, framed.camera, canvas.width / canvas.height, AUTO_REGIONS_SOURCE_ASPECT)
  return rows.length === 0 ? undefined : { ...framed, rows }
}

/** The one camera of a clip whose edit reads, if it has exactly one. */
function onlyCamera(clip: SpeakerViewClip): string | undefined {
  return clip.cameraIds.length === 1 && !("problem" in coerceSpeakerViewEdl(clip.edl)) ? clip.cameraIds[0] : undefined
}

/** One edit: the speakers on screen on its one camera once the node's layout is applied. */
function editFraming(data: SpeakerViewNodeSettings, ctx: SpeakerViewContext): SpeakerViewAutoSpeakers | undefined {
  const clip = ctx.clips[0]!
  if (clip.cameraIds.length !== 1) return undefined
  const coerced = coerceSpeakerViewEdl(clip.edl)
  if ("problem" in coerced) return undefined
  const camera = clip.cameraIds[0]!
  const onScreen = speakerViewCameraSpeakers(speakerViewOnScreen(coerced.edl, ctx.transcript, normalizeSpeakerViewData(data, ctx).data), camera)
  // Speaker Layout (decided 2026-10-18): a speaker under the talk-time floor (a
  // stray diarizer label) gets no box of their own — the floor a clip pack's boxes use.
  if (data.autoRegionsTalkFloor !== true) return { camera, speakers: onScreen }
  const talk = new Set(speakerViewPackSpeakers(ctx.transcript))
  return { camera, speakers: onScreen.filter((s) => talk.has(s)) }
}

/**
 * A clip pack (decided 2026-10-14): the episode's speakers who really talk,
 * first heard first, on the one camera every clip shows — so each clip is
 * framed alike, the way the panel frames the pack as one.
 */
function packFraming(ctx: SpeakerViewContext): SpeakerViewAutoSpeakers | undefined {
  const cameras = new Set(ctx.clips.map(onlyCamera))
  const camera = cameras.size === 1 ? [...cameras][0] : undefined
  if (camera === undefined) return undefined
  return { camera, speakers: speakerViewPackSpeakers(ctx.transcript) }
}

/**
 * What "Split the camera by speaker" does for this node, for the panel's
 * summary line (decided 2026-10-13) — read off the very rows the run sends
 * (`speakerViewAutoRegions`), with and without the face tracks:
 *  - `off`: it frames nothing here (flag off, drawn regions, several cameras,
 *    one speaker, more than six, a whole-frame set, a pack with no transcript);
 *  - `boxes`: every speaker on the camera gets their default box;
 *  - `pack-boxes`: a clip pack — every clip gets the same boxes, dealt over
 *    the episode's speakers (decided 2026-10-14);
 *  - `some-tracked`: the tracked speakers are followed, the others boxed;
 *  - `all-tracked`: every speaker is followed by face tracking.
 */
export type SpeakerViewAutoFraming = "off" | "boxes" | "pack-boxes" | "some-tracked" | "all-tracked"

export function speakerViewAutoFraming(data: SpeakerViewNodeSettings, ctx: SpeakerViewContext | undefined): SpeakerViewAutoFraming {
  if (!ctx) return "off"
  const { tracks: _tracks, ...untracked } = ctx
  const all = speakerViewAutoRegions(data, untracked)
  if (all.length === 0) return "off"
  const sent = speakerViewAutoRegions(data, ctx)
  if (sent.length === all.length) return ctx.packClip === true || ctx.clips.length > 1 ? "pack-boxes" : "boxes"
  return sent.length === 0 ? "all-tracked" : "some-tracked"
}
