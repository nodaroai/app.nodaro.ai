import { USE_CASE_FRAMES_TYPE } from "@nodaro/render-rules"
import { isNodeUnavailable, settledNodeJudge, surfaceAvailabilityLoaded, useSurfaceAvailability } from "./surface-availability"

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

/**
 * What the editor shows a viewer of the framing source: whether Speaker
 * Frames is offered to them (`settledNodeJudge`). Before their answer, a
 * deployment that set node lists is judged by them from the first paint; one
 * that sets none shows nothing while the answer is awaited. After a read of
 * that answer that failed, the deployment's own lists decide (offered, where
 * it sets none), never "loading" for the rest of the session. The run and its
 * estimate do not change with it: `auto` is still sent as is (the route
 * decides it for the real caller) and quoted following faces, and a Follow
 * faces the route withholds is refused before anything is charged.
 */
export type UseCaseFramesViewer = "loading" | "offered" | "withheld"

export function usecaseFramesViewer(): UseCaseFramesViewer {
  const unavailable = settledNodeJudge()
  if (!unavailable) return "loading"
  return unavailable(USE_CASE_FRAMES_TYPE) ? "withheld" : "offered"
}

/** `usecaseFramesViewer`, re-read when the viewer's availability lands or its read fails. */
export function useUseCaseFramesViewer(): UseCaseFramesViewer {
  useSurfaceAvailability()
  return usecaseFramesViewer()
}
