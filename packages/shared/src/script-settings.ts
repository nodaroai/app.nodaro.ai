/**
 * Generate Script's request settings: ONE reader for both DAG engines, and the
 * limits the `/v1/generate-script` route validates against.
 *
 * A run reads the node's data AFTER field mappings rewrote it, so a value can
 * arrive in a shape its field never had: a Scene Count or Duration node maps
 * its number as TEXT ("6"), and a Tone mapped from a Text node can be a whole
 * paragraph. Passing those on raw failed the editor's single-node run on the
 * route's 400 and sent the server run's text as-is. This reader coerces instead
 * of rejecting (the `normalizeModelInput` principle): a number-like value
 * becomes a whole number clamped to the route's range, text is trimmed and cut
 * to the route's length, and an unusable value is dropped so the generator's
 * own default applies.
 */
import { resolveNodeRefs } from "./node-refs.js"
import { LLM_TEXT_INPUT_MAX } from "./model-constants.js"

export const SCRIPT_SCENE_COUNT_RANGE = { min: 1, max: 20 } as const
export const SCRIPT_TARGET_DURATION_RANGE = { min: 5, max: 600 } as const
export const SCRIPT_TONE_MAX_LENGTH = 200
export const SCRIPT_STYLE_GUIDE_MAX_LENGTH = LLM_TEXT_INPUT_MAX

export interface ScriptSettings {
  sceneCount?: number
  tone?: string
  /** Seconds. */
  targetDuration?: number
  styleGuide?: string
}

function clampInt(value: unknown, range: { readonly min: number; readonly max: number }): number | undefined {
  const n = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0 ? Number(value) : Number.NaN
  if (!Number.isFinite(n)) return undefined
  return Math.min(range.max, Math.max(range.min, Math.round(n)))
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  return text.length > 0 ? text.slice(0, max) : undefined
}

/**
 * The settings a Generate Script node sends. `refMap` resolves `{Node Label}`
 * references in the style guide, the one field here with a reference-aware
 * editor; references with no matching node stay as typed.
 */
export function readScriptSettings(
  data: Record<string, unknown>,
  refMap?: ReadonlyMap<string, string>,
): ScriptSettings {
  const styleGuide = typeof data.styleGuide === "string" && refMap && refMap.size > 0
    ? resolveNodeRefs(data.styleGuide, refMap)
    : data.styleGuide
  return {
    sceneCount: clampInt(data.sceneCount, SCRIPT_SCENE_COUNT_RANGE),
    // The panel's own fields (the ones a mapping writes) come first. `style` is
    // an older key for the tone, and `targetDuration` is the route's name for
    // the length, which workflow JSON written by an agent can carry.
    tone: clampText(data.tone ?? data.style, SCRIPT_TONE_MAX_LENGTH),
    targetDuration: clampInt(data.targetLength ?? data.targetDuration, SCRIPT_TARGET_DURATION_RANGE),
    styleGuide: clampText(styleGuide, SCRIPT_STYLE_GUIDE_MAX_LENGTH),
  }
}
