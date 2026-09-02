import { registerPromptPolicy, getRegisteredPromptPolicyIds } from "../prompt-policy.js"
import { minorAgeFloorPolicy } from "./minor-age-floor.js"

export { minorAgeFloorPolicy, applyMinorAgeFloorToPrompt, MODEST_ATTIRE_CLAUSE } from "./minor-age-floor.js"

/** Mainline policies — registered in every process (API + worker) right after
 *  the deployment overlay, so an overlay's policies run first and mainline's
 *  safety floor runs last. Idempotent by id. */
export function registerMainlinePromptPolicies(): void {
  if (!getRegisteredPromptPolicyIds().includes(minorAgeFloorPolicy.id)) registerPromptPolicy(minorAgeFloorPolicy)
}
