/**
 * Speaker Map's arithmetic (decided 2026-10-12/17): for each speaker, how loud
 * their turns are on each camera's own microphone, and which camera that makes
 * theirs. Pure — no ffmpeg, no I/O. A turn lives on the master clock (the
 * transcript's); a camera's audio on its own: sourceMs = masterMs − offsetMs (D19).
 */
import { normalizeTranscript } from "@nodaro/shared/edl"

export const SPEAKER_MAP_HOP_MS = 10

export interface SpeakerTurn { readonly speaker: string; readonly startMs: number; readonly endMs: number }

/** The algorithm's own answer (backend core). Speaker Map's published result (@nodaro/shared) is this plus a version and the edit — the worker adds them. */
export interface SpeakerMapDecision {
  readonly speakerMap: Readonly<Record<string, string>>
  readonly confidence: Readonly<Record<string, { readonly camera: string; readonly marginDb: number | null }>>
  readonly notes: readonly string[]
}

/** A transcript as an object or its JSON string (what a wire carries) — read
 *  as `transcriptSpeakerLabels` reads it, so the speakers and their turns
 *  always come from the same words. */
const parseMaybe = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

/** A speaker's consecutive words as one turn; a word with no speaker is skipped. */
export function speakerTurnsOf(transcript: unknown): SpeakerTurn[] {
  const out: SpeakerTurn[] = []
  for (const w of normalizeTranscript(parseMaybe(transcript)).words) {
    if (!w.speaker) continue
    const last = out[out.length - 1]
    if (last && last.speaker === w.speaker) out[out.length - 1] = { ...last, endMs: Math.max(last.endMs, w.endMs) }
    else out.push({ speaker: w.speaker, startMs: w.startMs, endMs: w.endMs })
  }
  return out
}

/** Mean square power per hop, streamed (a 3-hour source is 1.08 M floats). */
export class HopPower {
  private readonly hops: number[] = []
  private acc = 0
  private n = 0
  constructor(private readonly hopSamples: number) {}
  push(x: Float32Array): void {
    for (let i = 0; i < x.length; i++) {
      this.acc += x[i]! * x[i]!
      if (++this.n === this.hopSamples) { this.hops.push(this.acc / this.n); this.acc = 0; this.n = 0 }
    }
  }
  finish(): Float32Array {
    if (this.n > 0) { this.hops.push(this.acc / this.n); this.acc = 0; this.n = 0 }
    return Float32Array.from(this.hops)
  }
}

/**
 * A speaker's level on one source, in dBFS, over the parts of `turns` the
 * source covers; null when it covers none or is silent. A turn is moved onto
 * the source's clock (sourceMs = masterMs − offsetMs) and read as every hop it
 * touches (a sub-hop turn across a boundary reads both hops; a zero-length
 * turn reads the hop it falls inside, or none when it sits exactly on a hop
 * boundary). Each hop counts once, however many of the speaker's turns
 * overlap it.
 */
export function speakerLevelDb(power: Float32Array, turns: readonly SpeakerTurn[], offsetMs: number): number | null {
  const ranges = turns
    .map((t) => [Math.max(0, Math.floor((t.startMs - offsetMs) / SPEAKER_MAP_HOP_MS)), Math.min(power.length, Math.ceil((t.endMs - offsetMs) / SPEAKER_MAP_HOP_MS))] as const)
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0])
  let sum = 0, count = 0, from = 0
  for (const [a, b] of ranges) {
    for (let h = Math.max(a, from); h < b; h++) { sum += power[h]!; count++ }
    from = Math.max(from, b)
  }
  if (count === 0 || sum <= 0) return null
  return 10 * Math.log10(sum / count)
}

const round1 = (x: number) => Math.round(x * 10) / 10

/**
 * Per speaker: the loudest camera wins when it leads the next by `marginDb`;
 * otherwise "" (no camera of their own — the wide shot). The lead is rounded
 * to 0.1 dB before it is compared, and a lead that rounds to 0 is a tie: ""
 * even at `marginDb` 0, never whichever camera happened to be listed first. A
 * camera with no reading is no candidate; fewer than two candidates is no
 * comparison ("" — decided 2026-10-17). One camera may win several speakers.
 */
export function decideSpeakerMap(input: {
  readonly speakers: readonly string[]
  readonly levels: ReadonlyMap<string, ReadonlyMap<string, number | null>>
  readonly marginDb: number
}): SpeakerMapDecision {
  const speakerMap: Record<string, string> = {}
  const confidence: Record<string, { camera: string; marginDb: number | null }> = {}
  const notes: string[] = []
  for (const s of input.speakers) {
    const ranked = [...(input.levels.get(s) ?? new Map())].filter((e): e is [string, number] => typeof e[1] === "number").sort((x, y) => y[1] - x[1])
    if (ranked.length < 2) {
      speakerMap[s] = ""
      confidence[s] = { camera: "", marginDb: null }
      notes.push(`"${s}": fewer than two cameras heard them — shown on the wide shot; set the map to override.`)
      continue
    }
    const lead = round1(ranked[0]![1] - ranked[1]![1])
    const camera = lead > 0 && lead >= input.marginDb ? ranked[0]![0] : ""
    speakerMap[s] = camera
    confidence[s] = { camera, marginDb: lead }
    if (!camera) notes.push(`"${s}": no clear camera (the loudest led by ${lead} dB) — shown on the wide shot; set the map to override.`)
  }
  return { speakerMap, confidence, notes }
}

/**
 * The cameras that heard none of the speakers — every level on them null —
 * each named in a note: no candidate for anyone, never a failure. A camera
 * whose hops are all zero is silent (a track of digital silence); one with
 * sound heard none of the turns (silent through each of them, or its offset
 * misses them). A camera never read (no hops: no audio track, noted by
 * the caller) is not named here.
 */
export function unheardCameraNotes(
  hopsById: ReadonlyMap<string, Float32Array>,
  levels: ReadonlyMap<string, ReadonlyMap<string, number | null>>,
): string[] {
  const notes: string[] = []
  for (const [id, hops] of hopsById) {
    if ([...levels.values()].some((byCamera) => byCamera.get(id) != null)) continue
    notes.push(hops.some((p) => p > 0)
      ? `"${id}": heard none of the speakers' turns (silent through them, or its offset misses them), so it cannot be matched to a speaker by sound.`
      : `"${id}": its sound is silent, so it cannot be matched to a speaker by sound.`)
  }
  return notes
}
