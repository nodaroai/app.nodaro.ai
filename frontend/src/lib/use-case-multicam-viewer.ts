import { MULTICAM_SPEAKER_MAP_TYPE } from "@nodaro/render-rules"
import { isNodeUnavailable, surfaceAvailabilityLoaded, useSurfaceAvailability } from "./surface-availability"

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
 * audio: "loading" until their availability has landed (nothing yet, never a
 * flash), "offered" (the Cameras settings), "withheld" (a note that the run
 * reads the first recording only until Speaker Map is enabled).
 */
export type UseCaseMulticamViewer = "loading" | "offered" | "withheld"

export function usecaseMulticamViewer(): UseCaseMulticamViewer {
  if (!surfaceAvailabilityLoaded()) return "loading"
  return isNodeUnavailable(MULTICAM_SPEAKER_MAP_TYPE) ? "withheld" : "offered"
}

/** `usecaseMulticamViewer`, re-read when the viewer's availability lands. */
export function useUseCaseMulticamViewer(): UseCaseMulticamViewer {
  useSurfaceAvailability()
  return usecaseMulticamViewer()
}
