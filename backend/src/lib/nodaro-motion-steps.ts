/**
 * Nodaro Motion's preparation steps per engine — set by an admin for the
 * whole deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_steps`:
 * `{ "motion-prism"?: CastSwapSteps, "motion-pulse"?: CastSwapSteps }`, keyed
 * by Nodaro Motion's PUBLIC engine ids, each entry a Cast Swap `steps`
 * setting (`castSwapStepsSchema`, cast-swap-steps.ts). No row, or an engine
 * left out, = today's run for that engine. A save writes both the current and
 * the earlier engine keys (as the masking row does); the read prefers the
 * current key.
 *
 * Who reads it: the Cast Swap engine, through `tk.settings.nodaroMotionSteps()`
 * (advertised as `tk.capabilities.nodaroMotionSteps`), for every DIRECT run;
 * the toolkit answers null to an engine that does not take steps
 * (`castSwap.steps`), and leaves "Body from the clip" (`clipBody`) out for one
 * that does not declare `castSwap.clipBodySheet` (`stepsForLoadedEngine`). A trend run carries its own trend's `steps`. Written
 * only by `PUT /v1/admin/nodaro-motion/steps` through
 * `nodaro-motion-steps-store.ts`. This module is pure (no database).
 */
import { z } from "zod"
import { castSwapStepsSaveSchema, castSwapStepsSchema, normaliseSteps, stepsForEngine, type CastSwapSteps } from "./cast-swap-steps.js"
import { getPluginSupports } from "./private-plugins/supports-registry.js"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_STEPS_KEY = "nodaro_motion_steps"

/** The saved setting: one entry per engine an admin set (an engine left out runs as today). */
export type NodaroMotionSteps = ByEngine<CastSwapSteps>

/** What `tk.settings.nodaroMotionSteps()` answers: each entry under its current and its earlier key. */
export type NodaroMotionStepsForPlugin = ByEngineForPlugin<CastSwapSteps>

/** The stored shape: each engine's entry read by the stored-data schema (any model name). */
export const nodaroMotionStepsSchema: z.ZodType<NodaroMotionSteps> = z.strictObject({
  "motion-prism": castSwapStepsSchema.optional(),
  "motion-pulse": castSwapStepsSchema.optional(),
})

/** What an admin saves: strict, each entry checked as a save (a known model that can see what it is shown). */
export const nodaroMotionStepsSaveSchema: z.ZodType<NodaroMotionSteps> = z.strictObject({
  "motion-prism": castSwapStepsSaveSchema.optional(),
  "motion-pulse": castSwapStepsSaveSchema.optional(),
})

/** The setting with every empty entry (`{}`, nothing set) left out: what is stored. A new object. */
export function withoutEmptySteps(steps: NodaroMotionSteps): NodaroMotionSteps {
  const out: NodaroMotionSteps = {}
  for (const [engine, entry] of Object.entries(steps) as Array<[keyof NodaroMotionSteps, CastSwapSteps | undefined]>) {
    const normalised = normaliseSteps(entry)
    if (normalised) out[engine] = normalised
  }
  return out
}

/**
 * The setting as this process's engine takes it (`stepsForEngine`: nothing
 * for an engine without `castSwap.steps`, no `clipBody` for one without
 * `castSwap.clipBodySheet`), each entry left empty dropped. A new object.
 */
export function stepsForLoadedEngine(steps: NodaroMotionSteps): NodaroMotionSteps {
  const cs = getPluginSupports().castSwap
  const out: NodaroMotionSteps = {}
  for (const [engine, entry] of Object.entries(steps) as Array<[keyof NodaroMotionSteps, CastSwapSteps | undefined]>) {
    const sent = stepsForEngine(entry, cs)
    if (sent) out[engine] = sent
  }
  return out
}

/** Whether any engine has a step set. */
export function anyStepsSet(steps: NodaroMotionSteps | null | undefined): boolean {
  return !!steps && Object.keys(withoutEmptySteps(steps)).length > 0
}

/** TRANSITION SHIM (the 2026-10-26 rename): each entry also under its earlier key. */
export function withEarlierStepsKeys(steps: NodaroMotionSteps): NodaroMotionStepsForPlugin {
  return withEarlierEngineKeys(steps)
}

/**
 * The tolerant read of the stored row: an earlier key read as the engine's
 * current one, each entry validated on its own (an invalid one dropped with a
 * warning), an empty one left out. Not an object at all reads as never saved
 * (null). Returns new objects.
 */
export function parseNodaroMotionSteps(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionSteps | null {
  const parsed = parseByEngine(value, NODARO_MOTION_STEPS_KEY, castSwapStepsSchema, warn)
  return parsed ? withoutEmptySteps(parsed) : null
}
