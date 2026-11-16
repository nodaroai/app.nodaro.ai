/**
 * Sound: music composed for this video, laid under the voice on the beat.
 *
 * The music is composed while the other agents work (it takes about a minute),
 * shown being made in the media bin, its beat found in the browser, then
 * dragged to its own track, started so a beat lands on the first spoken word,
 * lowered under the voice and faded out at the end.
 *
 * Its track is one that cuts leave alone (a cut through music would be heard),
 * so after any cut the music is fitted to the new length instead
 * (`refitMusic`). The panel finds its own music by name, so this works on a
 * project it has never seen.
 */
import { sunoGenerateApi } from "@/lib/api"
import { findBeat, startOnBeat, type BeatGrid } from "../beat"
import { timelineFrameOf, timelineSeconds, type TimedWord } from "../edit-plan"
import type { RunContext } from "./context"
import { JobFailed, checkStop, pause } from "./jobs"
import type { HeardVideo } from "./types"

const MUSIC_TIMEOUT_MS = 6 * 60_000
/** About how long the music takes to compose: the progress shown while it does. */
const COMPOSE_MS = 45_000
export const MUSIC_VOLUME_DB = -16
/** Where nobody speaks (before the first word, a long silence, after the last), the music comes up. */
const OPEN_VOLUME_DB = -8
const DUCK_GAP_SECONDS = 1.2
const DUCK_RAMP_SECONDS = 0.35
const MAX_DUCK_KEYFRAMES = 80
const FADE_OUT_SECONDS = 1.5
const MUSIC_NAME = /^ai-music/i

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
}

const fileNameOfUrl = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
  } catch {
    return ""
  }
}

/** The audio container the first bytes name, or null. */
function sniffAudio(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => (bytes.length >= to ? String.fromCharCode(...bytes.subarray(from, to)) : "")
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav"
  if (ascii(0, 3) === "ID3") return "mp3"
  if (ascii(0, 4) === "OggS") return "ogg"
  if (ascii(0, 4) === "fLaC") return "flac"
  if (ascii(4, 8) === "ftyp") return "m4a"
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm"
  // A frame sync: layer bits 00 are AAC in ADTS, anything else an MPEG audio layer.
  if (bytes[0] === 0xff && bytes.length > 1 && (bytes[1]! & 0xe0) === 0xe0) return (bytes[1]! & 0x06) === 0 ? "aac" : "mp3"
  return null
}

/**
 * The name and type the music is imported under, as its bytes are. The bytes
 * decide first: a Suno track's address says ".wav" and its response says
 * audio/wav while the file is an MP3. Then the address, then the response's type.
 */
export function musicFileOf(buffer: ArrayBuffer, url: string, contentType: string | null): { readonly name: string; readonly type: string } {
  const sniffed = sniffAudio(new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength)))
  const ext = sniffed ?? /\.([a-z0-9]{2,5})$/i.exec(fileNameOfUrl(url))?.[1]?.toLowerCase()
  if (ext && AUDIO_TYPES[ext]) return { name: `ai-music.${ext}`, type: AUDIO_TYPES[ext] }
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (/^audio\/(x-)?wave?$/.test(type)) return { name: "ai-music.wav", type: "audio/wav" }
  const known = Object.entries(AUDIO_TYPES).find(([, t]) => t === type)
  return known ? { name: `ai-music.${known[0]}`, type: known[1] } : { name: "ai-music.mp3", type: "audio/mpeg" }
}

/** The first audio address a finished music job gives (Suno tracks are re-hosted on our storage). */
export function trackUrlOf(output: Record<string, unknown>): string | null {
  const direct = [output.audioUrl, output.url, output.generatedAudioUrl].find((v) => typeof v === "string" && v.length > 0)
  if (typeof direct === "string") return direct
  const urls = output.audioUrls
  if (Array.isArray(urls)) return urls.find((u): u is string => typeof u === "string" && u.length > 0) ?? null
  return null
}

/** Starts composing: the job runs while the other agents work. */
export function composeMusic(ctx: RunContext, style: string): Promise<Record<string, unknown>> {
  return ctx.jobs.run(() => sunoGenerateApi({ prompt: style, instrumental: true, customMode: false, userId: ctx.userId }), MUSIC_TIMEOUT_MS)
}

/** The panel's own music on the timeline, found by name. */
export function panelMusic(ctx: RunContext) {
  const named = new Set((ctx.timeline.media ?? []).filter((m) => m.fileName && MUSIC_NAME.test(m.fileName)).map((m) => m.id))
  return ctx.timeline.items.filter((i) => i.type === "audio" && ((i.mediaId && named.has(i.mediaId)) || (i.label !== undefined && MUSIC_NAME.test(i.label))))
}

async function beatOf(buffer: ArrayBuffer): Promise<BeatGrid | null> {
  try {
    const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    if (!Ctx) return null
    // A short context only decodes: its length does not limit the decoded buffer.
    const audio = new Ctx(1, 44100, 44100)
    const decoded = await audio.decodeAudioData(buffer.slice(0))
    return findBeat(decoded.getChannelData(0), decoded.sampleRate)
  } catch {
    return null
  }
}

export interface MusicOutcome {
  readonly placed: boolean
  readonly bpm: number | null
  readonly refused?: string
}

/** The music, once composed, laid under the voice. */
export async function placeMusic(ctx: RunContext, composing: Promise<Record<string, unknown>>, heard: HeardVideo | undefined): Promise<MusicOutcome> {
  ctx.working("sound", true)
  // Composing, shown in the media bin while the job runs.
  const started = Date.now()
  const state = { settled: false }
  composing.then(
    () => (state.settled = true),
    () => (state.settled = true),
  )
  while (!state.settled) {
    const progress = Math.min(0.95, (Date.now() - started) / COMPOSE_MS)
    ctx.show.progress("sound", "panel.media", progress, ctx.say("freecutAi.note.composing", { p: Math.round(progress * 100) }))
    ctx.step("music", "working", "freecutAi.composing", undefined, progress * 0.8)
    // Real time, whatever the show's pace: this waits on a job, not on the show.
    await Promise.race([composing.catch(() => undefined), pause(1000, ctx.signal)])
    checkStop(ctx.signal)
  }
  let composed: Record<string, unknown>
  try {
    composed = await composing
  } catch (error) {
    ctx.working("sound", false)
    throw error
  }
  const url = trackUrlOf(composed)
  if (!url) throw new JobFailed("no track")
  const response = await fetch(url, { signal: ctx.signal })
  if (!response.ok) throw new JobFailed(`download ${response.status}`)
  const buffer = await response.arrayBuffer()
  checkStop(ctx.signal)
  const file = musicFileOf(buffer, url, response.headers.get("content-type"))

  ctx.show.at("sound", { target: "panel.media" }, { note: ctx.say("freecutAi.note.beat") })
  const grid = await beatOf(buffer)
  // The first spoken word, where it sits on the edit now.
  const firstWord = heard?.words[0]
  const firstAt = firstWord ? timelineFrameOf(ctx.timeline, ctx.mediaId, firstWord.start) : null
  const startAt = grid && firstAt ? startOnBeat(grid, firstAt.frame / ctx.fps) : 0
  if (grid) ctx.feed("sound", "freecutAi.foundBeat", { bpm: Math.round(grid.bpm) })

  const ref = `ai-music-${Date.now().toString(36)}`
  ctx.link.importFile(ref, file.name, file.type, buffer)
  const earlier = panelMusic(ctx).map((i) => i.id)
  const audioTrack = ctx.timeline.tracks?.find((t) => t.kind === "audio")?.id
  await ctx.show.drag("sound", { target: "panel.media" }, audioTrack ? { frame: 0, trackId: audioTrack } : "timeline.ruler", file.name, 900)
  // On an audio track that cuts leave alone: the editor takes one with room (the
  // earlier music's, once it is removed in the same edit), else makes one under the others.
  const applied = await ctx.apply("music", [
    ...(earlier.length > 0 ? [{ op: "removeItems", ids: earlier }] : []),
    {
      op: "placeMedia",
      ref,
      from: 0,
      durationInFrames: ctx.timeline.durationInFrames,
      syncLock: false,
      volumeDb: MUSIC_VOLUME_DB,
      fadeOutSeconds: FADE_OUT_SECONDS,
      ...(startAt > 0 ? { sourceStartSeconds: Math.round(startAt * 1000) / 1000 } : {}),
    },
  ])
  if (!applied.ok) {
    ctx.working("sound", false)
    return { placed: false, bpm: grid?.bpm ?? null, refused: applied.reason }
  }
  const id = (applied.result.results?.find((r) => r && typeof r === "object" && "id" in r) as { id?: unknown } | undefined)?.id
  if (typeof id === "string") {
    ctx.show.at("sound", { item: id })
    await ctx.show.wait(300)
    // Pulled down under the voice, in the properties, and up again where nobody speaks.
    // The properties panel is always on screen; its gain control only while a sound clip is selected.
    await ctx.show.slide("sound", "panel.properties", 0.75, 0.42, 800, ctx.say("freecutAi.note.volume", { db: MUSIC_VOLUME_DB }))
    if (heard && heard.words.length > 0) await ctx.apply("music", duckOps(ctx, id, 0, heard.words))
    const firstAtNow = firstWord ? timelineFrameOf(ctx.timeline, ctx.mediaId, firstWord.start) : null
    await ctx.preview(Math.max(0, (firstAtNow?.frame ?? 0) - Math.round(ctx.fps * 1.5)), 2200)
  }
  ctx.feed("sound", earlier.length > 0 ? "freecutAi.musicReplaced" : "freecutAi.musicDone")
  ctx.working("sound", false)
  return { placed: true, bpm: grid?.bpm ?? null }
}

/**
 * The music under the voice: lowered while someone speaks, up where nobody
 * does (keyframes on its volume, from where the words are on the edit now).
 */
export function duckOps(ctx: RunContext, itemId: string, itemFrom: number, words: readonly TimedWord[]): Array<Record<string, unknown>> {
  const fps = ctx.fps
  const spans: Array<{ from: number; to: number }> = []
  for (const word of words) {
    const at = timelineFrameOf(ctx.timeline, ctx.mediaId, word.start)
    const end = timelineFrameOf(ctx.timeline, ctx.mediaId, Math.max(word.start, word.end - 0.01))
    if (!at) continue
    const span = { from: at.frame, to: Math.max(at.frame + 1, end?.frame ?? at.frame + 1) }
    const last = spans.at(-1)
    if (last && span.from - last.to < DUCK_GAP_SECONDS * fps) last.to = Math.max(last.to, span.to)
    else spans.push(span)
  }
  const ramp = Math.round(DUCK_RAMP_SECONDS * fps)
  const key = (frame: number, value: number) => ({ op: "addKeyframe", itemId, property: "volume", frame: Math.max(0, frame - itemFrom), value, easing: "ease-in-out" })
  const ops: Array<Record<string, unknown>> = [key(0, OPEN_VOLUME_DB)]
  for (const span of spans) {
    if (ops.length + 4 > MAX_DUCK_KEYFRAMES) break
    ops.push(key(Math.max(0, span.from - ramp), OPEN_VOLUME_DB), key(span.from, MUSIC_VOLUME_DB), key(span.to, MUSIC_VOLUME_DB), key(span.to + ramp, OPEN_VOLUME_DB))
  }
  return ops
}

/** After cuts: the music ends where the edit now ends, faded out again. */
export async function refitMusic(ctx: RunContext, words?: readonly TimedWord[]): Promise<void> {
  const music = panelMusic(ctx)
  if (music.length === 0) return
  const end = ctx.timeline.durationInFrames
  // Fitted to the new length, and ducked again where the words are now.
  const ops = music
    .filter((i) => i.from < end)
    .flatMap((i) => [
      { op: "fitItem", id: i.id, durationInFrames: end - i.from, fadeOutSeconds: FADE_OUT_SECONDS },
      ...(words && words.length > 0 ? [{ op: "removeKeyframes", itemId: i.id, property: "volume" }, ...duckOps(ctx, i.id, i.from, words)] : []),
    ])
  if (ops.length > 0) await ctx.apply("music", ops)
}

/** How long the edit runs now, in seconds. */
export const editSeconds = (ctx: RunContext) => timelineSeconds(ctx.timeline)
