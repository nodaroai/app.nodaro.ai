/**
 * A trend's hidden prompt texts as a run sends them, and the room they must
 * leave: the one rule the backend (composition, publish check, the admin's
 * prompt view: backend/src/ee/lib/trends/prompt-parts.ts, prompt-budget.ts)
 * and the trend builder (its Save gate and room counters: the admin
 * trends/model.ts) both run, so the two never differ. Not an Apache grant:
 * these are the trend recipe's own rules.
 *
 * A 4 s preview has less to go on than the full clip, so a trend may word its
 * prompt parts differently for it: each slot's `previewRoleName`, each fixed
 * reference's `previewLine`, `previewPrePrompt` and `previewTrendPrompt`. A
 * PREVIEW run sends those; one left empty (or blank) falls back to the full
 * run's text, so a trend that sets none runs exactly as before. A FULL run
 * never reads them, a full run that follows a preview included.
 */
import { CAST_SWAP_POST_PROMPT_MAX, getMaxVideoPromptChars, TREND_PROMPT_LIMITS } from "@nodaro/shared/models"
import { klingEngineText } from "./cast-swap-kling-trend"
import { CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT } from "./cast-swap-prompt-parts"

type SlotKind = "person" | "pet" | "product" | "location"

/** Which run's prompt texts: the full clip's, or the 4 s preview's. */
export type TrendPromptMode = "full" | "preview"
export const TREND_PROMPT_MODES = ["full", "preview"] as const satisfies readonly TrendPromptMode[]

/** Where the prompt texts are read from: a trend version, or the builder's form of one. */
export interface TrendPromptSource {
  readonly slots: readonly { readonly roleName: string; readonly previewRoleName?: string }[]
  readonly references: readonly { readonly line: string; readonly previewLine?: string }[]
  readonly prePrompt?: string
  readonly trendPrompt?: string
  readonly previewPrePrompt?: string
  readonly previewTrendPrompt?: string
}

/** Whether a preview text counts as set: anything but empty or only spaces. */
export function hasPreviewText(text: string | undefined): text is string {
  return typeof text === "string" && text.trim() !== ""
}

/** The preview's own text when it has one, else the full run's. */
export function previewTextOr<T extends string | undefined>(preview: string | undefined, full: T): string | T {
  return hasPreviewText(preview) ? preview : full
}

/** Whether the trend words any prompt part its own way for the 4 s preview. */
export function hasOwnPreviewPrompts(t: TrendPromptSource): boolean {
  return (
    hasPreviewText(t.previewPrePrompt) ||
    hasPreviewText(t.previewTrendPrompt) ||
    t.slots.some((s) => hasPreviewText(s.previewRoleName)) ||
    t.references.some((r) => hasPreviewText(r.previewLine))
  )
}

/**
 * Which names a preview run sends its roles by: `"own"` each slot's
 * `previewRoleName` where set (else its `roleName`), `"stored"` each slot's
 * `roleName` — the names a full-depth trend's stored scene description uses,
 * sent by a preview that carries that text (one name per run: the backend's
 * run-helpers.ts `withoutUnsupportedSceneDescription` decides per run).
 */
export type TrendRoleNames = "own" | "stored"

/** A trend's clip preparation, as the role-name rule reads it. */
export interface TrendSceneNamingSource {
  readonly faceMasking?: { readonly mode?: string; readonly source?: string; readonly scene?: string }
}

/**
 * Whether a preview run of this trend may carry the stored scene description
 * and so name its roles by their `roleName` (`"stored"`): masking on, Full
 * depth, its scene a description (the default). Whether a given run does
 * depends on what only that run knows (the stored clip's text, the engine),
 * so a check that must hold for every run holds both namings.
 */
export function previewMayUseStoredRoleNames(t: TrendSceneNamingSource): boolean {
  const m = t.faceMasking
  return !!m && m.mode !== "off" && m.source === "full-depth" && (m.scene ?? CAST_SWAP_FULL_DEPTH_SCENE_DEFAULT) === "description"
}

/**
 * The texts a run in `mode` sends, in the full run's fields: each slot's
 * `roleName`, each reference's `line`, `prePrompt` and `trendPrompt`. Full:
 * `t` itself, unchanged. Preview: a copy with each preview text that is set
 * in place of its full one (everything else untouched; `t` is never changed),
 * its role names as `roleNames` says (`"stored"`: the full run's).
 */
export function withPromptsFor<T extends TrendPromptSource>(t: T, mode: TrendPromptMode, roleNames: TrendRoleNames = "own"): T {
  if (mode === "full") return t
  const prePrompt = previewTextOr(t.previewPrePrompt, t.prePrompt)
  const trendPrompt = previewTextOr(t.previewTrendPrompt, t.trendPrompt)
  return {
    ...t,
    slots: t.slots.map((s) => ({ ...s, roleName: roleNames === "stored" ? s.roleName : previewTextOr(s.previewRoleName, s.roleName) })),
    references: t.references.map((r) => ({ ...r, line: previewTextOr(r.previewLine, r.line) })),
    ...(prePrompt !== undefined ? { prePrompt } : {}),
    ...(trendPrompt !== undefined ? { trendPrompt } : {}),
  } as T
}

/**
 * The runs whose prompts a trend must fit: the full run's, and the 4 s
 * preview's while the trend offers one (`previewStart` not null) and words a
 * part its own way. A trend with no preview never runs one, so its preview
 * texts, kept for when it does again, are not held to the budget; a preview
 * with no text of its own sends the full run's, which the full check covers.
 */
export function promptModesOf(t: TrendPromptSource & { readonly previewStart: number | null }): TrendPromptMode[] {
  return t.previewStart !== null && hasOwnPreviewPrompts(t) ? ["full", "preview"] : ["full"]
}

/**
 * Each set of texts a run of this trend can send, by mode (`promptModesOf`),
 * for the checks that must hold for every run (the prompt budget): the full
 * run's; the preview's with its own role names; and, while a preview may
 * carry the stored scene description (`previewMayUseStoredRoleNames`) and a
 * slot words its name its own way for the preview, the preview's with each
 * slot's `roleName` — so Kling 4's engine text is counted with the names a
 * run actually sends.
 */
export function promptRunsOf<T extends TrendPromptSource & TrendSceneNamingSource & { readonly previewStart: number | null }>(
  t: T,
): Array<{ mode: TrendPromptMode; texts: T }> {
  return promptModesOf(t).flatMap((mode) => {
    const own = { mode, texts: withPromptsFor(t, mode) }
    if (mode === "full" || !previewMayUseStoredRoleNames(t) || !t.slots.some((s) => hasPreviewText(s.previewRoleName))) return [own]
    return [own, { mode, texts: withPromptsFor(t, mode, "stored") }]
  })
}

/** The run schema's `details` limit: the user's own text after the trend prompt. */
export const TREND_DETAILS_MAX = TREND_PROMPT_LIMITS.detailsMax
/** The Cast Swap engine's cap on the whole prompt it builds (Seedance 2.5's). */
export const ENGINE_PROMPT_MAX = getMaxVideoPromptChars("seedance-2-5")
/** Kling 4's cap on the whole prompt Cast Swap builds. */
export const KLING_ENGINE_PROMPT_MAX = getMaxVideoPromptChars("kling-4")
/** The blank line ("\n\n") between two prompt parts. */
const SEP = 2

export interface TrendPromptBudget {
  /** The longest trend prompt that leaves the details their room in the post prompt field. */
  readonly trendPromptMax: number
  /** The longest pre prompt + trend prompt that leave the engine's text and the details their room. */
  readonly promptsMax: number
  /** Characters still free under the tighter of the two; below 0 = over by that much. */
  readonly room: number
}

/**
 * How much of the Cast Swap prompt a trend's own prompts may take, so a
 * user's run never fails on length because of what the trend put there. Two
 * limits: the engine's `postPrompt` field (`CAST_SWAP_POST_PROMPT_MAX`: the
 * trend prompt, a blank line, then the details at their longest), and the
 * engine's whole built prompt — Seedance 2.5's cap less the fixed worst-case
 * engine text (`TREND_PROMPT_LIMITS.engineTextReserve`), or on Kling 4 its
 * far shorter cap less the engine text of THESE slots and references
 * (`klingEngineText`). Pass the texts the run sends (`withPromptsFor`).
 */
export function trendPromptBudget(t: {
  readonly prePrompt?: string
  readonly trendPrompt?: string
  readonly engine?: string
  readonly slots?: readonly { readonly kind: SlotKind; readonly roleName: string }[]
  readonly references?: readonly { readonly line: string; readonly images: readonly unknown[] }[]
}): TrendPromptBudget {
  const pre = t.prePrompt?.length ?? 0
  const trend = t.trendPrompt?.length ?? 0
  const trendPromptMax = CAST_SWAP_POST_PROMPT_MAX - SEP - TREND_DETAILS_MAX
  const promptsMax =
    t.engine === "kling-4"
      ? KLING_ENGINE_PROMPT_MAX - klingEngineText({ slots: t.slots ?? [], references: t.references ?? [] }) - SEP - TREND_DETAILS_MAX
      : ENGINE_PROMPT_MAX - TREND_PROMPT_LIMITS.engineTextReserve - SEP - TREND_DETAILS_MAX
  return { trendPromptMax, promptsMax, room: Math.min(trendPromptMax - trend, promptsMax - pre - trend) }
}
