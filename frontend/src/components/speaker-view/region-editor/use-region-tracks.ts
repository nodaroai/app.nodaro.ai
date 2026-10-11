/**
 * The region editor's face tracks (P3.9, U4): the faces Speaker Frames
 * tracked, drawn over the camera frame, and "assign to speaker" — a manual
 * correction (P3-18 (a)) staged in the dialog and written, on Save, as
 * `trackAssignments` on the UPSTREAM Speaker Frames node, where every consumer
 * reads it at read time.
 *
 * The boxes come from the stored body the descriptor names, fetched and
 * checked against its size and hash (`readSpeakerTrackBody`). The labels shown
 * are the ones a run sends before its region match: the current rename map,
 * then the corrections (`labelSpeakerViewTracks`).
 *
 * A correction is saved with the raw label behind the name picked
 * (`speakerTrackAssignmentFor`), and shown under the name that raw label has
 * TODAY, so a rename in Camera Switch re-maps it rather than orphaning it (P3-4).
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  labelSpeakerViewTracks,
  speakerRenameMapOf,
  speakerTrackAssignmentFor,
  speakerTrackAssignmentsOf,
  speakerViewTracksDescriptor,
  type SpeakerTrackAssignment,
} from "@nodaro/render-rules"
import type { SpeakerTrackSet, SpeakerTrackSetDescriptor } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { speakerViewTracksProducer } from "@/lib/speaker-view-context"
import { readSpeakerTrackBody, speakerTrackBodyFailureOf, type SpeakerTrackBodyFailure } from "@/lib/speaker-track-body"
import type { Region } from "./region-geometry"

/** One tracked face on the frame on screen. */
export interface TrackedFace {
  readonly trackId: string
  readonly region: Region
  /** The label a run would send (rename map, then corrections); undefined = unattributed. */
  readonly speaker?: string
}

/** A staged correction: a speaker, `null` (nobody), or undefined (back to as detected). */
export type TrackEdit = string | null | undefined

/** A face counts as on screen within this share of a sample period of its nearest box. */
const NEAR_SAMPLES = 0.75

/** The faces of `sourceId` at `sourceMs`: each track's nearest box, when it is near enough. */
export function facesAt(body: SpeakerTrackSet, labelled: SpeakerTrackSetDescriptor, sourceId: string, sourceMs: number): TrackedFace[] {
  const source = body.sources.find((s) => s.sourceId === sourceId)
  if (!source) return []
  const window = (1000 / Math.max(0.1, body.sampleFps)) * NEAR_SAMPLES
  const speakers = new Map(labelled.sources.flatMap((s) => s.tracks.map((t) => [t.id, t.speaker] as const)))
  const out: TrackedFace[] = []
  for (const track of source.tracks) {
    let lo = 0
    let hi = track.boxes.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (track.boxes[mid]!.ms < sourceMs) lo = mid + 1
      else hi = mid
    }
    const near = [track.boxes[lo - 1], track.boxes[lo]].filter((b) => b !== undefined).sort((a, b) => Math.abs(a!.ms - sourceMs) - Math.abs(b!.ms - sourceMs))[0]
    if (!near || Math.abs(near.ms - sourceMs) > window) continue
    const speaker = speakers.get(track.id)
    out.push({ trackId: track.id, region: { x: near.x, y: near.y, w: near.w, h: near.h }, ...(speaker ? { speaker } : {}) })
  }
  return out
}

export function useRegionTracks(nodeId: string, transcript: unknown) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const producer = useMemo(() => speakerViewTracksProducer(nodeId, nodes, edges), [nodeId, nodes, edges])
  const frames = (producer?.data ?? {}) as { generatedJson?: unknown; trackAssignments?: unknown }
  const descriptor = useMemo(() => speakerViewTracksDescriptor(frames.generatedJson), [frames.generatedJson])
  const stored = useMemo(() => speakerTrackAssignmentsOf(frames.trackAssignments), [frames.trackAssignments])

  const [edits, setEdits] = useState<ReadonlyMap<string, TrackEdit>>(() => new Map())
  // The corrections as they will be saved: the stored ones, with each staged
  // change made against TODAY's rename map (its raw label beside the name).
  const effective = useMemo(() => {
    const byId = new Map<string, SpeakerTrackAssignment>(stored.map((a) => [a.trackId, a] as const))
    for (const [trackId, value] of edits) {
      if (value === undefined) byId.delete(trackId)
      else byId.set(trackId, speakerTrackAssignmentFor(trackId, value, transcript))
    }
    return [...byId.values()]
  }, [stored, edits, transcript])
  const names = useMemo(() => speakerRenameMapOf(transcript), [transcript])
  const labelled = useMemo(
    () => (descriptor ? labelSpeakerViewTracks(descriptor, { trackAssignments: effective, transcript }).descriptor : undefined),
    [descriptor, effective, transcript],
  )

  const [body, setBody] = useState<{ readonly sha?: string; readonly set?: SpeakerTrackSet; readonly error?: SpeakerTrackBodyFailure | "other" }>({})
  const sha = descriptor?.sha256
  useEffect(() => {
    if (!descriptor) return
    let live = true
    readSpeakerTrackBody(descriptor).then(
      (set) => { if (live) setBody({ sha: descriptor.sha256, set }) },
      (err: unknown) => { if (live) setBody({ sha: descriptor.sha256, error: speakerTrackBodyFailureOf(err) ?? "other" }) },
    )
    return () => { live = false }
    // The file never changes under its hash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sha])
  const current = body.sha === sha ? body : {}

  const at = useCallback(
    (sourceId: string, sourceMs: number): TrackedFace[] => (current.set && labelled ? facesAt(current.set, labelled, sourceId, sourceMs) : []),
    [current.set, labelled],
  )
  const assign = useCallback((trackId: string, value: TrackEdit) => {
    setEdits((prev) => new Map(prev).set(trackId, value))
  }, [])
  /** The correction a track holds now (staged or stored): a speaker under
   *  today's name, null, or undefined (none). */
  const assignmentOf = useCallback(
    (trackId: string): TrackEdit => {
      const a = effective.find((x) => x.trackId === trackId)
      if (!a) return undefined
      if (a.speaker && a.rawSpeaker && names && Object.hasOwn(names, a.rawSpeaker)) return names[a.rawSpeaker] || a.speaker
      return a.speaker
    },
    [effective, names],
  )

  const dirty = edits.size > 0
  const save = useCallback(() => {
    if (!dirty || !producer) return
    updateNodeData(producer.id, { trackAssignments: effective.length > 0 ? effective : undefined })
  }, [dirty, producer, effective, updateNodeData])

  return {
    wired: !!producer,
    descriptor,
    loading: !!descriptor && !current.set && !current.error,
    error: current.error,
    facesAt: at,
    assign,
    assignmentOf,
    dirty,
    save,
  }
}

export type RegionTracksState = ReturnType<typeof useRegionTracks>
