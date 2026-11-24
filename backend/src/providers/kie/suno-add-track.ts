/**
 * The bodies of Suno Add Vocals and Add Instrumental on KIE's market lane
 * (`POST /api/v1/jobs/createTask`, decided 2026-11-23) — a pure leaf, so the
 * routes, the worker and the tests build the same body.
 *
 * KIE documents both only there (docs.kie.ai/suno-api/add-vocals and
 * /add-instrumental, read 2026-11-23): `{ model: "ai-music-api/add-vocals" |
 * "ai-music-api/add-instrumental", input }`, the input in snake_case. The
 * source is `upload_url`, a link to the audio file; neither schema takes a
 * Suno task or track id. The older `/api/v1/generate/add-*` calls we sent
 * (task and track ids, no file) were refused on every run with a 422 asking
 * for the upload URL.
 *
 * Required by the schemas: `upload_url`, `title`, `negative_tags`, and the
 * style — `style` on Add Vocals, `tags` on Add Instrumental. Every body here
 * carries all four, none empty; the caller resolves the source and the style
 * first (`lib/suno-add-track-source.ts`). KIE refuses an empty
 * `negative_tags` (`422 "Please enter negativeTags."`, every run that
 * excluded nothing, 2026-11-24), so a run that excludes nothing sends
 * `SUNO_ADD_TRACK_DEFAULT_NEGATIVE_TAGS`. Optional, sent only when set: `prompt`
 * (Add Vocals only — the lyrics, or the direction for the voice; Add
 * Instrumental has no prompt field), `vocal_gender` (`m` / `f`; the platform
 * spells it `male` / `female`), `style_weight`, `weirdness_constraint`,
 * `audio_weight` (0 to 1, steps of 0.01). `model` is the Suno version
 * (`input.model`, KIE's default V6). The documented `lyrics` and `variety` are
 * not offered.
 *
 * Each body is an allow-list, never a spread of the request. The person's
 * words (the prompt, the style, the styles to keep out) are sent as they are,
 * never cut here: a cut after the prompt policy ran would drop whatever the
 * policy added at the end. They are held to the limits BEFORE the run
 * (`sunoAddTrackTextProblem`: the route's schema, the workflow payload and the
 * worker after the policy), and a run over a limit is refused. Only the title
 * is cut, since it may be the source song's own (inherited, not typed).
 */
import {
  DEFAULT_SUNO_MODEL,
  SUNO_ADD_TRACK_NEGATIVE_MAX,
  SUNO_ADD_TRACK_PROMPT_MAX,
  SUNO_ADD_TRACK_STYLE_MAX,
  SUNO_TITLE_MAX,
  type SunoAddTrackModel,
} from "@nodaro/shared/models"

export const SUNO_ADD_VOCALS_MARKET_MODEL = "ai-music-api/add-vocals"
export const SUNO_ADD_INSTRUMENTAL_MARKET_MODEL = "ai-music-api/add-instrumental"

/** What the person may say about the layer, on either tool. */
export interface SunoAddTrackDirection {
  /** Add Vocals only: the lyrics, or the direction for the voice. */
  readonly prompt?: string
  readonly style?: string
  readonly title?: string
  readonly negativeTags?: string
  /** "male" / "female" (the platform's spelling); sent as `m` / `f`. */
  readonly vocalGender?: string
  readonly styleWeight?: number
  readonly weirdnessConstraint?: number
  readonly audioWeight?: number
}

/** A run as the provider receives it: the source file and the style resolved. */
export interface SunoAddTrackRun extends SunoAddTrackDirection {
  readonly uploadUrl: string
  readonly style: string
  readonly title: string
  readonly model?: SunoAddTrackModel
}

/** The title sent when neither the request nor the source song names one (KIE requires a title). */
export const SUNO_ADD_TRACK_FALLBACK_TITLE = "Untitled"

/**
 * What is sent as `negative_tags` when the person keeps nothing out: both
 * schemas require the field and KIE refuses an empty one. Shared by both
 * tools, so it names no genre, voice or instrument — only what no layer
 * should be.
 */
export const SUNO_ADD_TRACK_DEFAULT_NEGATIVE_TAGS = "low quality"

export function sunoVocalGenderCode(v: string | undefined): "m" | "f" | undefined {
  if (v === "male" || v === "m") return "m"
  if (v === "female" || v === "f") return "f"
  return undefined
}

/** A weight on KIE's grid: 0 to 1 in steps of 0.01; anything else (NaN, out of range) is not sent. */
function weight(v: number | undefined): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return undefined
  return Math.round(v * 100) / 100
}

const trimmed = (v: string | undefined): string | undefined => v?.trim() || undefined
const charCount = (v: string): number => Array.from(v).length

/** The title, cut to the limit: it may be the source song's own, inherited rather than typed. */
const titleOf = (v: string | undefined): string | undefined => {
  const t = trimmed(v)
  return t ? Array.from(t).slice(0, SUNO_TITLE_MAX).join("") : undefined
}

/** The provider's limit on each text the person writes (the title is cut instead: `titleOf`). */
export const SUNO_ADD_TRACK_TEXT_LIMITS = {
  prompt: SUNO_ADD_TRACK_PROMPT_MAX,
  style: SUNO_ADD_TRACK_STYLE_MAX,
  negativeTags: SUNO_ADD_TRACK_NEGATIVE_MAX,
} as const

/**
 * The first text over the provider's limit, as a message the person can act
 * on, or null. Asked of the request before anything is held (the workflow
 * payload; the route's schema holds the same limits) and of the run after the
 * prompt policy, in the worker — whose answer is a refusal, never a cut.
 */
export function sunoAddTrackTextProblem(run: Pick<SunoAddTrackDirection, "prompt" | "style" | "negativeTags">): string | null {
  const labels = { prompt: "The lyrics or direction", style: "The style", negativeTags: "The styles to keep out" } as const
  for (const key of Object.keys(SUNO_ADD_TRACK_TEXT_LIMITS) as Array<keyof typeof SUNO_ADD_TRACK_TEXT_LIMITS>) {
    const value = trimmed(run[key])
    const max = SUNO_ADD_TRACK_TEXT_LIMITS[key]
    if (value && charCount(value) > max) return `${labels[key]} must be at most ${max} characters.`
  }
  return null
}

/** The fields both tools share, in KIE's names. */
function sharedInput(run: SunoAddTrackRun): Record<string, unknown> {
  const gender = sunoVocalGenderCode(run.vocalGender)
  const styleWeight = weight(run.styleWeight)
  const weirdness = weight(run.weirdnessConstraint)
  const audioWeight = weight(run.audioWeight)
  return {
    upload_url: run.uploadUrl,
    model: run.model ?? DEFAULT_SUNO_MODEL,
    title: titleOf(run.title) ?? SUNO_ADD_TRACK_FALLBACK_TITLE,
    // Required by both schemas, and KIE refuses it empty.
    negative_tags: trimmed(run.negativeTags) ?? SUNO_ADD_TRACK_DEFAULT_NEGATIVE_TAGS,
    ...(gender ? { vocal_gender: gender } : {}),
    ...(styleWeight !== undefined ? { style_weight: styleWeight } : {}),
    ...(weirdness !== undefined ? { weirdness_constraint: weirdness } : {}),
    ...(audioWeight !== undefined ? { audio_weight: audioWeight } : {}),
  }
}

/** Add Vocals: `style`, and the prompt when set. */
export function sunoAddVocalsInput(run: SunoAddTrackRun): Record<string, unknown> {
  const prompt = trimmed(run.prompt)
  return {
    ...sharedInput(run),
    style: trimmed(run.style) ?? "",
    ...(prompt ? { prompt } : {}),
  }
}

/** Add Instrumental: the style goes as `tags`; there is no prompt field. */
export function sunoAddInstrumentalInput(run: SunoAddTrackRun): Record<string, unknown> {
  return {
    ...sharedInput(run),
    tags: trimmed(run.style) ?? "",
  }
}
