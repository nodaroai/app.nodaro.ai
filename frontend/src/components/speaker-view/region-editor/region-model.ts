/**
 * What the region editor lists (U4): the cameras of the edit, and on each the
 * (source, speaker) pairs that actually occur on screen once the node's
 * layout is applied — one crop per pair is what `speakerRegions` stores
 * (D20's `(source, speaker)` rung). Pure; reads the edit(s) the panel reads.
 *
 * Each pair also lists every slot shape it is drawn in ("Show as"), so the
 * dashed cover crop and the upscale chip can be shown for each, and the
 * master-clock turns the "Jump to" buttons and the row times come from.
 */
import {
  coerceSpeakerViewEdl,
  normalizeSpeakerViewData,
  speakerRegionKey,
  speakerViewOnScreen,
  speakerViewShowAsKey,
  type SpeakerViewContext,
  type SpeakerViewNodeSettings,
} from "@nodaro/render-rules"
import { resolveEdlSegmentSlots, speakerTurns, transcriptSpeakerLabels, normalizeTranscript, type Edl } from "@nodaro/shared/edl"
import type { Region, SpeakerViewAspect, Turn } from "./region-geometry"

/** One slot shape a pair is drawn in. */
export interface FramingShowAs {
  readonly layout: string
  readonly slots: number
  readonly slotIndex: number
  readonly aspect: SpeakerViewAspect
}

export interface FramingPair {
  readonly source: string
  readonly speaker: string
  /** Where on the master clock the pair is first on screen. */
  readonly firstMs: number
  readonly showAs: readonly FramingShowAs[]
}

export interface FramingCamera {
  readonly id: string
  readonly url: string
  readonly offsetMs?: number
  /** In order of first appearance. */
  readonly pairs: readonly FramingPair[]
}

export interface FramingModel {
  readonly cameras: readonly FramingCamera[]
  /** Master-clock turns, per speaker, in time order. */
  readonly turns: readonly Turn[]
}

export type StoredRegions = ReadonlyArray<{ source: string; speaker: string; region: Region }>

/**
 * The cameras and pairs of every clip (one entry per clip; a plain edit is
 * one), laid out with the node's settings exactly as the run normalizes them.
 * A clip that is not an edit is skipped. Each clip's pairs come from
 * `speakerViewOnScreen` (@nodaro/render-rules) — the list `autoRegions` deals
 * its default boxes over too — merged across clips; each camera's pairs are
 * in order of first appearance (`speakerViewCameraSpeakers`'s order).
 */
export function framingModel(
  edits: readonly unknown[],
  transcript: unknown,
  settings: SpeakerViewNodeSettings,
  ctx: SpeakerViewContext | undefined,
): FramingModel {
  const data = normalizeSpeakerViewData(settings, ctx).data
  const cameras = new Map<string, { id: string; url: string; offsetMs?: number; pairs: Map<string, { source: string; speaker: string; firstMs: number; showAs: Map<string, FramingShowAs> }> }>()
  const turns: Turn[] = []

  for (const raw of edits) {
    const coerced = coerceSpeakerViewEdl(raw)
    if ("problem" in coerced) continue
    const onScreen = speakerViewOnScreen(coerced.edl, transcript, data)
    for (const camera of onScreen.cameras) {
      if (!cameras.has(camera.id)) cameras.set(camera.id, { ...camera, pairs: new Map() })
    }
    turns.push(...onScreen.turns)
    for (const p of onScreen.pairs) {
      const camera = cameras.get(p.source)
      if (!camera) continue
      const pair = camera.pairs.get(p.speaker) ?? { source: p.source, speaker: p.speaker, firstMs: p.firstMs, showAs: new Map<string, FramingShowAs>() }
      pair.firstMs = Math.min(pair.firstMs, p.firstMs)
      for (const showAs of p.showAs) pair.showAs.set(speakerViewShowAsKey(showAs), showAs as FramingShowAs)
      camera.pairs.set(p.speaker, pair)
    }
  }

  return {
    cameras: [...cameras.values()].map((c) => ({
      id: c.id,
      url: c.url,
      ...(c.offsetMs !== undefined ? { offsetMs: c.offsetMs } : {}),
      pairs: [...c.pairs.values()]
        .sort((a, b) => a.firstMs - b.firstMs)
        .map((p) => ({ source: p.source, speaker: p.speaker, firstMs: p.firstMs, showAs: [...p.showAs.values()] })),
    })),
    turns: [...turns].sort((a, b) => a.startMs - b.startMs),
  }
}

/** Does this camera need a box per speaker? One speaker on a camera is shown
 *  full frame by default (a close-up), and gets no box until one is drawn. */
export const cameraIsShared = (camera: FramingCamera): boolean => camera.pairs.length >= 2

/** The stored region of a pair, if any. */
export function storedRegionOf(stored: unknown, source: string, speaker: string): Region | undefined {
  if (!Array.isArray(stored)) return undefined
  const row = stored.find((r) => r && typeof r === "object" && (r as { source?: unknown }).source === source && (r as { speaker?: unknown }).speaker === speaker) as
    | { region?: Partial<Region> }
    | undefined
  const g = row?.region
  if (!g || [g.x, g.y, g.w, g.h].some((v) => typeof v !== "number" || !Number.isFinite(v))) return undefined
  return { x: g.x!, y: g.y!, w: g.w!, h: g.h! }
}

/**
 * The rows to save: every drawn box, in camera then pair order, followed by
 * stored rows for pairs this edit does not show (kept, never silently lost:
 * another clip or a later edit may show them again).
 */
export function regionsToSave(
  model: FramingModel,
  boxes: ReadonlyMap<string, Region>,
  stored: unknown,
): Array<{ source: string; speaker: string; region: Region }> {
  const out: Array<{ source: string; speaker: string; region: Region }> = []
  const shown = new Set<string>()
  for (const camera of model.cameras) {
    for (const pair of camera.pairs) {
      const key = pairKey(pair.source, pair.speaker)
      shown.add(key)
      const region = boxes.get(key)
      if (region) out.push({ source: pair.source, speaker: pair.speaker, region })
    }
  }
  if (Array.isArray(stored)) {
    for (const row of stored as Array<{ source?: unknown; speaker?: unknown; region?: unknown }>) {
      if (!row || typeof row.source !== "string" || typeof row.speaker !== "string") continue
      if (shown.has(pairKey(row.source, row.speaker))) continue
      const region = storedRegionOf([row], row.source, row.speaker)
      if (region) out.push({ source: row.source, speaker: row.speaker, region })
    }
  }
  return out
}

/** The key a (camera, speaker) row is known by — the rule's own spelling, so
 *  the node's `defaultRegionKeys` and the region match agree with it. */
export const pairKey = (source: string, speaker: string): string => speakerRegionKey(source, speaker)
