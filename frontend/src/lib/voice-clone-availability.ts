import { isNodeUnavailable, surfaceAvailabilityLoaded, useSurfaceAvailability } from "@/lib/surface-availability"

/** The availability id of a one-off clone (the backend's `ONE_OFF_VOICE_CLONE_FEATURE`), a gateable feature. */
const ONE_OFF_VOICE_CLONE_FEATURE = "voice-clone-one-off"

/**
 * One-off clones are withheld from this viewer (decided 2026-11-13): by the deployment's profile, an
 * allow-list or Admin → Availability, as the server's availability answer says. Before that answer lands,
 * the profile's own deny list decides — one denying the Voice Clone node withholds clones too, as the server
 * rules. The server refuses a withheld clone whatever this shows. Read by the editor's clone sections and the
 * app runner's "Your voice" cards alike.
 */
export function useOneOffCloneWithheld(): boolean {
  useSurfaceAvailability()
  return isNodeUnavailable(ONE_OFF_VOICE_CLONE_FEATURE) || (!surfaceAvailabilityLoaded() && isNodeUnavailable("voice-clone"))
}
