/**
 * Video Remake's roles planned from the prompt, the deployment's own default
 * (`nodaro-motion-plan-roles.ts`): offered on Nodaro's own deployment, not
 * offered under a white-label surface profile (`surface.header:
 * "white-label"`), until an admin of that deployment chooses.
 *
 * Its own module, apart from the setting's: this one reads the deployment's
 * surface profile, and the setting's module stays pure.
 */
import { runtimeSurfaceProfile } from "./surface-profile.js"

/** Whether a deployment whose admin never chose offers roles planned from the prompt: every deployment but a white-label one. */
export function planRolesOfferedByDefault(): boolean {
  return runtimeSurfaceProfile().header !== "white-label"
}
