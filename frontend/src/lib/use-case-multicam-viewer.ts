import { MULTICAM_SPEAKER_MAP_TYPE } from "@nodaro/render-rules"
import { isNodeUnavailable, surfaceAvailabilityFailed, surfaceAvailabilityLoaded, useSurfaceAvailability } from "./surface-availability"

/**
 * Whether the viewer may run a use-case node on several recordings or a
 * Master audio (decided 2026-10-19): only while Speaker Map — the step that
 * tells who is on which camera — is available to them (admins, while it is
 * hidden from users). Otherwise the canvas's run and its estimate read the
 * node's first recording only, exactly as before multicam
 * (`usecaseRunMaxRecordings`) — the server's engine asks the same of the
 * run's user. Until the viewer's availability has landed the answer is "no":
 * the run as before, never one the route would refuse.
 */
export function usecaseMulticamOffered(): boolean {
  return surfaceAvailabilityLoaded() && !isNodeUnavailable(MULTICAM_SPEAKER_MAP_TYPE)
}

/**
 * What the editor shows a viewer of a node on several recordings or a Master
 * audio: "loading" while their availability is awaited (nothing yet, never a
 * flash), "offered" (the Cameras settings), "withheld" (a note that the run
 * reads the first recording only until Speaker Map is enabled).
 *
 * After a read of that answer that failed it is "withheld", whatever the
 * deployment's static profile says: that is what the run then does
 * (`usecaseMulticamOffered` is "no", as the server's answer is for an
 * availability it cannot read), and the profile cannot say "offered" — the
 * admin switch that withholds Speaker Map from users (as on nodaro.ai today)
 * is not in it. Never left on "loading" for the rest of the session.
 */
export type UseCaseMulticamViewer = "loading" | "offered" | "withheld"

export function usecaseMulticamViewer(): UseCaseMulticamViewer {
  if (surfaceAvailabilityLoaded()) return isNodeUnavailable(MULTICAM_SPEAKER_MAP_TYPE) ? "withheld" : "offered"
  return surfaceAvailabilityFailed() ? "withheld" : "loading"
}

/** `usecaseMulticamViewer`, re-read when the viewer's availability lands or its read fails. */
export function useUseCaseMulticamViewer(): UseCaseMulticamViewer {
  useSurfaceAvailability()
  return usecaseMulticamViewer()
}
