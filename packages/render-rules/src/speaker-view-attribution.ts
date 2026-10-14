/**
 * Tap-first face-to-speaker (decided 2026-10-13): which speakers of a
 * video-fed Speaker View no face track names.
 *
 * Speaker Frames' automatic matcher cannot accept a short two-speaker clip
 * (its minimum is several clean turns per person), and it abstains wherever
 * it is unsure; an abstaining track carries no `speaker`. The app never
 * predicts that from the transcript — it reads the RESULT: a transcript
 * speaker that no track on the bare video names, after today's rename map and
 * the Speaker Frames node's corrections (`trackAssignments`), is one the
 * person is asked about ("Which face is …?"). The same answer serves the
 * badge, the panels and the region editor's guide, and it clears itself as
 * soon as each speaker has a face.
 *
 * A speaker with a box the person drew is not asked about: the box frames
 * them, and labels a track by its region at run time. Fewer than two speakers
 * asks nothing (one speaker is followed without a name).
 *
 * Pure; never throws.
 */
import { transcriptSpeakerLabels, type SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"
import { SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID } from "./speaker-frames.js"
import { drawnSpeakerRegions, labelSpeakerViewTracks, speakerRenameMapOf, speakerViewTracksDescriptor } from "./speaker-view-tracks.js"

/**
 * Whether a face track on camera `sourceId` names a speaker: ONE definition of
 * "this speaker is tracked", for the tap-first question (who is asked about)
 * and for the automatic boxes (decided 2026-10-13: faces win — a speaker a
 * track names is followed by it, never given a default box). `labelled` is
 * the descriptor with the app's labels applied (the rename map and the
 * corrections, `labelSpeakerViewTracks`). A speaker counts as named by its
 * transcript label or by the name it shows under the transcript's rename map;
 * a track counts by its label or the raw label behind it.
 */
export function speakerViewTrackedOn(labelled: Pick<SpeakerTrackSetDescriptor, "sources">, sourceId: string, transcript: unknown): (speaker: string) => boolean {
  const named = new Set<string>()
  for (const t of labelled.sources.find((s) => s.sourceId === sourceId)?.tracks ?? []) {
    if (t.speaker) named.add(t.speaker)
    if (t.speaker && t.attribution?.rawSpeaker) named.add(t.attribution.rawSpeaker)
  }
  const names = speakerRenameMapOf(transcript) ?? {}
  return (speaker) => named.has(speaker) || (Object.hasOwn(names, speaker) && !!names[speaker] && named.has(names[speaker]!))
}

export interface SpeakerViewUnnamedInput {
  /** Speaker Frames' output descriptor (or its JSON), as the node saved it. */
  readonly tracks: unknown
  /** The transcript Speaker View reads (its labels, and its rename map). */
  readonly transcript: unknown
  /** The Speaker Frames node's corrections (staged ones, in the region editor). */
  readonly trackAssignments?: unknown
  /** The Speaker View node's `speakerRegions` / `defaultRegionKeys`. */
  readonly speakerRegions?: unknown
  readonly defaultRegionKeys?: unknown
}

export interface SpeakerViewUnnamedSpeaker {
  /** The transcript's own label (what a correction is saved against). */
  readonly speaker: string
  /** The name it shows under today (the rename map), else the label. */
  readonly name: string
}

/** The transcript's speakers, in first-spoken order, that no face track on the bare video names. */
export function speakerViewUnnamedSpeakers(input: SpeakerViewUnnamedInput): SpeakerViewUnnamedSpeaker[] {
  const descriptor = speakerViewTracksDescriptor(input.tracks)
  if (!descriptor) return []
  const blank = input.transcript === undefined || input.transcript === null || input.transcript === ""
  const labels = blank ? [] : safeLabels(input.transcript)
  if (labels.length < 2) return []
  const { descriptor: labelled } = labelSpeakerViewTracks(descriptor, { trackAssignments: input.trackAssignments, transcript: input.transcript })
  const source = labelled.sources.find((s) => s.sourceId === SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID)
  if (!source) return []

  const names = speakerRenameMapOf(input.transcript) ?? {}
  const nameOf = (raw: string) => (Object.hasOwn(names, raw) && names[raw] ? names[raw]! : raw)
  const tracked = speakerViewTrackedOn(labelled, SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID, input.transcript)
  const drawn = new Set(
    drawnSpeakerRegions(input.speakerRegions, input.defaultRegionKeys, descriptor)
      .filter((r) => r.source === SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID)
      .map((r) => r.speaker),
  )
  return labels
    .filter((raw) => {
      const name = nameOf(raw)
      return !tracked(raw) && !drawn.has(raw) && !drawn.has(name)
    })
    .map((raw) => ({ speaker: raw, name: nameOf(raw) }))
}

function safeLabels(transcript: unknown): string[] {
  try {
    return transcriptSpeakerLabels(transcript)
  } catch {
    return []
  }
}
