/**
 * `assembleSunoInput` — the single source of truth for turning a
 * `suno-generate` node's inputs (a prompt + connected Sound pickers + the
 * per-field levers) into the flat field set the Suno provider receives.
 *
 * WHY THIS EXISTS: the same custom-mode / audio-style fold —
 *   1. resolve effective custom mode (`getEffectiveSunoCustomMode`),
 *   2. compose the connected-picker hint (`composeSoundHintFromConnections`),
 *   3. fold it into `style` (custom, 500-char budget) OR `prompt` (non-custom,
 *      3000-char budget), skipping `truncateForField` when the user field is
 *      empty,
 *   4. normalize the secondary fields,
 * — was duplicated in THREE places kept in lockstep by hand: the frontend
 * `execute-node.ts` `suno-generate` branch (the DESIGNATED SOURCE OF TRUTH),
 * the backend `payload-builder.ts` `suno-generate` case, and the editor Final
 * preview. This wrapper collapses them into one so preview == run.
 *
 * THE 5 FE↔BE DIVERGENCES, all reconciled toward the FE:
 *   (A) `throwOnEmpty` — the FE run rejects an empty prompt+hint; the BE run and
 *       the preview do not. Opt-in via the flag (default `false` = BE/preview).
 *   (B) skip-when-empty — when the user's `style`/`prompt` field is empty the
 *       bare hint is returned (NOT run through `truncateForField`), matching the
 *       FE / `foldStyle` behavior. The BE always-truncated.
 *   (C) `lyrics` is CALLER-PRE-RESOLVED (`input.lyrics`) — the fn never reads
 *       `data.lyrics` for the value (the caller resolves `{}`-refs first; this
 *       is the FE bugfix of adopting the BE's ref-resolution). `data.lyrics` is
 *       still consulted by `getEffectiveSunoCustomMode` for mode auto-detection.
 *   (D) `vocalGender` precedence: `data.vocalGender || fields.vocalGender ||
 *       undefined` (manual wins, else the connected voice-character gender).
 *   (E) `|| undefined` normalization on `model` / `style` / `title` /
 *       `negativeStyle` (and `lyrics`), so empty strings drop out of the payload.
 *
 * CALLER-ONLY fields (deliberately NOT in the result, mirroring how
 * `assembleImageInput` leaves `userId`/`jobId` out): the FE adds `userId`; the
 * BE adds `jobId` / `usageLogId` / the credit id. The caller spreads `...result`
 * and appends those itself.
 */
import {
  getEffectiveSunoCustomMode,
  composeSoundHintFromConnections,
  appendField,
  truncateForField,
} from "./sound-aggregator.js"
import type { HintGraphContext, HintNodeLike } from "./parameter-prompt-hint.js"

/** Suno's server-side caps the fold budgets mirror. */
const STYLE_BUDGET = 500
const PROMPT_BUDGET = 3000

export interface AssembleSunoInput {
  /** The `suno-generate` node; `data` is ALREADY field-mapped by the caller. */
  node: HintNodeLike
  /** `{ nodes, edges }` for the connected-picker audio-style fold. */
  graph: HintGraphContext
  /**
   * Caller-resolved user prompt (FE: `overridePrompt ?? inputs.prompt ??
   * resolveTextRefs(data.prompt)`). Folded into `prompt` in non-custom mode.
   */
  userPrompt: string
  /**
   * Caller-resolved lyrics (divergence C — refMap-resolved by the caller, NOT
   * read from `data.lyrics` here).
   */
  lyrics?: string
  /** Persona fields (FE/BE `resolvePersona(...)`), spread onto the result. */
  persona?: { personaId?: string; personaModel?: "voice_persona" | "style_persona" }
  /**
   * Reject an empty prompt+hint with `throw` (divergence A). FE run passes
   * `true`; the BE run + the preview leave it `false`.
   */
  throwOnEmpty?: boolean
}

export interface AssembleSunoResult {
  prompt: string
  style?: string
  lyrics?: string
  title?: string
  negativeStyle?: string
  vocalGender?: string
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  customMode: boolean
  instrumental: boolean
  model?: string
  personaId?: string
  personaModel?: "voice_persona" | "style_persona"
}

/**
 * Assemble a `suno-generate` node's inputs into the flat field set the Suno
 * provider receives. Byte-faithful to the FE `execute-node.ts` inline block.
 */
export function assembleSunoInput(input: AssembleSunoInput): AssembleSunoResult {
  const data = (input.node.data ?? {}) as { readonly [k: string]: unknown }

  const customMode = getEffectiveSunoCustomMode(data)
  // Fold connected Sound pickers (music-genre / music-mood / instrumentation /
  // voice-character / voice-delivery) into style (custom) or prompt (non-custom).
  const audioStyle = composeSoundHintFromConnections(input.node, "suno-generate", input.graph)

  // Divergence A — opt-in empty-prompt guard. Checked BEFORE the fold so an
  // upstream picker that supplies the whole prompt still runs (matches the FE
  // `if (!typedPrompt && !audioStyle.text)` gate).
  if (input.throwOnEmpty && !input.userPrompt && !audioStyle.text) {
    throw new Error("Suno: no prompt found")
  }

  const userStyle = (data.style as string | undefined) ?? ""
  // `?? ""` mirrors the FE source-of-truth (`finalPrompt = typedPrompt ?? ""`) and
  // makes the `prompt: string` postcondition self-enforcing — in custom mode the
  // prompt branch is never rewritten, so a stray `undefined` would otherwise leak.
  const typedPrompt = input.userPrompt ?? ""

  // Divergence B — skip `truncateForField` when the user field is empty (return
  // the bare hint). Identical to the FE inline fold / `foldStyle`.
  let finalStyle = userStyle
  let finalPrompt = typedPrompt
  if (customMode) {
    finalStyle = userStyle
      ? appendField(userStyle, truncateForField(audioStyle.text, userStyle, STYLE_BUDGET))
      : audioStyle.text
  } else {
    finalPrompt = typedPrompt
      ? appendField(typedPrompt, truncateForField(audioStyle.text, typedPrompt, PROMPT_BUDGET))
      : audioStyle.text
  }

  return {
    prompt: finalPrompt,
    model: (data.model as string | undefined) || undefined,
    // Divergence C — lyrics is caller-pre-resolved; Divergence E — `|| undefined`.
    lyrics: input.lyrics || undefined,
    style: finalStyle || undefined,
    title: (data.title as string | undefined) || undefined,
    negativeStyle: (data.negativeStyle as string | undefined) || undefined,
    // Divergence D — manual vocalGender wins; else the connected voice-character.
    vocalGender: (data.vocalGender as string | undefined) || audioStyle.fields.vocalGender || undefined,
    styleWeight: data.styleWeight as number | undefined,
    weirdnessConstraint: data.weirdnessConstraint as number | undefined,
    audioWeight: data.audioWeight as number | undefined,
    customMode,
    instrumental: (data.instrumental as boolean | undefined) ?? false,
    ...(input.persona ?? {}),
  }
}
