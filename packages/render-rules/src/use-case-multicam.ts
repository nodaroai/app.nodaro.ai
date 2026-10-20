/**
 * The front every use-case builder puts before its plan when a run has two or
 * more recordings or a Master audio (decided 2026-10-17): the recordings, the
 * sound every step listens to (Master audio; else an audio-only recording;
 * else the wide — or Camera 1 — again, as a second audio source, so the
 * sound never jumps between camera microphones), Audio Sync (unless the
 * recordings are already in sync), Speaker Map (with two or more cameras),
 * and the Camera Switch node that sits between a builder's plan and render.
 * Pure: fresh objects every call.
 *
 * Mirrors the Multicam Cut template: the plan takes every recording with its
 * role (master audio / camera / wide) and Audio Sync's offsets; Camera Switch
 * reads the plan, the diarized transcript and Speaker Map's map, with layout
 * hints off; the render reads the switched edit and its renamed transcript and
 * resolves media from the edit (no sources wire).
 *
 * A Master audio that is one of the recordings (the same upstream node wired
 * into both inputs, or the same file sent twice) is no Master audio
 * (`usecaseDistinctMaster`): every reader drops it before the run is built,
 * so one camera is the one-recording chain and two or more are built as with
 * no master (the sound repeated from a camera). Nothing refuses it, and no
 * Audio Sync lines a file up against itself.
 */
import type { UseCaseGraphEdge, UseCaseGraphNode, UseCaseHandleRef, UseCaseMediaSource } from "./use-case-graph"
// Type only: the registry composes the specs, which load the builders that load this module.
import type { UseCaseSources } from "./use-case-registry"
import { USE_CASE_MASTER_NODE_ID, USE_CASE_MAX_RECORDINGS, usecaseRecordingNodeId, usecaseRecordings, usecaseRecordingsOf, type UseCaseCameras } from "./use-case-cameras"
import { usecaseEdge, usecaseNode, usecaseSourceNode } from "./use-case-graph-parts"
import { MULTICAM_SPEAKER_MAP_TYPE } from "./speaker-map-step"
import { usecaseFramingForViewer } from "./use-case-framing-viewer"

export { MULTICAM_SPEAKER_MAP_TYPE }
export const MULTICAM_NODE_IDS = Object.freeze({ master: USE_CASE_MASTER_NODE_ID, sync: "uc-sync", map: "uc-map", switch: "uc-switch" } as const)
/** The transcript Speaker Map and Camera Switch read, unless a builder names its own (`transcript`). */
const DEFAULT_TRANSCRIPT: UseCaseHandleRef = Object.freeze({ nodeId: "uc-transcribe", handle: "json" })

export type MulticamSourceRole = "master-audio" | "camera" | "wide"

export interface MulticamFront {
  /** The recordings (+ the master), Audio Sync, Speaker Map — no Transcribe, no plan. */
  readonly nodes: readonly UseCaseGraphNode[]
  /** Recordings → Audio Sync / Speaker Map; Audio Sync → Speaker Map's offsets; Transcribe → Speaker Map's transcript. */
  readonly edges: readonly UseCaseGraphEdge[]
  /** What Transcribe and Silence Detect read. */
  readonly sound: { readonly nodeId: string; readonly pip: "audio" | "video" }
  /** The master first, then every other recording in order (Edit Plan's sourceOrder). */
  readonly planSourceIds: readonly string[]
  readonly planSourceConfig: Readonly<Record<string, { readonly role: MulticamSourceRole }>>
  /** Audio Sync's json, when it runs. */
  readonly offsets: UseCaseHandleRef | null
  /** Speaker Map's json, with two or more cameras (or when asked for). */
  readonly map: UseCaseHandleRef | null
  /** Every recording's built node id, in order. */
  readonly cameraIds: readonly string[]
  /** The recordings with picture. */
  readonly videoCameraIds: readonly string[]
  readonly wideId: string | null
  readonly masterId: string
}

/**
 * How many recordings a run of a node reads (decided 2026-10-19): its type's
 * `maxRecordings` when the run's viewer may run several cameras — Speaker Map
 * (MULTICAM_SPEAKER_MAP_TYPE) is available to them — else one: the run
 * exactly as before multicam, every further wire and any Master audio
 * ignored, no Audio Sync, the same quote. ONE rule for both engines and the
 * estimate; each asks the viewer's availability its own way.
 */
export function usecaseRunMaxRecordings(maxRecordings: number, multicam: boolean): number {
  return multicam ? maxRecordings : 1
}

/**
 * The Master audio a run reads (decided 2026-10-19): `master` unless it is one
 * of `recordings` — the same upstream node wired into both inputs (compared by
 * node id: the estimate's expansion and both engines' bodies, through
 * `usecaseRunRecordings`) or, for a request that names only files, the same
 * file sent as both (compared by URL: the route). Such a master is that camera's
 * own track: the run is built as with no Master audio. ONE rule for the
 * route, both engines and the estimate, so the quote is the run.
 */
export function usecaseDistinctMaster<T extends string>(master: T | undefined | null, recordings: readonly T[]): T | undefined {
  return master && !recordings.includes(master) ? master : undefined
}

/**
 * What a run of a node sends as its recordings, Master audio and settings —
 * BOTH engines' one rule (decided 2026-10-19): the wired recordings in the
 * node's order (`usecaseRecordingsOf`), as many as the run reads for this
 * viewer (`usecaseRunMaxRecordings`); the Master audio only when the viewer
 * may run several cameras and the type takes it, and never from the upstream
 * node one of the recordings comes from — compared by NODE, as the estimate's
 * expansion compares it (a Split Media's audio beside its own video is that
 * camera's track, whatever its URL; the route, which sees only files, drops a
 * master on the same file as a recording); and the node's settings without
 * `cameras` unless the run reads two or more recordings or a Master audio —
 * one recording sends no Cameras settings at all, so a stale or malformed
 * value on the node never reaches (or fails) a one-recording run. Its framing
 * source as the viewer's run reads it (`usecaseFramingForViewer`, decided
 * 2026-10-20): `auto` is sent as the even split to a viewer Speaker Frames is
 * withheld from.
 */
export function usecaseRunRecordings<T extends { readonly nodeId: string; readonly url: string }>(input: {
  readonly wired: readonly T[] | undefined
  readonly data: unknown
  readonly maxRecordings: number
  readonly takesMaster: boolean
  /** The Master audio wired into the node: its upstream node and its file. */
  readonly master?: { readonly nodeId: string; readonly url: string } | undefined
  readonly multicam: boolean
  /** Whether Speaker Frames is available to the run's viewer: else an `auto` framing source is the even split. */
  readonly framesAvailable: boolean
  /** The settings the run would send (`usecaseSentSettings`). */
  readonly settings: Readonly<Record<string, unknown>>
}): { readonly recordings: T[]; readonly masterAudioUrl?: string; readonly settings: Readonly<Record<string, unknown>>; readonly sendsCameras: boolean } {
  const recordings = usecaseRecordingsOf(input.wired, input.data, usecaseRunMaxRecordings(input.maxRecordings, input.multicam))
  const master = input.multicam && input.takesMaster && input.master?.url ? input.master : undefined
  const masterAudioUrl = master && usecaseDistinctMaster(master.nodeId, recordings.map((r) => r.nodeId)) ? master.url : undefined
  const sendsCameras = recordings.length > 1 || !!masterAudioUrl
  const framed = usecaseFramingForViewer(input.settings, input.framesAvailable)
  const { cameras: _cameras, ...oneRecording } = framed
  return { recordings, ...(masterAudioUrl ? { masterAudioUrl } : {}), settings: sendsCameras ? framed : oneRecording, sendsCameras }
}

/** Two or more recordings, or a Master audio: the run is built with the multicam front. */
export function usecaseIsMulticam(sources: UseCaseSources): boolean {
  return (sources.moreMedia?.length ?? 0) > 0 || !!sources.masterAudio
}


/**
 * Which recording (0-based) the sound repeats when there is no Master audio
 * and no audio-only recording: the wide, else the first with picture; null
 * when Master audio is wired or a recording is sound only. ONE rule for the
 * builder (the `uc-master` second source) and the estimate's expansion (which
 * gives that `uc-master` the recorded length of the recording it repeats).
 */
export function usecaseSoundRecordingIndex(kinds: readonly ("video" | "audio")[], wide: number | null, masterAudio: boolean): number | null {
  if (masterAudio || kinds.includes("audio")) return null
  return wide !== null && kinds[wide - 1] === "video" ? wide - 1 : Math.max(0, kinds.indexOf("video"))
}

/** A recording's node name: its camera position, or its place as the sound. */
const recordingLabel = (r: UseCaseMediaSource, i: number): string => (r.kind === "video" ? `Camera ${i + 1}` : `Recording ${i + 1} (sound)`)

/**
 * The node the sound of a multicam run is: the Master audio (`uc-master`);
 * else the audio-only recording's own node; else `uc-master` built on the
 * wide's (or Camera 1's) file, as an audio source. An audio episode keeps only
 * this node.
 */
export function usecaseMulticamSoundNode(sources: UseCaseSources, cameras: UseCaseCameras): UseCaseGraphNode {
  const recs = usecaseRecordings(sources)
  if (sources.masterAudio) {
    return usecaseSourceNode(MULTICAM_NODE_IDS.master, { ...sources.masterAudio, kind: "audio" }, 0, recs.length, "Master audio")
  }
  const audioOnly = recs.findIndex((r) => r.kind === "audio")
  if (audioOnly >= 0) return usecaseSourceNode(usecaseRecordingNodeId(audioOnly), recs[audioOnly]!, 0, audioOnly, recordingLabel(recs[audioOnly]!, audioOnly))
  const k = usecaseSoundRecordingIndex(recs.map((r) => r.kind), cameras.wide, false)!
  const r = recs[k]!
  return usecaseSourceNode(
    MULTICAM_NODE_IDS.master,
    { url: r.url, kind: "audio", ...(r.durationSec !== undefined ? { durationSec: r.durationSec } : {}) },
    0,
    recs.length,
    `Sound (Camera ${k + 1})`,
  )
}

/**
 * The multicam front of `sources` (see the module note). `withMap`: true
 * builds Speaker Map even on one camera, false never builds it; by default it
 * is built with two or more cameras. Throws on one recording without a master
 * (that run is the one-recording chain, never a front).
 */
export function usecaseMulticamFront(
  sources: UseCaseSources,
  cameras: UseCaseCameras,
  opts: { readonly withMap?: boolean; readonly transcript?: UseCaseHandleRef } = {},
): MulticamFront {
  const transcript = opts.transcript ?? DEFAULT_TRANSCRIPT
  if (!usecaseIsMulticam(sources)) throw new Error("usecaseMulticamFront: one recording without Master audio is not multicam")
  const recs = usecaseRecordings(sources)
  const ids = recs.map((_, i) => usecaseRecordingNodeId(i))
  const nodes: UseCaseGraphNode[] = recs.map((r, i) => usecaseSourceNode(ids[i]!, r, 0, i, recordingLabel(r, i)))
  const sound = usecaseMulticamSoundNode(sources, cameras)
  if (!ids.includes(sound.id)) nodes.push(sound)
  const masterId = sound.id
  const pip = (id: string): "audio" | "video" => (nodes.find((n) => n.id === id)?.type === "upload-audio" ? "audio" : "video")
  const videoCameraIds = ids.filter((_, i) => recs[i]!.kind === "video")
  const wideId = cameras.wide !== null && recs[cameras.wide - 1]?.kind === "video" ? ids[cameras.wide - 1]! : null
  const planSourceIds = [masterId, ...ids.filter((id) => id !== masterId)]
  const planSourceConfig = Object.fromEntries(
    planSourceIds.map((id) => [id, { role: (id === masterId ? "master-audio" : id === wideId ? "wide" : "camera") as MulticamSourceRole }]),
  )
  const edges: UseCaseGraphEdge[] = []
  let offsets: UseCaseHandleRef | null = null
  if (!cameras.synced) {
    nodes.push(usecaseNode(MULTICAM_NODE_IDS.sync, "audio-sync", 1, 3, { label: "Line Up Recordings", reference: masterId, sourceOrder: [...planSourceIds] }))
    for (const id of planSourceIds) edges.push(usecaseEdge(id, pip(id), MULTICAM_NODE_IDS.sync, "sources"))
    offsets = { nodeId: MULTICAM_NODE_IDS.sync, handle: "json" }
  }
  let map: UseCaseHandleRef | null = null
  if (opts.withMap ?? videoCameraIds.length >= 2) {
    nodes.push(usecaseNode(MULTICAM_NODE_IDS.map, MULTICAM_SPEAKER_MAP_TYPE, 2, 3, {
      label: "Who Is On Which Camera", sourceOrder: [...planSourceIds], masterSourceId: masterId, ...(wideId ? { wideSourceId: wideId } : {}),
    }))
    for (const id of planSourceIds) edges.push(usecaseEdge(id, pip(id), MULTICAM_NODE_IDS.map, "sources"))
    if (offsets) edges.push(usecaseEdge(offsets.nodeId, offsets.handle, MULTICAM_NODE_IDS.map, "offsets"))
    edges.push(usecaseEdge(transcript.nodeId, transcript.handle, MULTICAM_NODE_IDS.map, "transcript"))
    map = { nodeId: MULTICAM_NODE_IDS.map, handle: "json" }
  }
  return { nodes, edges, sound: { nodeId: masterId, pip: pip(masterId) }, planSourceIds, planSourceConfig, offsets, map, cameraIds: ids, videoCameraIds, wideId, masterId }
}

/** Camera Switch between a plan and its render, with two or more cameras; hints off (decided 2026-10-17). */
export function usecaseSwitchNode(front: MulticamFront, cameras: UseCaseCameras, column: number, row: number): UseCaseGraphNode | null {
  if (front.videoCameraIds.length < 2) return null
  const byOrder = Object.fromEntries(
    Object.entries(cameras.speakerCameras)
      .map(([ordinal, pos]) => [ordinal, pos === 0 ? "" : usecaseRecordingNodeId(pos - 1)] as const)
      .filter(([, id]) => id === "" || front.videoCameraIds.includes(id)),
  )
  return usecaseNode(MULTICAM_NODE_IDS.switch, "camera-switch", column, row, {
    label: "Cut To The Speaker", layoutHints: false, ...(Object.keys(byOrder).length > 0 ? { speakerMapByOrder: byOrder } : {}),
  })
}

/** The switch's three wires: the plan's edit, the transcript (the builder's own, else `uc-transcribe`'s), the map (when built). */
export function usecaseSwitchWires(front: MulticamFront, edit: UseCaseHandleRef, transcript: UseCaseHandleRef = DEFAULT_TRANSCRIPT): UseCaseGraphEdge[] {
  return [
    usecaseEdge(edit.nodeId, edit.handle, MULTICAM_NODE_IDS.switch, "edl"),
    usecaseEdge(transcript.nodeId, transcript.handle, MULTICAM_NODE_IDS.switch, "transcript"),
    ...(front.map ? [usecaseEdge(front.map.nodeId, front.map.handle, MULTICAM_NODE_IDS.switch, "speakerMap")] : []),
  ]
}

export interface UseCaseRecordingsProblem {
  readonly code: "too_many_recordings" | "recordings_two_audio_only" | "wide_camera_out_of_range"
  readonly message: string
}

/**
 * Why these recordings cannot run, or null (decided 2026-10-17): the route
 * refuses with it before anything is written; the editor badges it. Six in
 * all (Audio Sync's and Edit Plan's limit), counting Master audio and, with
 * two or more cameras and no master or audio-only recording, the sound's own
 * slot; one audio-only recording at most, and none beside Master audio; the
 * wide shot must be a recording with picture. One recording without a master
 * is never a problem here (its own refusals stay where they are).
 */
export function usecaseRecordingsProblem(input: {
  readonly kinds: readonly ("video" | "audio")[]
  readonly masterAudio: boolean
  readonly cameras: unknown
}): UseCaseRecordingsProblem | null {
  const { kinds, masterAudio } = input
  if (kinds.length < 2 && !masterAudio) return null
  const audioOnly = kinds.filter((k) => k === "audio").length
  if (audioOnly > 1 || (audioOnly === 1 && masterAudio)) {
    return { code: "recordings_two_audio_only", message: "Only one recording can be sound only — wire the recorder's track into Master audio and the cameras into Recordings." }
  }
  const videos = kinds.length - audioOnly
  const soundSlot = !masterAudio && audioOnly === 0 && videos >= 2 ? 1 : 0
  if (kinds.length + (masterAudio ? 1 : 0) + soundSlot > USE_CASE_MAX_RECORDINGS) {
    return {
      code: "too_many_recordings",
      message: `Up to ${USE_CASE_MAX_RECORDINGS} recordings in all, Master audio included. Without Master audio, two or more cameras keep one place for the sound, so up to ${USE_CASE_MAX_RECORDINGS - 1} cameras.`,
    }
  }
  const wide = (input.cameras as { wide?: unknown } | null | undefined)?.wide
  if (typeof wide === "number" && (wide > kinds.length || kinds[wide - 1] !== "video")) {
    return { code: "wide_camera_out_of_range", message: `The wide camera must be one of the recordings with picture (1–${kinds.length}).` }
  }
  return null
}

/**
 * The run's kind from its recordings' kinds (decided 2026-10-18): video when
 * any has picture; audio when none known has picture and one is sound only;
 * undefined when none is known. ONE rule for the route (prepareUseCase), the
 * estimate's expansion and the editor's audio lock — a Master audio is another
 * input and is never passed here.
 */
export function usecaseRecordingsKind(kinds: readonly ("video" | "audio" | undefined)[]): "video" | "audio" | undefined {
  if (kinds.includes("video")) return "video"
  return kinds.includes("audio") ? "audio" : undefined
}
