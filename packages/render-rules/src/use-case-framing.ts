/**
 * Where a framed use-case render's boxes come from (decided 2026-10-12/17):
 *  - `static` — the even split by speaker (Speaker View's automatic boxes);
 *  - `tracking` — Speaker Frames follows faces and its tracks feed Speaker
 *    View (the boxes stay the fallback for any speaker no track names);
 *  - `auto` — tracking while Speaker Frames is priced and available to the
 *    run's viewer, else static. The viewer's half is `usecaseFramingForViewer`
 *    (use-case-framing-viewer.ts), applied to the raw settings before they are
 *    resolved here; the price flag is the half below.
 * A resolved choice is never `auto`, so a run's stored
 * settings say how it was rendered.
 *
 * While tracks are unnamed (identity not shipped), a face is followed where a
 * camera shows one person; a camera shared by several speakers is framed by
 * the boxes. Nothing is refused for unnamed tracks. Pure.
 */
import { SPEAKER_FRAMES_PRICED } from "./speaker-frames"
import type { UseCaseGraphEdge, UseCaseGraphNode, UseCaseHandleRef } from "./use-case-graph"
import { usecaseEdge, usecaseNode } from "./use-case-graph-parts"
import { USE_CASE_FRAMES_TYPE } from "./use-case-framing-viewer"

export const USE_CASE_FRAMING_SOURCES = ["auto", "static", "tracking"] as const
export type UseCaseFramingSource = (typeof USE_CASE_FRAMING_SOURCES)[number]
export type ResolvedFramingSource = Exclude<UseCaseFramingSource, "auto">

/** The Speaker Frames step's id in every use-case graph that tracks faces. */
export const USE_CASE_FRAMES_NODE_ID = "uc-frames"

/** What `auto` resolves to once the viewer may use Speaker Frames (`usecaseFramingForViewer`): tracking while it is priced. */
export function usecaseAutoFraming(flags: { readonly framesPriced?: boolean } = {}): ResolvedFramingSource {
  return (flags.framesPriced ?? SPEAKER_FRAMES_PRICED) === true ? "tracking" : "static"
}

/** A stored or sent framing source, resolved: absent or unknown reads as `absent`; `auto` follows the flag. */
export function resolveUseCaseFramingSource(raw: unknown, absent: UseCaseFramingSource): ResolvedFramingSource {
  const known = typeof raw === "string" && (USE_CASE_FRAMING_SOURCES as readonly string[]).includes(raw)
  const choice = known ? (raw as UseCaseFramingSource) : absent
  return choice === "auto" ? usecaseAutoFraming() : choice
}

/** The Speaker Frames step a framed chain adds when it tracks faces. */
export function usecaseFramesNode(column: number, row: number): UseCaseGraphNode {
  return usecaseNode(USE_CASE_FRAMES_NODE_ID, USE_CASE_FRAMES_TYPE, column, row, { label: "Follow Faces" })
}

/**
 * Speaker Frames' wires: the edit it samples (or, in video mode, the video),
 * the transcript it names faces from, and its tracks into the render.
 */
export function usecaseFramesWires(input: {
  readonly edl?: UseCaseHandleRef
  readonly video?: UseCaseHandleRef
  readonly transcript: UseCaseHandleRef
  readonly renderId: string
}): UseCaseGraphEdge[] {
  const sampled = input.edl ? { ref: input.edl, handle: "edl" } : input.video ? { ref: input.video, handle: "video" } : undefined
  if (!sampled) throw new Error("usecaseFramesWires: Speaker Frames samples an edit or a video; neither was given")
  return [
    usecaseEdge(sampled.ref.nodeId, sampled.ref.handle, USE_CASE_FRAMES_NODE_ID, sampled.handle),
    usecaseEdge(input.transcript.nodeId, input.transcript.handle, USE_CASE_FRAMES_NODE_ID, "transcript"),
    usecaseEdge(USE_CASE_FRAMES_NODE_ID, "tracks", input.renderId, "tracks"),
  ]
}
