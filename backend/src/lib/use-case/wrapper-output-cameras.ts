/**
 * What a run on several recordings or a Master audio reports about its
 * cameras (decided 2026-10-17): per speaker (first heard first) the camera
 * position Speaker Map gave them (null = no camera of their own: the wide
 * shot) and its lead in dB, plus Audio Sync's and Speaker Map's notes
 * verbatim. Undefined for a run that built neither step (one recording, or
 * recordings already in sync on one camera). Pure.
 */
import { speakerMapResultOf, transcriptSpeakerLabels } from "@nodaro/shared/edl"
import { usecaseRecordingPosition, type StoredInlineGraph } from "@nodaro/render-rules"
import { completedOutput, isRecord, type UseCaseCamerasReport } from "./wrapper-output-parts.js"

/** A JSON value or its string form; a string that does not parse is nothing. */
function parsed(raw: unknown): unknown {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const notesOf = (raw: unknown): string[] => {
  const v = parsed(raw)
  return isRecord(v) && Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === "string") : []
}

export function usecaseCamerasReport(graph: StoredInlineGraph, nodeStates: Readonly<Record<string, unknown>>): UseCaseCamerasReport | undefined {
  const mc = graph.outputMap.multicam
  if (!mc) return undefined
  const sync = mc.sync ? completedOutput(nodeStates, mc.sync.nodeId)?.json : undefined
  const map = mc.map ? speakerMapResultOf(completedOutput(nodeStates, mc.map.nodeId)?.json) : null
  // With fewer than two cameras nothing is cut between: Speaker Map ran only to
  // make the edit, and its "no camera of their own" per speaker says nothing.
  const cutting = graph.nodes.some((n) => n.type === "camera-switch")
  const shown = map && cutting ? map : null
  const order = shown ? transcriptSpeakerLabels(completedOutput(nodeStates, graph.outputMap.transcript.nodeId)?.json) : []
  const labels = shown ? [...order, ...Object.keys(shown.speakerMap).filter((l) => !order.includes(l))] : []
  return {
    speakers: labels.map((speaker, i) => {
      const camera = shown!.speakerMap[speaker] ?? ""
      return { speaker, ordinal: i + 1, camera: camera ? usecaseRecordingPosition(camera) : null, marginDb: shown!.confidence[speaker]?.marginDb ?? null }
    }),
    syncNotes: notesOf(sync),
    mapNotes: shown ? [...shown.notes] : [],
  }
}
