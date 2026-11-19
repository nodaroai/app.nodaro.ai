/**
 * Video Remake's custom style: a direct run on Nodaro Prism takes the style
 * in the person's own words (`direction.customStyle`) in place of a catalog
 * art style (`direction.style`). Whether this deployment offers it, and the
 * admin's own instructions and model for the engine's two LLM steps. Set by an
 * admin for the whole deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_custom_style`:
 * `{ enabled?: boolean; medium?: { instructions?: string; model?: string }; describe?: { instructions?: string; model?: string } }`.
 *
 * - `enabled`: the admin's own choice, stored only once an admin made one
 *   (either value). Absent, or no row: the deployment's default — offered on
 *   Nodaro's own deployment, not offered under a white-label surface profile
 *   (`customStyleOfferedByDefault`, nodaro-motion-custom-style-default.ts).
 *   `customStyleEnabled` resolves the two; every reader goes through it.
 * - `medium`: the step that reads a run's words and decides the style's medium
 *   and tones. `describe`: the step that puts a picture's visual style into
 *   words (`POST /v1/video-remake/describe-style`). Each: the admin's own
 *   `instructions` and `model`; a field left out (or blank) is the engine's
 *   default, which the engine alone holds and the admin's editor reads from it.
 *
 * Read field by field, never by a strict schema
 * (`parseNodaroMotionCustomStyle`): the row is shared by every environment, so
 * a key added here later drops nothing for the code of today. The strict
 * schema is what an admin saves.
 *
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionCustomStyle()` (advertised as
 * `tk.capabilities.nodaroMotionCustomStyle`), which is always answered an
 * object whose `enabled` is ALREADY RESOLVED (the engine cannot tell the
 * deployments apart, and reads anything but `true` as not offered); and the
 * public `GET /v1/video-remake/style-choice` (`customStyle`). An engine that
 * does not declare `castSwap.customStyle` never reads the row and refuses the
 * field, so no value can be wrong there. Written only through
 * `nodaro-motion-custom-style-store.ts`. This module is pure (no database, no
 * deployment read).
 */
import { z } from "zod"

export const NODARO_MOTION_CUSTOM_STYLE_KEY = "nodaro_motion_custom_style"

/** The two LLM steps an admin can set, in the order the editor shows them. */
export const CUSTOM_STYLE_STEPS = ["medium", "describe"] as const
export type CustomStyleStepName = (typeof CUSTOM_STYLE_STEPS)[number]

/**
 * The longest instructions this platform stores for a step. A bound on the
 * row, not the engine's own limit: the engine says what it takes
 * (`POST /v1/video-remake/custom-style`'s `problems`), and a save is checked
 * against it.
 */
export const CUSTOM_STYLE_INSTRUCTIONS_STORED_MAX_CHARS = 20_000

/** The longest model id stored for a step. */
export const CUSTOM_STYLE_MODEL_MAX_CHARS = 200

/** One step's setting: the admin's own instructions and model; a field left out is the engine's default. */
export interface NodaroMotionCustomStyleStep {
  instructions?: string
  model?: string
}

/** The saved setting. Absent `enabled`: the deployment's default. Absent step: the engine's defaults. */
export interface NodaroMotionCustomStyle {
  enabled?: boolean
  medium?: NodaroMotionCustomStyleStep
  describe?: NodaroMotionCustomStyleStep
}

const stepSchema = z.strictObject({
  instructions: z.string().max(CUSTOM_STYLE_INSTRUCTIONS_STORED_MAX_CHARS).optional(),
  model: z.string().max(CUSTOM_STYLE_MODEL_MAX_CHARS).optional(),
})

/** What an admin saves: strict (an unknown key or a value of another type is refused). */
export const nodaroMotionCustomStyleSchema: z.ZodType<NodaroMotionCustomStyle> = z.strictObject({
  enabled: z.boolean().optional(),
  medium: stepSchema.optional(),
  describe: stepSchema.optional(),
})

/** A step as stored: its instructions when they are not blank (as written), its model trimmed when it is not blank; undefined when neither. */
function storedStep(step: NodaroMotionCustomStyleStep | null | undefined): NodaroMotionCustomStyleStep | undefined {
  const out: NodaroMotionCustomStyleStep = {}
  if (typeof step?.instructions === "string" && step.instructions.trim() !== "") out.instructions = step.instructions
  if (typeof step?.model === "string" && step.model.trim() !== "") out.model = step.model.trim()
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The setting as stored and sent: `enabled` only when an admin chose a value,
 * a step only when it holds an instruction or a model of the admin's own. A
 * new object.
 */
export function withoutDefaultCustomStyle(setting: NodaroMotionCustomStyle | null | undefined): NodaroMotionCustomStyle {
  const out: NodaroMotionCustomStyle = {}
  if (typeof setting?.enabled === "boolean") out.enabled = setting.enabled
  for (const name of CUSTOM_STYLE_STEPS) {
    const step = storedStep(setting?.[name])
    if (step) out[name] = step
  }
  return out
}

/**
 * The tolerant read of the stored row, field by field: an unknown key is
 * ignored, a switch that is not a boolean reads as never chosen (the
 * deployment's default), a step that is not an object or a field of it that is
 * not text within the stored bounds is dropped alone (each with a warning).
 * Not an object reads as never saved (null).
 */
export function parseNodaroMotionCustomStyle(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionCustomStyle | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as { enabled?: unknown; medium?: unknown; describe?: unknown }
  const out: NodaroMotionCustomStyle = {}
  if (typeof row.enabled === "boolean") out.enabled = row.enabled
  else if (row.enabled !== undefined && row.enabled !== null) warn(`[${NODARO_MOTION_CUSTOM_STYLE_KEY}] the switch is not a boolean: the deployment's default stands`)
  for (const name of CUSTOM_STYLE_STEPS) {
    const raw = row[name]
    if (raw === undefined || raw === null) continue
    if (typeof raw !== "object" || Array.isArray(raw)) {
      warn(`[${NODARO_MOTION_CUSTOM_STYLE_KEY}] the ${name} step is not an object: the engine's defaults stand`)
      continue
    }
    const { instructions, model } = raw as { instructions?: unknown; model?: unknown }
    const step: NodaroMotionCustomStyleStep = {}
    if (typeof instructions === "string" && instructions.length <= CUSTOM_STYLE_INSTRUCTIONS_STORED_MAX_CHARS) step.instructions = instructions
    else if (instructions !== undefined && instructions !== null) warn(`[${NODARO_MOTION_CUSTOM_STYLE_KEY}] the ${name} step's instructions are not text this platform stores: the engine's default stands`)
    if (typeof model === "string" && model.length <= CUSTOM_STYLE_MODEL_MAX_CHARS) step.model = model
    else if (model !== undefined && model !== null) warn(`[${NODARO_MOTION_CUSTOM_STYLE_KEY}] the ${name} step's model is not a model id: the engine's default stands`)
    out[name] = step
  }
  return withoutDefaultCustomStyle(out)
}

/**
 * Whether this deployment offers a custom style: the admin's saved choice when
 * there is one, else the deployment's default (`offeredByDefault`:
 * `customStyleOfferedByDefault()`). The one rule every reader uses.
 */
export function customStyleEnabled(setting: NodaroMotionCustomStyle | null | undefined, offeredByDefault: boolean): boolean {
  return typeof setting?.enabled === "boolean" ? setting.enabled : offeredByDefault
}

/** What the engine is answered: `enabled` resolved, and the admin's steps as stored. Always an object (a new one). */
export interface NodaroMotionCustomStyleForPlugin {
  enabled: boolean
  medium?: NodaroMotionCustomStyleStep
  describe?: NodaroMotionCustomStyleStep
}

export function customStyleForPlugin(setting: NodaroMotionCustomStyle | null | undefined, offeredByDefault: boolean): NodaroMotionCustomStyleForPlugin {
  const { enabled: _chosen, ...steps } = withoutDefaultCustomStyle(setting)
  return { enabled: customStyleEnabled(setting, offeredByDefault), ...steps }
}

/** Whether a (loaded or recorded) Cast Swap engine takes a custom style (`castSwap.customStyle`). An engine without it refuses the field and never reads the row. */
export function engineTakesCustomStyle(cs: { readonly customStyle?: boolean } | undefined): boolean {
  return cs?.customStyle === true
}
