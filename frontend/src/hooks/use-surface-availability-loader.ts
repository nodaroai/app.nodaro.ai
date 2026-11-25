/**
 * Load this viewer's availability answer (`GET /v1/surface/availability`,
 * `loadSurfaceAvailability`) once auth has settled, and drop it on sign-out.
 *
 * Every page that prices or offers what the deployment runs calls this — the
 * dashboard (the editor) and the pages that run a workflow outside it: a
 * published app (`/app/:slug`), its embed, a shared presentation. Without the
 * answer such a page priced by the static profile alone: a Nodaro Video
 * Upscale node with no mode was quoted in Transparent on an install that
 * cannot run Transparent, while the run takes Sharp (`models.deniedModes`,
 * read by `nodaroTransparentRunsHere`). The route needs a signed-in viewer, so
 * a signed-out one is not asked (and cannot run either).
 *
 * Light on purpose: the availability module is already in every runner's
 * bundle (the live estimate reads it), and `getAuthHeaders` is the one the
 * runners already use for their own calls.
 */
import { useEffect } from "react"
import { useAuth } from "@/hooks/use-auth"
import { getAuthHeaders } from "@/lib/api"
import { loadSurfaceAvailability, resetSurfaceAvailability } from "@/lib/surface-availability"

export function useSurfaceAvailabilityLoader(): void {
  const { user, loading: authLoading } = useAuth()
  // Keyed on the user: the answer is per viewer (an admin's includes nodes
  // their users must not be offered), so it is dropped on sign-out and on a
  // change of account instead of lingering until — or unless — the next fetch lands.
  useEffect(() => {
    if (authLoading) return
    if (user) void loadSurfaceAvailability(getAuthHeaders, user.id)
    else resetSurfaceAvailability()
  }, [authLoading, user])
}
