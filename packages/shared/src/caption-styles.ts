import type { SupportedFontName } from "./supported-fonts.js"

/**
 * Caption styles for the add-captions node. Static path uses FFmpeg drawtext;
 * kinetic styles render via Remotion (BurnCaptions composition).
 *
 * Single source of truth — imported by:
 *   - backend route Zod (add-captions.ts)
 *   - backend worker handler (ffmpeg.ts)
 *   - backend MCP tool (verbs-video.ts)
 *   - backend plan schema (plan-schemas.ts)
 *   - frontend node config + cost helper
 *   - packages/remotion overlay dispatcher
 */
export const STATIC_CAPTION_STYLES = ["subtitle"] as const
export const KINETIC_CAPTION_STYLES = [
  "word-highlight",
  "karaoke",
  "tiktok-words",
  "word-pop",
  "bouncy",
] as const
export const ALL_CAPTION_STYLES = [...STATIC_CAPTION_STYLES, ...KINETIC_CAPTION_STYLES] as const

export type StaticCaptionStyle = (typeof STATIC_CAPTION_STYLES)[number]
export type KineticCaptionStyle = (typeof KINETIC_CAPTION_STYLES)[number]
export type CaptionStyle = (typeof ALL_CAPTION_STYLES)[number]

const KINETIC_SET = new Set<string>(KINETIC_CAPTION_STYLES)

export function isKineticCaptionStyle(style: string | undefined | null): style is KineticCaptionStyle {
  return style !== null && style !== undefined && KINETIC_SET.has(style)
}

// ── Named "looks" ──────────────────────────────────────────────────────────
// A look is a bundle of visual levers so a caption reads well with one field
// instead of eight. Shared because the ids are wire contract (route Zod, MCP
// schema, SDK type) and the value table is consumed by BOTH the worker (render)
// and the canvas preview — deliberately given away, not creative doctrine.
export const CAPTION_LOOK_IDS = ["outline", "clean"] as const
export type CaptionLookId = (typeof CAPTION_LOOK_IDS)[number]

/** What an unset `look` means on a KINETIC style. ONE-LINE FLIP: set to "clean"
 *  to make an unset caption render as the pre-look-system lever set (face pinned)
 *  instead. */
export const DEFAULT_CAPTION_LOOK: CaptionLookId = "outline"

/** What an unset `look` means on the static `subtitle` style: the plain read —
 *  a pinned neutral sans, no outline, no casing. A subtitle must never be left
 *  with NO face: the Remotion render would fall back to headless Chrome's default
 *  SERIF, so adding e.g. a stroke to a subtitle would silently flip its font away
 *  from the sans the plain FFmpeg subtitle draws. */
export const DEFAULT_SUBTITLE_LOOK: CaptionLookId = "clean"

/**
 * The lever field names that are MEANINGLESS on a `subtitle` render and so are
 * rejected on it: `highlightColor` (subtitle has no per-word spoken cursor to
 * colour) and `animate` (subtitle has no motion to switch off). The STYLING
 * levers (look/fontFamily/fontWeight/strokeColor/strokeWidth/uppercase/positionY)
 * are NOT here any more — a `subtitle` carrying any of them now routes to the
 * Remotion renderer (see `captionRoutesToRemotion`), which applies them exactly
 * as it does for the kinetic styles. Single source of truth for the route's
 * reject-on-subtitle guard and the frontend's "don't send a stale lever" strip.
 * `color`/`backgroundColor` are deliberately absent — FFmpeg subtitle honours
 * those too.
 */
export const KINETIC_ONLY_CAPTION_LEVER_KEYS = [
  "highlightColor",
  "animate",
] as const
export type KineticOnlyCaptionLeverKey = (typeof KINETIC_ONLY_CAPTION_LEVER_KEYS)[number]

/**
 * Does an add-captions request need the Remotion renderer, vs the cheap static
 * FFmpeg drawtext path? A caption routes to Remotion when it needs anything the
 * one-fixed-string drawtext pass cannot do:
 *   - per-segment treatments (`segments`),
 *   - a kinetic style,
 *   - any STYLING lever (look/font/weight/stroke/uppercase/position_y/
 *     max_words_per_line) — FFmpeg drawtext can't apply a webfont face, weight,
 *     outline, casing, a free vertical position, or line grouping,
 *   - TIMED captions (a wired `transcript` or an explicit `captions[]` array),
 *   - auto-transcription, i.e. no `text` to burn as one static block.
 * Plain-`text` `subtitle` with no lever stays on FFmpeg (unchanged, cheap).
 *
 * SINGLE SOURCE for BOTH the worker dispatch (handleAddCaptions) AND the credit
 * id (buildAddCaptionsCreditId) so the renderer and the price never drift: a
 * Remotion render bills as `add-captions:kinetic`, a plain drawtext burn as
 * `add-captions`.
 */
export function captionRoutesToRemotion(input: {
  style?: string | null
  text?: string | null
  segments?: readonly unknown[] | null
  transcript?: unknown
  captions?: readonly unknown[] | null
  look?: unknown
  fontFamily?: unknown
  fontWeight?: unknown
  strokeColor?: unknown
  strokeWidth?: unknown
  uppercase?: unknown
  positionY?: unknown
  maxWordsPerLine?: unknown
}): boolean {
  if (input.segments && input.segments.length > 0) return true
  if (isKineticCaptionStyle(input.style)) return true
  // From here the style is `subtitle` (or unset → the subtitle default).
  // `null` is "not set", exactly like `undefined`: stored node JSON (an agent's
  // write, an import, a cleared field) carries nulls, and a null lever that
  // counted as a lever would route a plain subtitle to Remotion — and its price
  // — for a lever nobody chose.
  const isSet = (v: unknown): boolean => v !== undefined && v !== null
  const hasStylingLever =
    isSet(input.look) ||
    isSet(input.fontFamily) ||
    isSet(input.fontWeight) ||
    isSet(input.strokeColor) ||
    isSet(input.strokeWidth) ||
    isSet(input.uppercase) ||
    isSet(input.positionY) ||
    isSet(input.maxWordsPerLine)
  if (hasStylingLever) return true
  if (input.transcript !== undefined && input.transcript !== null) return true
  if (input.captions && input.captions.length > 0) return true
  // No `text` to burn as one static block → the only caption source is
  // transcription, which produces TIMED captions the drawtext pass can't show.
  if (!input.text) return true
  return false
}

/**
 * Is this render's caption source a STATIC TEXT BLOCK — the caller's `text`,
 * burned once for the whole clip — rather than timed words?
 *
 * On `subtitle`, `text` IS the caption: one block, `\n` a forced line break,
 * never transcribed over, whichever renderer draws it (the cheap FFmpeg drawtext
 * burn with no styling lever, the Remotion SubtitleOverlay with one). On a
 * KINETIC style the same `text` stays what it always was — a FALLBACK, spread
 * evenly across the clip as synthetic word timings when transcription returns
 * nothing.
 *
 * Source precedence is unchanged: `captions[]` > wired transcript > (`text` on
 * subtitle) > auto-transcription. `auto_transcribe` is deliberately NOT read: on
 * a subtitle the caller's text wins either way.
 *
 * Shared by the WORKER (which must not pay for a transcription it then discards)
 * and the ROUTE/DAG ingress, so the two cannot disagree about where the words
 * come from.
 */
export function isStaticTextCaptionSource(input: {
  style?: string | null
  text?: string | null
  captions?: readonly unknown[] | null
  transcript?: unknown
  segments?: readonly unknown[] | null
}): boolean {
  if (input.segments && input.segments.length > 0) return false
  if (isKineticCaptionStyle(input.style)) return false
  if (input.captions && input.captions.length > 0) return false
  if (input.transcript !== undefined && input.transcript !== null) return false
  return typeof input.text === "string" && /\S/.test(input.text)
}

/**
 * Whether an Add Captions render transcribes its audio: it carries no caption
 * source of its own — no captions, no wired transcript, no static text block —
 * auto-transcribe is not turned off, and its segments (when it has any) do not
 * all carry their own text or captions. The worker decides with it; the route's
 * credit guard asks it so a request is judged on its transcription model only
 * when one will run, and every place that prices a run on an engine charged by
 * the video's length (Nemotron 3.5 Transcribe) holds that price only when it does.
 */
export function captionsNeedTranscription(input: {
  style?: string | null
  text?: string | null
  captions?: readonly unknown[] | null
  transcript?: unknown
  segments?: ReadonlyArray<{ readonly text?: unknown; readonly captions?: readonly unknown[] | null }> | null
  auto_transcribe?: boolean | null
}): boolean {
  const hasSegments = !!(input.segments && input.segments.length > 0)
  const hasTranscript = input.transcript !== undefined && input.transcript !== null
  const someSegmentNeedsShared = hasSegments && input.segments!.some((s) => !(s.text || (s.captions && s.captions.length > 0)))
  return (
    !isStaticTextCaptionSource(input) &&
    !input.captions?.length &&
    !hasTranscript &&
    input.auto_transcribe !== false &&
    (!hasSegments || someSegmentNeedsShared)
  )
}

/**
 * `maxWordsPerLine` — caps how many words a caption LINE (or tiktok-words page)
 * may hold, on top of the frame-width budget, sentence ends and pauses that
 * already close a line. 1–2 gives the punchy CapCut read; unset = fit the width.
 * Applies to every line/page-grouped render (word-highlight, karaoke, bouncy,
 * tiktok-words, and a Remotion-rendered subtitle); inert on word-pop (always one
 * word). Bounds single-sourced here for the route Zod, the plan schema, the MCP
 * schema, the CLI and the canvas panel.
 */
export const CAPTION_MAX_WORDS_PER_LINE_MIN = 1
export const CAPTION_MAX_WORDS_PER_LINE_MAX = 20

/**
 * Numeric caption levers and their wire bounds — the SAME limits the route Zod
 * and the render-plan schema enforce. Single-sourced so the coercion below and
 * those schemas cannot disagree (a guard test pins the route to these).
 */
export const CAPTION_LEVER_BOUNDS = {
  fontSize: { min: 12, max: 200 },
  strokeWidth: { min: 0, max: 40 },
  positionY: { min: 0, max: 100 },
  fontWeight: { min: 100, max: 900 },
  maxWordsPerLine: { min: CAPTION_MAX_WORDS_PER_LINE_MIN, max: CAPTION_MAX_WORDS_PER_LINE_MAX },
} as const

type CaptionNumericLeverKey = keyof typeof CAPTION_LEVER_BOUNDS
const CAPTION_NUMERIC_LEVER_KEYS = Object.keys(CAPTION_LEVER_BOUNDS) as CaptionNumericLeverKey[]

/**
 * COERCE, never reject: bring the numeric caption levers of node data that
 * never passed a Zod (a workflow written by an agent, an import, a template, a
 * FieldMapping) into the range the render plan accepts. Without this an
 * out-of-range value only surfaces when the plan schema throws — mid-run, after
 * credits are reserved. A `null` / non-finite / non-numeric value is DROPPED (the
 * render default applies); an out-of-range one is clamped; `fontWeight` snaps to the
 * nearest 100 and `maxWordsPerLine` to a whole number. Pure; returns a copy and
 * leaves every other field untouched. Applied by payload-builder to the node's
 * top level and to each `segments[]` entry.
 */
export function normalizeCaptionNumericLevers<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = { ...input }
  for (const key of CAPTION_NUMERIC_LEVER_KEYS) {
    if (!(key in out) || out[key] === undefined) continue
    // `null` is "not set": drop it rather than carry it — the render plan's
    // numeric schema rejects a null, mid-run, after credits are reserved.
    if (out[key] === null) {
      delete out[key]
      continue
    }
    const raw = typeof out[key] === "string" && (out[key] as string).trim() !== "" ? Number(out[key]) : out[key]
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      delete out[key]
      continue
    }
    const { min, max } = CAPTION_LEVER_BOUNDS[key]
    const shaped = key === "fontWeight" ? Math.round(raw / 100) * 100 : key === "maxWordsPerLine" ? Math.round(raw) : raw
    out[key] = Math.min(max, Math.max(min, shaped))
  }
  return out as T
}

/** The concrete levers a look (and any explicit override) resolves to. */
export interface CaptionLookLevers {
  fontFamily?: SupportedFontName
  fontWeight?: number
  color?: string
  backgroundColor?: string
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
}

/** Outline width = 10% of font size (min 2px). `paint-order: stroke fill` puts
 *  half the stroke OUTSIDE the glyph, so the visible rim is ~5% of font size. */
export function autoStrokeWidth(fontSize: number): number {
  return Math.max(2, Math.round(fontSize * 0.1))
}

/** Each look is a function of font size (so the outline tracks the text size). */
export const CAPTION_LOOKS: Record<CaptionLookId, (fontSize: number) => CaptionLookLevers> = {
  // The TikTok / CapCut read: heavy geometric sans, caps, white on a thick black
  // outline, yellow spoken word.
  outline: (fs) => ({
    fontFamily: "Montserrat",
    fontWeight: 900,
    uppercase: true,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeWidth: autoStrokeWidth(fs),
    highlightColor: "#FFE600",
  }),
  // The pre-look lever set with the face pinned (it never was): per-style weight,
  // soft shadow only, no casing, no outline.
  clean: () => ({ fontFamily: "Inter", color: "#ffffff" }),
}

/**
 * Resolve a look + explicit overrides into concrete levers. An explicit lever
 * always wins over the look; `strokeWidth: 0` explicitly means "no outline".
 * The plan then carries concrete levers only — nothing to resolve at render.
 */
export function resolveCaptionLook(
  look: CaptionLookId | undefined,
  explicit: CaptionLookLevers,
  fontSize: number,
): CaptionLookLevers {
  // COERCE, never throw. The route Zod rejects a bad `look`, but the orchestrator /
  // authored-JSON / import / Copilot paths write `look` straight onto node data with
  // no validation (payload-builder passes `look: data.look` verbatim — the CLAUDE.md
  // pitfall 5b class). An unknown id here would throw AFTER a paid transcription and
  // fail the whole run, so an out-of-vocabulary look falls back to the default preset.
  const preset = CAPTION_LOOKS[look ?? DEFAULT_CAPTION_LOOK] ?? CAPTION_LOOKS[DEFAULT_CAPTION_LOOK]
  const out: CaptionLookLevers = { ...preset(fontSize) }
  for (const k of Object.keys(explicit) as (keyof CaptionLookLevers)[]) {
    if (explicit[k] !== undefined) (out[k] as CaptionLookLevers[typeof k]) = explicit[k]
  }
  return out
}

/**
 * Resolve the concrete render levers for a caption, applying the DEFAULT look the
 * way each STYLE expects: an unset `look` means `outline` on a kinetic style (the
 * TikTok/CapCut read) and `clean` on the static `subtitle` (the plain read — a
 * pinned neutral sans, no outline, no casing). So a subtitle that routes to
 * Remotion never inherits the outline house-style unless asked, AND is never left
 * with no face at all (which renders as headless Chrome's default serif). A named
 * look always wins; explicit levers override either. SINGLE SOURCE for the worker
 * top-level levers, the per-segment resolver, and the frontend config/preview
 * mirror, so the per-style default can't drift between them.
 */
export function resolveCaptionLevers(
  style: string | undefined | null,
  look: CaptionLookId | undefined,
  explicit: CaptionLookLevers,
  fontSize: number,
): CaptionLookLevers {
  const effective = look ?? (isKineticCaptionStyle(style) ? DEFAULT_CAPTION_LOOK : DEFAULT_SUBTITLE_LOOK)
  return resolveCaptionLook(effective, explicit, fontSize)
}
