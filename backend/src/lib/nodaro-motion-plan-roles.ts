/**
 * Video Remake's roles planned from the prompt: a person writes what they want
 * in their own words and adds loose reference images, and one LLM step of the
 * engine says which subject of the video each image replaces
 * (`POST /v1/video-remake/plan-roles`). Whether this deployment offers it, and
 * the admin's own instructions and model for that step. Set by an admin for the
 * whole deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_plan_roles`:
 * `{ enabled?: boolean; plan?: { instructions?: string; model?: string } }`.
 *
 * - `enabled`: the admin's own choice, stored only once an admin made one
 *   (either value). Absent, or no row: the deployment's default — offered on
 *   Nodaro's own deployment, not offered under a white-label surface profile
 *   (`planRolesOfferedByDefault`, nodaro-motion-plan-roles-default.ts).
 *   `planRolesEnabled` resolves the two; every reader goes through it.
 * - `plan`: the planning step. The admin's own `instructions` and `model`; a
 *   field left out (or blank) is the engine's default, which the engine alone
 *   holds and the admin's editor reads from it.
 *
 * Read field by field, never by a strict schema
 * (`parseNodaroMotionPlanRoles`): the row is shared by every environment, so a
 * key added here later drops nothing for the code of today. The strict schema
 * is what an admin saves.
 *
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionPlanRoles()` (advertised as
 * `tk.capabilities.nodaroMotionPlanRoles`), which is always answered an object
 * whose `enabled` is ALREADY RESOLVED (the engine cannot tell the deployments
 * apart, and reads anything but `true` as not offered); and the public
 * `GET /v1/video-remake/style-choice` (`planRoles`). An engine that does not
 * declare `castSwap.planRoles` never reads the row and has no such route, so
 * no value can be wrong there. Written only through
 * `nodaro-motion-plan-roles-store.ts`. This module is pure (no database, no
 * deployment read).
 */
import { z } from "zod"

export const NODARO_MOTION_PLAN_ROLES_KEY = "nodaro_motion_plan_roles"

/**
 * The longest instructions this platform stores for the step. A bound on the
 * row, not the engine's own limit: the engine says what it takes
 * (`POST /v1/video-remake/plan-roles-setting`'s `problems`), and a save is
 * checked against it.
 */
export const PLAN_ROLES_INSTRUCTIONS_STORED_MAX_CHARS = 20_000

/** The longest model id stored for the step. */
export const PLAN_ROLES_MODEL_MAX_CHARS = 200

/** The planning step's setting: the admin's own instructions and model; a field left out is the engine's default. */
export interface NodaroMotionPlanRolesStep {
  instructions?: string
  model?: string
}

/** The saved setting. Absent `enabled`: the deployment's default. Absent `plan`: the engine's defaults. */
export interface NodaroMotionPlanRoles {
  enabled?: boolean
  plan?: NodaroMotionPlanRolesStep
}

const stepSchema = z.strictObject({
  instructions: z.string().max(PLAN_ROLES_INSTRUCTIONS_STORED_MAX_CHARS).optional(),
  model: z.string().max(PLAN_ROLES_MODEL_MAX_CHARS).optional(),
})

/** What an admin saves: strict (an unknown key or a value of another type is refused). */
export const nodaroMotionPlanRolesSchema: z.ZodType<NodaroMotionPlanRoles> = z.strictObject({
  enabled: z.boolean().optional(),
  plan: stepSchema.optional(),
})

/** The step as stored: its instructions when they are not blank (as written), its model trimmed when it is not blank; undefined when neither. */
function storedStep(step: NodaroMotionPlanRolesStep | null | undefined): NodaroMotionPlanRolesStep | undefined {
  const out: NodaroMotionPlanRolesStep = {}
  if (typeof step?.instructions === "string" && step.instructions.trim() !== "") out.instructions = step.instructions
  if (typeof step?.model === "string" && step.model.trim() !== "") out.model = step.model.trim()
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The setting as stored and sent: `enabled` only when an admin chose a value,
 * the step only when it holds an instruction or a model of the admin's own. A
 * new object.
 */
export function withoutDefaultPlanRoles(setting: NodaroMotionPlanRoles | null | undefined): NodaroMotionPlanRoles {
  const out: NodaroMotionPlanRoles = {}
  if (typeof setting?.enabled === "boolean") out.enabled = setting.enabled
  const plan = storedStep(setting?.plan)
  if (plan) out.plan = plan
  return out
}

/**
 * The tolerant read of the stored row, field by field: an unknown key is
 * ignored, a switch that is not a boolean reads as never chosen (the
 * deployment's default), a step that is not an object or a field of it that is
 * not text within the stored bounds is dropped alone (each with a warning).
 * Not an object reads as never saved (null).
 */
export function parseNodaroMotionPlanRoles(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionPlanRoles | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as { enabled?: unknown; plan?: unknown }
  const out: NodaroMotionPlanRoles = {}
  if (typeof row.enabled === "boolean") out.enabled = row.enabled
  else if (row.enabled !== undefined && row.enabled !== null) warn(`[${NODARO_MOTION_PLAN_ROLES_KEY}] the switch is not a boolean: the deployment's default stands`)
  const raw = row.plan
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "object" || Array.isArray(raw)) {
      warn(`[${NODARO_MOTION_PLAN_ROLES_KEY}] the planning step is not an object: the engine's defaults stand`)
    } else {
      const { instructions, model } = raw as { instructions?: unknown; model?: unknown }
      const step: NodaroMotionPlanRolesStep = {}
      if (typeof instructions === "string" && instructions.length <= PLAN_ROLES_INSTRUCTIONS_STORED_MAX_CHARS) step.instructions = instructions
      else if (instructions !== undefined && instructions !== null) warn(`[${NODARO_MOTION_PLAN_ROLES_KEY}] the planning step's instructions are not text this platform stores: the engine's default stands`)
      if (typeof model === "string" && model.length <= PLAN_ROLES_MODEL_MAX_CHARS) step.model = model
      else if (model !== undefined && model !== null) warn(`[${NODARO_MOTION_PLAN_ROLES_KEY}] the planning step's model is not a model id: the engine's default stands`)
      out.plan = step
    }
  }
  return withoutDefaultPlanRoles(out)
}

/**
 * Whether this deployment offers roles planned from the prompt: the admin's
 * saved choice when there is one, else the deployment's default
 * (`offeredByDefault`: `planRolesOfferedByDefault()`). The one rule every
 * reader uses.
 */
export function planRolesEnabled(setting: NodaroMotionPlanRoles | null | undefined, offeredByDefault: boolean): boolean {
  return typeof setting?.enabled === "boolean" ? setting.enabled : offeredByDefault
}

/** What the engine is answered: `enabled` resolved, and the admin's step as stored. Always an object (a new one). */
export interface NodaroMotionPlanRolesForPlugin {
  enabled: boolean
  plan?: NodaroMotionPlanRolesStep
}

export function planRolesForPlugin(setting: NodaroMotionPlanRoles | null | undefined, offeredByDefault: boolean): NodaroMotionPlanRolesForPlugin {
  const { enabled: _chosen, ...step } = withoutDefaultPlanRoles(setting)
  return { enabled: planRolesEnabled(setting, offeredByDefault), ...step }
}

/** Whether a (loaded or recorded) Cast Swap engine plans roles from the prompt (`castSwap.planRoles`). An engine without it has no such route and never reads the row. */
export function engineTakesPlanRoles(cs: { readonly planRoles?: boolean } | undefined): boolean {
  return cs?.planRoles === true
}

/**
 * Whether a (loaded or recorded) Cast Swap engine plans the roles of a 3D
 * previz clip (`castSwap.planRolesPreviz`): its plan route takes
 * `clipKind: "previz"` and answers each role's locator and `subject`. Only an
 * engine that also plans roles and takes such a clip at all. An engine
 * without it refuses the key on that route (its body is strict), so it is
 * never sent there.
 */
export function engineTakesPlanRolesPreviz(cs: { readonly planRoles?: boolean; readonly previz?: boolean; readonly planRolesPreviz?: boolean } | undefined): boolean {
  return cs?.planRolesPreviz === true && cs.planRoles === true && cs.previz === true
}
