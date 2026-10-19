/**
 * Camera Switch's `speakerMap` input (decided 2026-10-17): a Speaker Map
 * result wired in, merged under the panel's choices by
 * `cameraSwitchSpeakerMap` (@nodaro/shared/edl). The rules both engines apply
 * to the wire — how it is recorded, and when the run is refused before the
 * reserve — so a run is read the same wherever it starts. Pure.
 */
import { speakerMapResultOf } from "@nodaro/shared/edl"
import { unitLaneTakesSource } from "./unit-input-lanes"

/** The input's handle id. */
export const CAMERA_SWITCH_SPEAKER_MAP_HANDLE = "speakerMap"

/**
 * What a wire into the input records: the JSON string it carries, or "" when
 * its upstream produced nothing — wired but empty is refused, never read as
 * unwired (which would fall back to the order default and charge for an edit
 * on the wrong cameras). A value another wire already recorded is kept over
 * an empty one. A parameter picker that is not a text source (`sourceType`,
 * judged against the calling engine's `textSources`) is no value at all: the
 * wire is as if unwired (undefined: record nothing), as a node unit's lanes
 * read it (`unitLaneTakesSource`) — the same on both engines.
 */
export function cameraSwitchSpeakerMapLanding(
  recorded: string | undefined,
  output: string | undefined,
  source: { readonly type: string | undefined; readonly textSources: ReadonlySet<string> },
): string | undefined {
  if (!unitLaneTakesSource(source.type, source.textSources)) return recorded
  if (output) return output
  return recorded ?? ""
}

export type CameraSwitchSpeakerMapProblem = "empty-speaker-map" | "not-a-speaker-map"

/** Why a run with this `speakerMap` input is refused; null when it may go ahead (nothing wired, or a Speaker Map result). */
export function cameraSwitchSpeakerMapProblem(wired: unknown): CameraSwitchSpeakerMapProblem | null {
  if (wired === undefined) return null
  if (wired === "" || wired === null) return "empty-speaker-map"
  return speakerMapResultOf(wired) ? null : "not-a-speaker-map"
}

/** The refusal in words, the server's (the editor words it from its dictionary). */
export function cameraSwitchSpeakerMapProblemText(problem: CameraSwitchSpeakerMapProblem): string {
  return problem === "empty-speaker-map"
    ? "camera-switch: the Speaker map input got nothing — run the Speaker Map wired to it first, or disconnect it"
    : "camera-switch: the Speaker map input received something that is not a Speaker Map result — connect Speaker Map's Speaker map output to it"
}
