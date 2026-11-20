/**
 * Video Remake's 3D previz clips, the deployment's own default
 * (`nodaro-motion-previz.ts`): accepted on Nodaro's own deployment, not
 * accepted under a white-label surface profile (`surface.header:
 * "white-label"`), until an admin of that deployment chooses.
 *
 * Its own module, apart from the setting's: this one reads the deployment's
 * surface profile, and the setting's module stays pure.
 */
import { runtimeSurfaceProfile } from "./surface-profile.js"

/** Whether a deployment whose admin never chose accepts a 3D previz clip: every deployment but a white-label one. */
export function previzOfferedByDefault(): boolean {
  return runtimeSurfaceProfile().header !== "white-label"
}
