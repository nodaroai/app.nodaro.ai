/**
 * A trend's hidden prompt parts as a run sends them (pure; no I/O).
 *
 * A 4 s preview has less to go on than the full clip, so a trend may word its
 * prompt parts differently for it: each slot's `previewRoleName`, the
 * `previewPrePrompt`, the `previewTrendPrompt` and each fixed reference's
 * `previewLine`. A PREVIEW run (`preview: true`) sends those; one left empty
 * (or blank) falls back to the full run's text, so a trend that sets none
 * runs exactly as before. A FULL run never reads them, a full run that
 * follows a preview (`previewJobId`) included.
 *
 * The fallback is decided in ONE place, `@nodaro/render-rules`
 * (trend-prompts.ts: `withPromptsFor`), which this module re-exports for the
 * composition (compose.ts), the prompt budget and the publish check
 * (prompt-budget.ts, publish-check.ts) and which the trend builder runs too;
 * `trendPromptParts` below is the admin's prompt view of it.
 *
 * HIDDEN: everything here is the trend's recipe; nothing of it may reach a
 * public response.
 */
import { hasPreviewText, type TrendPromptMode, type TrendRoleNames } from "@nodaro/render-rules"
import { pickText } from "./localize.js"
import type { TrendSlotKind, TrendVersionData } from "./types.js"

// The rule itself (which text a run sends, the fallback, when the preview is checked) is
// @nodaro/render-rules' trend-prompts.ts, which the trend builder runs too.
export {
  TREND_PROMPT_MODES,
  hasOwnPreviewPrompts,
  hasPreviewText,
  withPromptsFor,
  type TrendPromptMode,
  type TrendRoleNames,
} from "@nodaro/render-rules"

/** What the prompt texts are read from: a trend version (or its prompt fields). */
type PromptSource = Pick<
  TrendVersionData,
  "slots" | "references" | "prePrompt" | "trendPrompt" | "previewPrePrompt" | "previewTrendPrompt"
>

/** One prompt part as a run in a mode sends it; `fromFullRun`: a preview that has no text of its own for it. */
export interface TrendPromptPart {
  text: string
  fromFullRun: boolean
}

/** The trend's hidden prompt parts as a run in `mode` sends them, for the admin's prompt view. */
export interface TrendPromptParts {
  mode: TrendPromptMode
  /** Null when the version has no pre prompt for this mode. */
  prePrompt: TrendPromptPart | null
  /** In slot order. */
  roles: Array<{ key: string; /** English. */ label: string; kind: TrendSlotKind; roleName: TrendPromptPart }>
  /** In reference order. */
  references: Array<{ line: TrendPromptPart }>
  /** Null when the version has no trend prompt for this mode. The run's details follow it in the engine's post prompt. */
  trendPrompt: TrendPromptPart | null
}

/**
 * `withPromptsFor`, part by part, saying which part a preview takes from the
 * full run. `roleNames` `"stored"`: the run carries the stored scene
 * description, so a preview names each role by its `roleName` (one name per
 * run: run-helpers.ts `withoutUnsupportedSceneDescription`), shown as taken
 * from the full run.
 */
export function trendPromptParts(data: PromptSource, mode: TrendPromptMode, roleNames: TrendRoleNames = "own"): TrendPromptParts {
  const preview = mode === "preview"
  const part = (own: string | undefined, full: string | undefined): TrendPromptPart | null => {
    if (preview && hasPreviewText(own)) return { text: own, fromFullRun: false }
    return full ? { text: full, fromFullRun: preview } : null
  }
  return {
    mode,
    prePrompt: part(data.previewPrePrompt, data.prePrompt),
    roles: data.slots.map((s) => ({
      key: s.key,
      label: pickText(s.label, "en") ?? s.key,
      kind: s.kind,
      roleName: part(roleNames === "stored" ? undefined : s.previewRoleName, s.roleName) ?? { text: "", fromFullRun: preview },
    })),
    references: data.references.map((r) => ({ line: part(r.previewLine, r.line) ?? { text: "", fromFullRun: preview } })),
    trendPrompt: part(data.previewTrendPrompt, data.trendPrompt),
  }
}
