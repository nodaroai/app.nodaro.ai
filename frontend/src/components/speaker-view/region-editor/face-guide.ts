/**
 * The region editor's guide for tap-first face-to-speaker (decided
 * 2026-10-13): when Speaker Frames could not tell who is who on a video fed
 * in place of an edit, the editor asks, one step at a time —
 *  1. "Which face is {speaker}?" for each speaker no face names, at a moment
 *     they talk with an unnamed face on screen; clicking a face names it;
 *  2. then "Who is this face?" for each tracked fragment still tied to no one,
 *     in time order. A track is a fragment of a person (the tracker can lose a
 *     face and pick it up again), so a person split in two takes two taps.
 * Pure: the dialog feeds it the labels as they stand with its staged changes.
 */
import type { SpeakerTrackSet, SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"
import type { Turn } from "./region-geometry"

export type FaceGuideStep =
  | { readonly kind: "speaker"; readonly speaker: string; readonly seekMs: number }
  | { readonly kind: "fragment"; readonly trackId: string; readonly seekMs: number }

export interface FaceGuideInput {
  /** The speakers no face names (`speakerViewUnnamedSpeakers`, staged changes applied), as the editor names them. */
  readonly unnamed: readonly string[]
  /** The transcript's turns on the clip. */
  readonly turns: readonly Turn[]
  /** The track file (boxes); until it is read, no fragment is asked about. */
  readonly body?: SpeakerTrackSet
  /** The descriptor with today's labels and the staged corrections. */
  readonly labelled?: SpeakerTrackSetDescriptor
  /** A track the person marked Nobody: tied to no one on purpose. */
  readonly nobody: (trackId: string) => boolean
  /** Steps the person skipped (`faceGuideStepKey`). */
  readonly skipped: ReadonlySet<string>
  /** The camera the guide is on (the bare video's). */
  readonly sourceId: string
}

/** A step's identity, for skipping it. */
export function faceGuideStepKey(step: { readonly kind: "speaker"; readonly speaker: string } | { readonly kind: "fragment"; readonly trackId: string }): string {
  return step.kind === "speaker" ? `speaker:${step.speaker}` : `track:${step.trackId}`
}

export function faceGuideSteps(input: FaceGuideInput): FaceGuideStep[] {
  const named = new Map((input.labelled?.sources.find((s) => s.sourceId === input.sourceId)?.tracks ?? []).map((t) => [t.id, t.speaker] as const))
  const tracks = input.body?.sources.find((s) => s.sourceId === input.sourceId)?.tracks ?? []
  // Faces nobody is tied to: what a "Which face is …?" click can name.
  const open = tracks.filter((t) => !named.get(t.id) && !input.nobody(t.id))

  const speakerSteps: FaceGuideStep[] = input.unnamed.flatMap((speaker) => {
    const turns = input.turns.filter((t) => t.speaker === speaker)
    if (turns.length === 0) return []
    let seekMs = Number.POSITIVE_INFINITY
    for (const t of open) {
      for (const b of t.boxes) {
        if (b.ms < seekMs && turns.some((turn) => b.ms >= turn.startMs && b.ms < turn.endMs)) seekMs = b.ms
      }
    }
    return [{ kind: "speaker" as const, speaker, seekMs: Number.isFinite(seekMs) ? seekMs : Math.min(...turns.map((t) => t.startMs)) }]
  })

  const fragmentSteps: FaceGuideStep[] = open
    .filter((t) => t.boxes.length > 0)
    .map((t) => ({ kind: "fragment" as const, trackId: t.id, seekMs: t.boxes[0]!.ms }))
    .sort((a, b) => a.seekMs - b.seekMs)

  return [...speakerSteps, ...fragmentSteps].filter((s) => !input.skipped.has(faceGuideStepKey(s)))
}
