// packages/prompts/src/caption-treatments.ts
import type { CaptionPlan, SupportedFontName } from "@nodaro/shared"
import { ADD_CAPTIONS_PRESETS } from "./factory-presets/video-edit.js"

export const HOOK_PLATE_PRESET_ID = "add-captions/hook-plate"
export const BODY_CAPTIONS_PRESET_ID = "add-captions/body-captions"

/** Levers a spoken language needs on every caption segment; a language with no entry adds none. */
export interface CaptionLanguageLevers {
  readonly fontFamily?: SupportedFontName
  readonly uppercase?: boolean
}

/**
 * Keyed by primary language tag. Hebrew: one face that carries Hebrew and Latin, so a Latin
 * brand inside a Hebrew line is drawn in the same face, and no upper-casing, so the brand keeps
 * its spelling.
 */
export const CAPTION_LEVERS_BY_LANGUAGE: Readonly<Record<string, CaptionLanguageLevers>> = {
  he: { fontFamily: "Rubik", uppercase: false },
}

/** The add-captions segment keys a lever set may carry: the segment schema minus times and words. */
export const CAPTION_SEGMENT_LEVER_KEYS: readonly string[] = [
  "style", "position", "fontSize", "color", "backgroundColor", "look", "fontFamily", "fontWeight",
  "strokeColor", "strokeWidth", "highlightColor", "uppercase", "positionY", "animate", "maxWordsPerLine",
]

export type CaptionSegmentRole = "hook" | "body"

export interface HookPlateSegmentsOptions {
  /** The body's levers; default = the Body Captions preset. Keys outside CAPTION_SEGMENT_LEVER_KEYS are ignored. */
  readonly bodyLevers?: Readonly<Record<string, unknown>>
}

export interface HookPlateSegmentsResult {
  /** Route-shaped (camelCase) `segments`. Empty means "no captions". */
  readonly segments: Record<string, unknown>[]
  /** Segments left out, in order hook, body. */
  readonly dropped: CaptionSegmentRole[]
}

const LEVER_KEYS: ReadonlySet<string> = new Set(CAPTION_SEGMENT_LEVER_KEYS)

/** A lever set: segment lever keys only, without null or undefined values. */
function pickLevers(source: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!source) return out
  for (const [k, v] of Object.entries(source)) if (LEVER_KEYS.has(k) && v !== undefined && v !== null) out[k] = v
  return out
}

function presetLevers(id: string): Record<string, unknown> {
  const preset = ADD_CAPTIONS_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`The ${id} caption preset is missing from the catalog.`)
  return pickLevers(preset.data)
}

const PLATE_LEVERS = presetLevers(HOOK_PLATE_PRESET_ID)
const BODY_LEVERS = presetLevers(BODY_CAPTIONS_PRESET_ID)

function languageLevers(tag: string | undefined): CaptionLanguageLevers {
  if (typeof tag !== "string") return {}
  const primary = tag.trim().split(/[-_]/)[0]!.toLowerCase()
  return Object.hasOwn(CAPTION_LEVERS_BY_LANGUAGE, primary) ? CAPTION_LEVERS_BY_LANGUAGE[primary]! : {}
}

const isTime = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/**
 * One caption plan → the `segments` of one add-captions request: the opening line as the Hook
 * Plate, then the body's words in the Body Captions style (or the caller's own body levers).
 * The styling is read from the two presets, never restated here. Pure: no I/O.
 */
export function hookPlateCaptionSegments(plan: CaptionPlan, opts: HookPlateSegmentsOptions = {}): HookPlateSegmentsResult {
  const hookEnd = plan.hookEndMs
  if (!isTime(hookEnd) || hookEnd < 0) return { segments: [], dropped: ["hook", "body"] }
  const language = languageLevers(plan.language)
  const limit = typeof plan.videoDurationMs === "number" ? plan.videoDurationMs : Number.POSITIVE_INFINITY
  const segments: Record<string, unknown>[] = []
  const dropped: CaptionSegmentRole[] = []

  const plateEnd = Math.min(hookEnd, limit)
  if (plateEnd > 0 && typeof plan.hookText === "string" && /\S/.test(plan.hookText)) {
    segments.push({ startMs: 0, endMs: plateEnd, text: plan.hookText, ...PLATE_LEVERS, ...language })
  } else {
    dropped.push("hook")
  }

  // The body starts where the opening line ends, even when no plate is shown, so it never
  // draws over the opening line.
  const bodyEnd = Math.min(plan.bodyEndMs, limit)
  const words = Array.isArray(plan.captions) ? plan.captions : []
  const chosen = pickLevers(opts.bodyLevers)
  const bodyLevers = Object.keys(chosen).length > 0 ? chosen : BODY_LEVERS
  if (bodyEnd > hookEnd && words.length > 0) {
    segments.push({
      startMs: hookEnd,
      endMs: bodyEnd,
      captions: words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs })),
      ...bodyLevers,
      ...language,
    })
  } else {
    dropped.push("body")
  }

  return { segments, dropped }
}
