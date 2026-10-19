/**
 * SPEAKER MAP — which camera each speaker is on, from the cameras' own
 * microphones (decided 2026-10-12/17). Core, keyless: each source is read
 * through its cached audio proxy (`ensureMediaProxy`, as Audio Sync and
 * Silence Detect read it), decoded to 8 kHz mono, reduced to 10 ms power hops;
 * each speaker's turns (on the master clock, moved by the source's measured
 * offset) are averaged per camera, and `decideSpeakerMap` decides. The wide
 * shot and the master are no one's camera (they hear everyone). A source with
 * no audio track, or a camera that heard none of the speakers (a silent
 * track, or one that misses every turn), is no candidate and is named in a
 * note — never a failure.
 */
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { mergeEdlSourceOffsets, transcriptSpeakerLabels, type Edl, type EdlSource } from "@nodaro/shared/edl"
import { wholeEpisodeEdl } from "@nodaro/render-rules"
import { cleanupWorkDir, createWorkDir, downloadFile, probeMediaDuration } from "../video/ffmpeg-utils.js"
import { ensureMediaProxy, MediaHasNoAudioError } from "../../services/media-proxy.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { PCM_SAMPLE_RATE, streamPcm } from "./pcm-stream.js"
import { HopPower, SPEAKER_MAP_HOP_MS, decideSpeakerMap, speakerLevelDb, speakerTurnsOf, unheardCameraNotes, type SpeakerMapDecision } from "./speaker-map-levels.js"
import { SPEAKER_MAP_DECODE_TIMEOUT_MS } from "./speaker-map-budget.js"

export interface SpeakerMapJobInput {
  readonly sources: ReadonlyArray<{ readonly id: string; readonly url: string; readonly kind?: "video" | "audio" }>
  readonly transcript: unknown
  /** Audio Sync's result (or its JSON); absent = every source at offset 0 (already in sync). */
  readonly offsets?: unknown
  readonly masterSourceId?: string
  readonly wideSourceId?: string
  /** How far the loudest camera must lead the next, dB (the caller passes the contract's default when none is set). */
  readonly marginDb: number
}

/** The decision plus the whole-recording edit; the worker adds the published contract's version. */
export type SpeakerMapComputed = SpeakerMapDecision & { readonly edl?: Edl }

/** Audio Sync's offsets by source id (`{ offsets: [{ sourceId, offsetMs }] }`), as measured against its own reference. */
function offsetsById(raw: unknown): Map<string, number> {
  const v = typeof raw === "string" ? (() => { try { return JSON.parse(raw) } catch { return undefined } })() : raw
  const rows = (v as { offsets?: unknown } | undefined)?.offsets
  const out = new Map<string, number>()
  if (Array.isArray(rows)) for (const r of rows) {
    const o = r as { sourceId?: unknown; offsetMs?: unknown }
    if (typeof o.sourceId === "string" && typeof o.offsetMs === "number" && Number.isFinite(o.offsetMs)) out.set(o.sourceId, o.offsetMs)
  }
  return out
}

/**
 * The measured offsets on the CLOCK source's clock (the transcript's, and the
 * edit's): the D19 anchored set (`mergeEdlSourceOffsets`), so Audio Sync's
 * reference may be any recording. The clock lands at 0 and every other source
 * at measured(s) − measured(clock); a camera is then read at
 * sourceMs = masterMs − offset. A source with no row stays at 0.
 */
function offsetsOnClock(measured: ReadonlyMap<string, number>, sources: readonly EdlSource[], clockId: string | undefined): Map<string, number> {
  if (measured.size === 0 || clockId === undefined) return new Map(measured)
  const merged = mergeEdlSourceOffsets({ version: 1, clock: "master", sources, segments: [] }, Object.fromEntries(measured), { anchor: clockId })
  const applied = new Set(merged.applied)
  return new Map(merged.edl.sources.flatMap((s) => (applied.has(s.id) && s.offsetMs !== undefined ? [[s.id, s.offsetMs] as const] : [])))
}

export async function computeSpeakerMap(input: SpeakerMapJobInput): Promise<SpeakerMapComputed> {
  const speakers = transcriptSpeakerLabels(input.transcript)
  if (speakers.length === 0) throw new DeterministicJobError("speaker-map: the transcript has no speaker labels — turn on speaker detection in Transcribe.")
  const turns = speakerTurnsOf(input.transcript)
  const candidates = new Set(input.sources.filter((s) => s.id !== input.masterSourceId && s.id !== input.wideSourceId && s.kind !== "audio").map((s) => s.id))
  const workDir = await createWorkDir("speaker-map-job") // never the bare type id outside the unit folder (G2)
  try {
    // I/O first: each source's length, and each candidate's power hops (100 a
    // second — a 3-hour camera is ~4 MB). A downloaded proxy is removed as
    // soon as it has been read.
    const durations = new Map<string, number>()
    const hopsById = new Map<string, Float32Array>()
    const silent: string[] = []
    for (const [i, s] of input.sources.entries()) {
      let proxy: Awaited<ReturnType<typeof ensureMediaProxy>>
      try {
        proxy = await ensureMediaProxy(s.url, "audio")
      } catch (err) {
        if (!(err instanceof MediaHasNoAudioError)) throw err
        if (candidates.has(s.id)) silent.push(s.id)
        continue
      }
      const path = join(workDir, `src-${i}.m4a`)
      try {
        await downloadFile(proxy.url, path)
        durations.set(s.id, Math.round((await probeMediaDuration(path)) * 1000))
        if (!candidates.has(s.id)) continue
        const power = new HopPower((PCM_SAMPLE_RATE * SPEAKER_MAP_HOP_MS) / 1000)
        await streamPcm(path, {}, SPEAKER_MAP_DECODE_TIMEOUT_MS, (x) => power.push(x), "speaker-map decode")
        hopsById.set(s.id, power.finish())
      } finally {
        await fs.rm(path, { force: true })
      }
    }
    // The recordings the edit keeps, and its clock (wholeEpisodeEdl's own pick:
    // the master, else the first kept recording) — the clock every offset is
    // rebased onto.
    const kept = input.sources.filter((s) => durations.has(s.id) || s.kind !== "audio")
    const clockId = (kept.find((s) => s.id === input.masterSourceId) ?? kept[0])?.id
    const offsets = offsetsOnClock(offsetsById(input.offsets), kept.map((s) => ({ id: s.id, url: s.url, kind: s.kind ?? "video" })), clockId)
    const levels = new Map(speakers.map((sp) => [sp, new Map<string, number | null>(
      [...hopsById].map(([id, hops]) => [id, speakerLevelDb(hops, turns.filter((t) => t.speaker === sp), offsets.get(id) ?? 0)]),
    )]))
    const decided = decideSpeakerMap({ speakers, levels, marginDb: input.marginDb })
    const notes = [
      ...decided.notes,
      ...silent.map((id) => `"${id}": has no audio track, so it cannot be matched to a speaker by sound.`),
      ...unheardCameraNotes(hopsById, levels),
    ]
    const byCamera = new Map<string, string[]>()
    for (const [sp, cam] of Object.entries(decided.speakerMap)) if (cam) byCamera.set(cam, [...(byCamera.get(cam) ?? []), sp])
    const whole = wholeEpisodeEdl({
      sources: kept.map((s) => ({ id: s.id, url: s.url, kind: s.kind ?? "video", durationMs: durations.get(s.id) ?? 0, offsetMs: offsets.get(s.id) ?? 0, speakers: byCamera.get(s.id) ?? [] })),
      ...(input.masterSourceId ? { masterSourceId: input.masterSourceId } : {}),
      ...(input.wideSourceId ? { wideSourceId: input.wideSourceId } : {}),
    })
    return { ...decided, notes, ...("edl" in whole ? { edl: whole.edl } : {}) }
  } finally {
    await cleanupWorkDir(workDir)
  }
}
