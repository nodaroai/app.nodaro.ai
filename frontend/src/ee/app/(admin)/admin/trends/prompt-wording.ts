// The Flex prompt wording (pure), as the admin screens offer it: "current"
// (today's, the default) or "new" (a movement lock, the picture roles, a
// closing restatement and the avoid part as a failure list). Read only by the
// Flexible prompt: every Precise prompt ignores it. An engine words it only
// when its `castSwap.promptWordings` lists it (the server's
// backend/src/lib/nodaro-motion-prompt-wording.ts rules).

import type { CastSwapPromptWordingId, TrendEngineEnvironment } from "@/lib/api"
import { SHARED_SETTING_ENVIRONMENTS } from "./clip-preparation"

export const PROMPT_WORDINGS: ReadonlyArray<{ value: CastSwapPromptWordingId; label: string; hint: string }> = [
  { value: "current", label: "Current", hint: "Today's Flex prompt (the default)." },
  {
    value: "new",
    label: "New",
    hint: "Adds a movement lock, what to take from each picture and a closing restatement, and turns the avoid list into a failure list.",
  },
]

/** Said beside the direct-run control (the setting is one row every environment shares). */
export const DIRECT_WORDING_NOTE = "Applies to every direct Flex run on this engine, in every environment."

/** Whether an environment's engine words a Flex prompt the new way. */
function envTakesNew(env: TrendEngineEnvironment | undefined): boolean {
  return (env?.supports.castSwap?.promptWordings ?? []).includes("new")
}

/** A trend's editor: whether some environment's engine words it the new way (unknown while the environments are: false). */
export function someEnvironmentTakesNewWording(envs: readonly TrendEngineEnvironment[] | undefined): boolean {
  return (envs ?? []).some(envTakesNew)
}

/** The environments (of `envs`) whose engine cannot word it the new way: a trend on "new" can't be published there. */
export function environmentsLackingNewWording(envs: readonly TrendEngineEnvironment[] | undefined): string[] {
  return (envs ?? []).filter((e) => !envTakesNew(e)).map((e) => e.env)
}

/**
 * Admin → Nodaro Motion: the environments (of `SHARED_SETTING_ENVIRONMENTS`,
 * in that order) whose engine cannot word it the new way — none recorded, or
 * one that does not list it. Unknown while the environments are
 * (undefined). "New" is offered only when this is empty: the setting is
 * shared, and the server refuses the save otherwise (409 `engine_unsupported`).
 */
export function environmentsThatCannotUseNewWording(envs: readonly TrendEngineEnvironment[] | undefined): string[] | undefined {
  if (!envs) return undefined
  return SHARED_SETTING_ENVIRONMENTS.filter((name) => !envTakesNew(envs.find((e) => e.env === name)))
}
