/**
 * Replace Audio as a CLIENT of its route: the node's settings, the request
 * body both engines send (the editor's run and the server's workflow run, as a
 * sync-HTTP call), and the credit id the editor quotes. The run itself — every
 * step and value — is served by the Nodaro Cloud plugin at
 * `POST /v1/replace-audio`, which validates the body again, measures the media
 * and prices the run; nothing of it is here.
 */

/** The node type (its run route is `/v1/replace-audio`). */
export const REPLACE_AUDIO_NODE_TYPE = "replace-audio" as const

/** `keep-speech`: the speech stays and the music is replaced. `replace-all`: the new music replaces all the sound. */
export const REPLACE_AUDIO_MODES = ["keep-speech", "replace-all"] as const
export type ReplaceAudioMode = (typeof REPLACE_AUDIO_MODES)[number]

/** Where a node's music comes from: the music wired into it (or its own `musicUrl`), or a prompt the track is made from. */
export const REPLACE_AUDIO_MUSIC_SOURCES = ["input", "prompt"] as const
export type ReplaceAudioMusicSource = (typeof REPLACE_AUDIO_MUSIC_SOURCES)[number]

/** The mix levers, in percent: their bounds and defaults (what the route takes). */
export const REPLACE_AUDIO_LEVERS = {
  musicVolume: { min: 0, max: 200, default: 80 },
  speechVolume: { min: 0, max: 200, default: 100 },
  duckAmount: { min: 0, max: 100, default: 70 },
} as const
export type ReplaceAudioLever = keyof typeof REPLACE_AUDIO_LEVERS

/** The longest music prompt the route takes, in characters. */
export const REPLACE_AUDIO_MUSIC_PROMPT_MAX = 1000

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v)

export function replaceAudioMode(v: unknown): ReplaceAudioMode {
  return isOneOf(REPLACE_AUDIO_MODES, v) ? v : "keep-speech"
}

export function replaceAudioMusicSource(v: unknown): ReplaceAudioMusicSource {
  return isOneOf(REPLACE_AUDIO_MUSIC_SOURCES, v) ? v : "input"
}

/** A lever's value: a finite number clamped to its bounds, else its default. */
export function replaceAudioLever(name: ReplaceAudioLever, v: unknown): number {
  const lever = REPLACE_AUDIO_LEVERS[name]
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN
  if (!Number.isFinite(n)) return lever.default
  return Math.min(lever.max, Math.max(lever.min, n))
}

/** The credit id of a run in `mode`, and whether its music is made from a prompt. */
export function replaceAudioCreditId(mode: unknown, prompted: boolean): string {
  return `${REPLACE_AUDIO_NODE_TYPE}${replaceAudioMode(mode) === "replace-all" ? ":replace-all" : ""}${prompted ? ":prompt" : ""}`
}

/** Every credit id, in order. */
export const REPLACE_AUDIO_CREDIT_IDS: readonly string[] = REPLACE_AUDIO_MODES.flatMap((mode) => [replaceAudioCreditId(mode, false), replaceAudioCreditId(mode, true)])

/**
 * The credit id a node's settings quote (the Run button, the run estimates).
 * The route prices the run it measures: a keep-speech run on a video with no
 * sound is charged as replace-all.
 */
export function replaceAudioNodeCreditId(data: Readonly<Record<string, unknown>> | null | undefined): string {
  return replaceAudioCreditId(data?.mode, replaceAudioMusicSource(data?.musicSource) === "prompt")
}

/** The body of `POST /v1/replace-audio`. */
export interface ReplaceAudioBody {
  readonly videoUrl: string
  readonly musicUrl?: string
  readonly musicPrompt?: string
  readonly mode: ReplaceAudioMode
  readonly musicVolume: number
  readonly speechVolume: number
  readonly duckAmount: number
}

/** Why a node cannot be run (before anything is sent). */
export type ReplaceAudioNodeProblem =
  | { readonly code: "no-video" }
  | { readonly code: "no-music" }
  | { readonly code: "many-music"; readonly count: number }
  | { readonly code: "prompt-and-music" }
  | { readonly code: "no-prompt" }
  | { readonly code: "long-prompt"; readonly length: number }

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

/**
 * A node's request body, from its settings and what is wired into it, alike in
 * both engines: the video wired in (else the node's own `videoUrl`); the music
 * wired into its music input (exactly one), else its own `musicUrl`, when its
 * music source is `input` — or its prompt, when it is `prompt` (a music wired
 * in then is refused, never silently passed over).
 */
export function replaceAudioNodeBody(
  data: Readonly<Record<string, unknown>>,
  wired: { readonly videoUrl?: string; readonly musicUrls?: readonly string[] },
): { body: ReplaceAudioBody } | { problem: ReplaceAudioNodeProblem } {
  const videoUrl = text(wired.videoUrl) ?? text(data.videoUrl)
  if (!videoUrl) return { problem: { code: "no-video" } }
  const music = (wired.musicUrls ?? []).map(text).filter((u): u is string => u !== undefined)
  const levers = {
    mode: replaceAudioMode(data.mode),
    musicVolume: replaceAudioLever("musicVolume", data.musicVolume),
    speechVolume: replaceAudioLever("speechVolume", data.speechVolume),
    duckAmount: replaceAudioLever("duckAmount", data.duckAmount),
  }
  if (replaceAudioMusicSource(data.musicSource) === "prompt") {
    if (music.length > 0) return { problem: { code: "prompt-and-music" } }
    const musicPrompt = text(data.musicPrompt)
    if (!musicPrompt) return { problem: { code: "no-prompt" } }
    if (musicPrompt.length > REPLACE_AUDIO_MUSIC_PROMPT_MAX) return { problem: { code: "long-prompt", length: musicPrompt.length } }
    return { body: { videoUrl, musicPrompt, ...levers } }
  }
  if (music.length > 1) return { problem: { code: "many-music", count: music.length } }
  const musicUrl = music[0] ?? text(data.musicUrl)
  if (!musicUrl) return { problem: { code: "no-music" } }
  return { body: { videoUrl, musicUrl, ...levers } }
}

/** A problem as one English sentence (the server's refusal; the editor shows its own translated one). */
export function replaceAudioProblemText(problem: ReplaceAudioNodeProblem): string {
  switch (problem.code) {
    case "no-video":
      return "Connect a video."
    case "no-music":
      return "Connect the new music (an audio, or a video whose sound is used), or set the music to be made from a prompt."
    case "many-music":
      return `Connect one music source; ${problem.count} are connected.`
    case "prompt-and-music":
      return "The music is set to be made from a prompt, but a music source is connected: disconnect it, or set the music to the connected one."
    case "no-prompt":
      return "Write the music prompt, or connect the music."
    case "long-prompt":
      return `The music prompt is ${problem.length} characters; the longest is ${REPLACE_AUDIO_MUSIC_PROMPT_MAX}.`
  }
}
