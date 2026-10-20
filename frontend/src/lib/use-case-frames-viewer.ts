import { USE_CASE_FRAMES_TYPE } from "@nodaro/render-rules"
import { isNodeUnavailable, surfaceAvailabilityLoaded, useSurfaceAvailability } from "./surface-availability"

/**
 * Whether the canvas's run of a use-case node sends an `auto` framing source
 * as it is (decided 2026-10-20): unless Speaker Frames is KNOWN to be withheld
 * from the viewer, when it is sent as the even split
 * (`usecaseFramingForViewer`). While the viewer's availability is still
 * loading, `auto` is sent as is and the route decides it for the real caller
 * (an `auto` body is never refused) — never a silent downgrade of a viewer who
 * may follow faces.
 */
export function usecaseFramesOffered(): boolean {
  return !usecaseFramesWithheld()
}

/**
 * Whether the editor's estimate prices an `auto` framing source as the even
 * split: only once the viewer's availability has landed and withholds Speaker
 * Frames. Before that it quotes following faces — the dearer run, never a
 * quote under the run's hold.
 */
export function usecaseFramesWithheld(): boolean {
  return surfaceAvailabilityLoaded() && isNodeUnavailable(USE_CASE_FRAMES_TYPE)
}

/** What the editor shows a viewer of the framing source: nothing until their availability has landed. */
export type UseCaseFramesViewer = "loading" | "offered" | "withheld"

export function usecaseFramesViewer(): UseCaseFramesViewer {
  if (!surfaceAvailabilityLoaded()) return "loading"
  return isNodeUnavailable(USE_CASE_FRAMES_TYPE) ? "withheld" : "offered"
}

/** `usecaseFramesViewer`, re-read when the viewer's availability lands. */
export function useUseCaseFramesViewer(): UseCaseFramesViewer {
  useSurfaceAvailability()
  return usecaseFramesViewer()
}
