import type { Voice, VoiceClone, VoiceFavorite, VoiceFavoriteInput, VoiceLibraryFacets, VoiceLibraryFacetsParams, VoiceLibraryParams, VoiceLibraryResponse } from "@nodaro/shared/pipeline"
import type { AudioFxPreset } from "@nodaro/shared/media"
import type { DialogueProvider } from "@nodaro/shared/models"
export type {
  Voice,
  SharedVoice,
  VoiceClone,
  VoiceFavorite,
  VoiceFavoriteInput,
  VoiceFavoriteType,
  VoiceLibraryDescriptive,
  VoiceLibraryFacetCount,
  VoiceLibraryFacets,
  VoiceLibraryFacetsParams,
  VoiceLibraryParams,
  VoiceLibraryResponse,
  VoiceLibraryUseCase,
} from "@nodaro/shared/pipeline"
export type { AudioFxPreset } from "@nodaro/shared/media"
import type { NodaroClientCore } from "../core.js"

/**
 * Re-export the shared voice types so SDK consumers don't have to add
 * `@nodaro/shared` as a second dependency just to type a `Voice` row, a
 * `VoiceClone`, or a `searchLibrary` call. Single source of truth lives in
 * `@nodaro/shared`.
 */
/** Audio-FX preset union (reverb spaces / telephone / megaphone / echo / custom) — used by {@link VoiceChangerProInput.voiceFx}. */

/** The listing's and the facets' querystring: every param set, `undefined` / `null` / `""` left out so the server defaults apply. */
function libraryQuery(params: VoiceLibraryParams | VoiceLibraryFacetsParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") query[k] = v as string | number | boolean
  }
  return query
}

/**
 * Read access to ElevenLabs voices: the premade catalog plus the shared
 * community Voice Library (both public GETs, no body), and the signed-in
 * user's own pre-retirement voice clones (list / delete).
 */
export class VoicesResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * List the premade ElevenLabs voices (`GET /v1/voices`). Falls back to a
   * curated set server-side when no ElevenLabs API key is configured.
   */
  async list(): Promise<Voice[]> {
    const res = await this.client.request<{ voices: Voice[] }>("GET", "/v1/voices")
    return res.voices
  }

  /**
   * Search the shared/community Voice Library (`GET /v1/voices/library`). All
   * params are optional and forwarded as a querystring; `undefined` / `null` /
   * empty-string values are omitted so the server defaults apply. `hasMore`
   * drives "load more" pagination.
   */
  searchLibrary(params: VoiceLibraryParams = {}): Promise<VoiceLibraryResponse> {
    return this.client.request("GET", "/v1/voices/library", { query: libraryQuery(params) })
  }

  /**
   * How many Voice Library voices each category (`use_cases`), tone
   * (`descriptives`), language, gender, age, accent and category has, for the
   * filters you hold (`GET /v1/voices/library/facets`) — one public call,
   * no credits, that fills a whole picker screen: counts on the categories,
   * tones with no voices hidden, "no Hebrew voices here" said before the
   * click. `total` applies every filter; each facet's counts apply every
   * filter except its own, so every category keeps its count while one is
   * chosen. Counted over the platform's copy of the library (`updatedAt`),
   * refreshed on a schedule; with `search`, a lower estimate (`approximate`).
   * Answers `503 voice_library_warming` for the few minutes after a
   * deployment first reads the library; retry after `Retry-After` seconds.
   */
  libraryFacets(params: VoiceLibraryFacetsParams = {}): Promise<VoiceLibraryFacets> {
    return this.client.request("GET", "/v1/voices/library/facets", { query: libraryQuery(params) })
  }

  /**
   * List the signed-in user's voice clones (`GET /v1/voice-clones`). The route
   * wraps the rows in `{ voiceClones }`; we unwrap to the bare array.
   */
  async listClones(): Promise<VoiceClone[]> {
    const res = await this.client.request<{ voiceClones: VoiceClone[] }>("GET", "/v1/voice-clones")
    return res.voiceClones
  }

  /**
   * @deprecated Voice cloning is no longer offered on Nodaro (retired
   * 2026-09-15). The route answers `410 voice_cloning_retired` and this call
   * rejects with that error. Clones created before the retirement are still
   * listed by {@link VoicesResource.listClones} and still work as voice ids.
   * For a new custom voice use {@link VoicesResource.design}.
   */
  createClone(input: { name: string; audioUrl: string }): Promise<VoiceClone> {
    return this.client.request<VoiceClone>("POST", "/v1/voice-clones/from-url", { body: input })
  }

  /** Delete one of the user's voice clones (`DELETE /v1/voice-clones/:id`). */
  async deleteClone(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/v1/voice-clones/${encodeURIComponent(id)}`)
  }

  /**
   * The signed-in user's favorite voices (`GET /v1/voices/favorites`), newest
   * first. Each carries the `voiceId` + `voiceType` a text-to-speech run takes
   * and the `name` / `previewUrl` snapshot it was starred with, so a favorites
   * list renders with no second lookup. OAuth apps need `assets:read`.
   */
  async listFavorites(): Promise<VoiceFavorite[]> {
    const res = await this.client.request<{ favorites: VoiceFavorite[] }>("GET", "/v1/voices/favorites")
    return res.favorites
  }

  /**
   * Star a voice (`PUT /v1/voices/favorites/:voiceId`) — a premade voice, a
   * Voice Library voice or one of the user's clones — with the snapshot to show
   * it by. Idempotent: starring it again refreshes the snapshot. OAuth apps need
   * `assets:write`. Answers `409 limit_reached` past the per-user cap.
   */
  async favorite(input: VoiceFavoriteInput): Promise<VoiceFavorite> {
    const { voiceId, ...body } = input
    const res = await this.client.request<{ favorite: VoiceFavorite }>("PUT", `/v1/voices/favorites/${encodeURIComponent(voiceId)}`, { body })
    return res.favorite
  }

  /** Unstar a voice (`DELETE /v1/voices/favorites/:voiceId`). Idempotent. */
  async unfavorite(voiceId: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/voices/favorites/${encodeURIComponent(voiceId)}`)
  }

  /**
   * Replace the voice in a recording — or in a whole talking video — with a
   * different voice (`POST /v1/voice-changer`). Pass `audioUrl` to revoice
   * audio→audio, or `videoUrl` to revoice an entire clip (the server demuxes
   * the audio, runs speech-to-speech, and remuxes onto the original video,
   * returning the video plus the new audio track). Exactly one of `audioUrl` /
   * `videoUrl` is required; when both are sent, video wins. `removeBackgroundNoise`
   * off keeps the music/SFX bed under the new voice; on yields a clean voice-only
   * result. Costs credits and runs async — poll `jobs.get(jobId)` for the result
   * (`output_data.videoUrl` + `output_data.audioUrl` in video mode).
   */
  change(input: {
    voiceId: string
    audioUrl?: string
    videoUrl?: string
    /** Speech-to-speech model id. Defaults to the server-configured default when omitted. */
    model?: string
    stability?: number
    similarityBoost?: number
    /** Style exaggeration (0–1). Default 0; >0 amplifies delivery at the cost of latency/stability. */
    style?: number
    /** ElevenLabs speaker boost — sharpens fidelity to the target speaker (small latency cost). */
    useSpeakerBoost?: boolean
    /** Deterministic speech-to-speech seed (integer 0–4294967295) for reproducible output. Omit for random. */
    seed?: number
    removeBackgroundNoise?: boolean
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-changer", { body: input })
  }

  /**
   * Recast each detected speaker in a multi-speaker recording to a different
   * voice (`POST /v1/voice-changer-pro`). `orderedVoices` maps speaker positions to
   * voices in detection order — speaker 0 → `orderedVoices[0]`, speaker 1 →
   * `orderedVoices[1]`, etc. Speakers beyond the end of `orderedVoices` keep
   * their original voice. Each entry is EITHER a bare voice id (premade name or
   * ElevenLabs UUID) OR a {@link VoiceChangerProVoice} object carrying per-voice
   * ElevenLabs speech-to-speech settings (stability / similarityBoost / style /
   * useSpeakerBoost / `seed`) plus a loudness `volumeMode` (and a manual
   * `volume`) — OR `null`, meaning keep this speaker's original voice (requires
   * a platform running cloud-plugins with keep-slot support). At least one
   * entry must be non-null. A per-voice `seed` makes that speaker's recast
   * reproducible.
   *
   * Pass `audioUrl` for audio-only recast or `videoUrl` to recast the audio
   * track of a video clip (the server demuxes, recasts, and remuxes).
   *
   * Voice and music are ALWAYS separated first — before recasting, the source
   * is split into an isolated vocal stem and a music/SFX stem.
   * `preserveBackground` (default `true`) only controls whether that
   * music/instrumental stem is mixed back under the new voices; set it `false`
   * for a clean voice-only result. `separationQuality` selects the quality of
   * the voice/music separation: `"fast"` (default, quicker — preserves more of
   * the voice) or `"best"` (finer voice/music separation).
   * `removeBackgroundNoise` additionally denoises the result.
   * `musicVolumeMode` sets the level of that preserved background (only relevant
   * when `preserveBackground` is on): `"match"` (default) keeps the original
   * level, `"normalize"` loudnorms it, `"manual"` uses `musicVolume`%.
   * `voiceFx` applies a reverb/echo to the COMBINED recast voices BEFORE the
   * background is mixed back in (effect sits on the voices, not the music bed).
   *
   * Cloud-only — costs credits and runs async; poll `jobs.get(jobId)` for the
   * result (`output_data.videoUrl` + `output_data.audioUrl` in video mode).
   */
  recast(input: VoiceChangerProInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-changer-pro", { body: input })
  }

  /**
   * Detect the speakers in a clip WITHOUT recasting yet
   * (`POST /v1/voice-changer-pro/analyze`) — the first step of the interactive
   * flow. Separates voice from music once and diarizes the vocals, returning the
   * speaker list so a user (or agent) can choose a voice per speaker before
   * committing to a paid recast. Poll `jobs.get(jobId)`: the completed job's
   * `output_data` carries the separated stem urls + the detected `speakers`
   * (each with `id`, time `segments`, `firstStartSec`, `wordCount`, `snippet`)
   * and the detected language — reshape it into a {@link VcpAnalysis} and pass it
   * as `recast({ ..., analysis })` to skip re-detection. With `suggestTitle`,
   * `output_data.suggestedTitle` also carries an LLM-proposed title.
   *
   * Cloud-only; costs credits and runs async.
   */
  analyze(input: VcpAnalyzeInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-changer-pro/analyze", { body: input })
  }

  /**
   * Render a final video from a mixed set of stems
   * (`POST /v1/voice-changer-pro/export`) — the last step of the interactive
   * flow. After `recast({ output: "stems" })` hands back the dry per-track stems
   * and the user has set levels / mutes / an effect in your editor, pass those
   * `tracks` (plus the source `videoUrl`) here to mix and remux into the finished
   * video. The video is stream-copied (never re-encoded), so the export is
   * bit-identical to your preview. At least one track must be un-muted (all-muted
   * is a 400); `voiceFx` is applied to the voice tracks at render time.
   *
   * Cloud-only; costs credits and runs async — poll `jobs.get(jobId)` for the
   * result (`output_data.videoUrl`).
   */
  exportMix(input: VcpExportInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-changer-pro/export", { body: input })
  }

  /**
   * Design a brand-new synthetic voice from a text description
   * (`POST /v1/voice-design`) — ElevenLabs text-to-voice. `text` (100–1000 chars)
   * is a preview line spoken in the designed voice; `voiceDescription` describes
   * the voice to create. Costs credits and runs async — poll `jobs.get(jobId)`
   * for the preview + the reusable voice id.
   */
  design(input: VoiceDesignInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-design", { body: input })
  }

  /**
   * Generate speech in a voice described in natural language, without cloning
   * (`POST /v1/voice-remix`). `text` (1–5000 chars) is spoken in a voice matching
   * `voiceDescription`. Costs credits and runs async — poll `jobs.get(jobId)`.
   */
  remix(input: VoiceRemixInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-remix", { body: input })
  }

  /**
   * Dub an audio clip into another language while preserving each speaker's voice
   * (`POST /v1/dubbing`). `targetLanguage` is an ISO code (e.g. `"es"`, `"fr"`);
   * `sourceLanguage` is auto-detected when omitted. Costs credits and runs async
   * — poll `jobs.get(jobId)`.
   */
  dub(input: DubbingInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/dubbing", { body: input })
  }

  /**
   * Voice a multi-speaker script as ONE audio file
   * (`POST /v1/text-to-dialogue`) on ElevenLabs Dialogue v3 — the default — or
   * Dialogue v4 (`provider: "elevenlabs-dialogue-v4"`). Each `dialogue` line is
   * `{ text, voice }` in speaking order — `voice` is a premade voice name or an
   * ElevenLabs voice UUID (cloned/library voices work too; mixed casts are
   * fine). At most 5,000 characters total across lines on Dialogue v3 and
   * 10,000 on Dialogue v4 (≤2,000 recommended for best quality) and 10 unique
   * voices. Line text may
   * carry `[audio tags]` like `[laughs]`. Costs credits and runs async — poll
   * `jobs.get(jobId)` for `output_data.audioUrl` and — on every dialogue model,
   * since both return timings at no extra credits — `output_data.transcript`, a
   * `Transcript` (`@nodaro/shared`): `words[]` with `startMs` / `endMs` /
   * `speaker` and one `segments[]` entry per line, `speaker` being the line's
   * `voice` as you sent it. Pass `transcript.words` to
   * `addCaptions({ captions, autoTranscribe: false })` to caption the dialogue
   * without a second transcription.
   */
  textToDialogue(input: {
    dialogue: Array<{ text: string; voice: string }>
    /** Dialogue model: `"elevenlabs-dialogue"` (v3, the default) or `"elevenlabs-dialogue-v4"`. */
    provider?: DialogueProvider
    /** v3: exactly 0, 0.5 or 1 (0 = most variable, 1 = most stable). v4: any value 0–1. */
    stability?: number
    /** v4 only (v3 ignores it): how closely each line keeps its voice's character, 0–1. */
    similarityBoost?: number
    /** ISO 639-1 language hint (e.g. "en"); auto-detected when omitted. */
    languageCode?: string
    /** Deterministic sampling seed (integer 0–4294967295). Omit for random. */
    seed?: number
    /** Spell out numbers/dates/abbreviations: "auto" (default) | "on" | "off". */
    applyTextNormalization?: "auto" | "on" | "off"
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/text-to-dialogue", { body: input })
  }

  /**
   * @deprecated Voice cloning is no longer offered on Nodaro (retired
   * 2026-09-15). The route answers `410 voice_cloning_retired` and this call
   * rejects with that error. See {@link VoicesResource.createClone}.
   */
  createCloneFromFile(input: {
    name: string
    file: Blob | Uint8Array | ArrayBuffer
    /** File name for the upload part (default `sample`). */
    filename?: string
    /** MIME type when `file` is a raw buffer (default `audio/mpeg`). */
    contentType?: string
  }): Promise<VoiceClone> {
    const form = new FormData()
    // Append the name field BEFORE the file so the route sees it in `fields`
    // (fastify-multipart's `req.file()` exposes fields parsed up to the file).
    form.append("name", input.name)
    const blob =
      input.file instanceof Blob
        ? input.file
        : new Blob([input.file as BlobPart], { type: input.contentType ?? "audio/mpeg" })
    form.append("file", blob, input.filename ?? "sample")
    return this.client.request<VoiceClone>("POST", "/v1/voice-clones", { body: form })
  }
}

/**
 * One entry in {@link VoiceChangerProInput.orderedVoices}. Either a bare voice id
 * (premade name like `"Rachel"` or an ElevenLabs UUID for a custom clone), or
 * an object pinning per-voice speech-to-speech settings and the recast's
 * loudness behaviour for that speaker.
 */
export type VoiceChangerProVoice =
  | string
  | {
      /** Target voice — premade name (`"Rachel"`, `"Aria"`, …) or an ElevenLabs UUID for a custom clone. */
      voiceId: string
      /**
       * Which lane converts this speaker. `"sts"` (default) is the classic
       * speech-to-speech recast; `"v3"` and `"v4"` are RE-SPEAK — the
       * performance is REGENERATED from the transcript (supports `[audio
       * tags]`; original delivery is replaced, and lips won't match on video).
       * A Re-speak speaker needs transcript text: pass an `analysis` whose
       * `segments[].text` carries it (analyze now emits this), or omit
       * `analysis` and the engine re-speaks from its own transcription. For
       * `"v3"` (eleven_v3), `stability` accepts exactly 0 / 0.5 / 1, and
       * `similarityBoost` / `style` / `useSpeakerBoost` are ignored. For
       * `"v4"` (eleven_v4), `stability` takes any value 0–1 and
       * `similarityBoost` is honoured (`style` / `useSpeakerBoost` ignored);
       * each line is generated with its neighbouring lines as context for
       * smoother joins. Both Re-speak engines are priced the same, per started
       * 1,000 characters.
       */
      engine?: "sts" | "v3" | "v4"
      /** ElevenLabs stability (0–1). Higher = steadier, lower = more expressive. */
      stability?: number
      /** ElevenLabs similarity boost (0–1) — how closely the output hugs the target voice's timbre. */
      similarityBoost?: number
      /** Style exaggeration (0–1). Default 0; >0 amplifies delivery at the cost of latency / stability. */
      style?: number
      /** ElevenLabs speaker boost — sharpens fidelity to the target speaker. */
      useSpeakerBoost?: boolean
      /**
       * Deterministic speech-to-speech seed (integer 0–4294967295) for
       * reproducible per-voice output — the same source + settings + seed
       * recast this speaker identically across runs. Omit for a random seed.
       */
      seed?: number
      /**
       * Loudness handling for this recast voice. `"match"` (default) matches the
       * original speaker's loudness; `"normalize"` applies loudness
       * normalization; `"manual"` uses `volume` as a percentage.
       */
      volumeMode?: "match" | "normalize" | "manual"
      /** Manual output volume as a percentage (0–200). Consulted only when `volumeMode === "manual"`. */
      volume?: number
    }

/** Input for {@link VoicesResource.recast}. */
export interface VoiceChangerProInput {
  /** URL of an audio file to recast (audio → audio). Exactly one of `audioUrl` / `videoUrl` is required. */
  audioUrl?: string
  /** URL of a video file to recast (the audio track is recast and remuxed). Exactly one of `audioUrl` / `videoUrl` is required. */
  videoUrl?: string
  /**
   * Voices in speaker-detection order. Speaker N is mapped to `orderedVoices[N]`;
   * speakers beyond the array keep their original voice. Each entry is a bare
   * voice id OR a {@link VoiceChangerProVoice} object with per-voice settings —
   * OR `null`, meaning keep this speaker's original voice (requires a platform
   * running cloud-plugins with keep-slot support). At least one entry must be
   * non-null.
   */
  orderedVoices: Array<VoiceChangerProVoice | null>
  /** Model to use for speech-to-speech. Defaults to the server-configured default when omitted. */
  model?: string
  /**
   * Mix the separated music / SFX stem back under the recast voices. Default
   * `true`. The voice is ALWAYS split out before recasting regardless of this
   * flag — `false` simply drops the music for a clean voice-only result.
   */
  preserveBackground?: boolean
  /**
   * Quality of the voice/music separation. `"fast"` (default, quicker —
   * preserves more of the voice) or `"best"` (finer voice/music separation).
   */
  separationQuality?: "fast" | "best"
  /** Strip background noise for a clean voice-only result. */
  removeBackgroundNoise?: boolean
  /**
   * Level of the preserved background music / SFX stem in the final mix. Only
   * relevant when `preserveBackground` is on (otherwise there is no background to
   * level). `"match"` (default) leaves the separated instrumental at its original
   * level; `"normalize"` applies loudness normalization; `"manual"` sets its
   * level to `musicVolume`%.
   */
  musicVolumeMode?: "match" | "normalize" | "manual"
  /** Background music level as a percentage (0–200). Consulted only when `musicVolumeMode === "manual"`. */
  musicVolume?: number
  /**
   * Node-level reverb/echo applied to the COMBINED recast voices **before** the
   * background is mixed back in (so the effect sits on the voices only, not the
   * music/SFX bed). Reverb presets (`room`, `hall`, `church`, …) use
   * `wetDryMix`; the `echo` / `custom` presets use `delayMs` + `decay`. Omit for
   * no effect.
   */
  voiceFx?: {
    /** Effect preset — reverb space, `telephone`, `megaphone`, `echo`, or `custom`. */
    preset: AudioFxPreset
    /** Reverb wet/dry mix as a percentage (0–100). Higher = wetter (more reverb). */
    wetDryMix?: number
    /** Echo delay in milliseconds (20–2000). Used by the `echo` / `custom` presets. */
    delayMs?: number
    /** Echo decay / feedback (0–1). Higher = more repeats. Used by the `echo` / `custom` presets. */
    decay?: number
  }
  /**
   * Output mode. `"video"` (default) mixes the recast voices with the preserved
   * background and returns a finished merged video. `"stems"` returns the dry,
   * unleveled per-track stems instead (rendering nothing) so you can drive an
   * INTERACTIVE mix — adjust levels/mutes/effect in your own UI, then render the
   * final video with {@link VoicesResource.exportMix}. This is how an app builds
   * a full editor around VCP rather than a one-shot recast.
   */
  output?: "video" | "stems"
  /**
   * A prior {@link VoicesResource.analyze} result. Pass it to SKIP re-detection:
   * the recast reuses the already-separated stems and speaker segments instead of
   * running separation + diarization again. This is the fast-path for the
   * detect → pick voices → recast interactive flow (analyze once, recast N times
   * as the user tweaks voice assignments). Omit to auto-detect from the source.
   */
  analysis?: VcpAnalysis
}

/** One detected speaker in a {@link VcpAnalysis} (from `analyze`). */
export interface VcpAnalysisSpeaker {
  /** Stable speaker id (first-appearance order). */
  id: string
  /** The speaker's spoken time ranges (seconds). `text` is what was said in
   *  the range — the paid input for a Re-speak speaker (`engine: "v3"` or
   *  `"v4"`; editable before conversion); the STS lane ignores it. */
  segments: Array<{ start: number; end: number; text?: string }>
  /** When the speaker first speaks (seconds). */
  firstStartSec?: number
  /** Rough word count across the clip — a proxy for how much this speaker says. */
  wordCount?: number
  /** The first few transcribed words, to help a user tell speakers apart. */
  snippet?: string
}

/**
 * The result of {@link VoicesResource.analyze}, reshaped to pass back into
 * {@link VoiceChangerProInput.analysis}. Read a completed analyze job's
 * `output_data` into this shape (it carries the separated stem urls + the
 * detected speakers) and thread it into `recast` to skip re-detection.
 */
export interface VcpAnalysis {
  /** URL of the isolated vocal stem. */
  vocalsUrl: string
  /** URL of the separated music/SFX stem (absent when the source had none). */
  backgroundUrl?: string
  /** The detected speakers, in first-appearance order. */
  speakers: VcpAnalysisSpeaker[]
  /** Scribe's detected language code, round-tripped so the recast auto-selects the STS model. */
  languageCode?: string
  /** Confidence (0–1) of {@link VcpAnalysis.languageCode}. */
  languageProbability?: number
}

/** Input for {@link VoicesResource.analyze}. */
export interface VcpAnalyzeInput {
  /** URL of an audio file to analyze. Exactly one of `audioUrl` / `videoUrl` is required. */
  audioUrl?: string
  /** URL of a video file to analyze (its audio track is used). Exactly one of `audioUrl` / `videoUrl` is required. */
  videoUrl?: string
  /** Quality of the voice/music separation run before diarization: `"fast"` (default) or `"best"`. */
  separationQuality?: "fast" | "best"
  /** Also suggest a conversion title from the transcript (returned on the job's `output_data.suggestedTitle`). */
  suggestTitle?: boolean
}

/** One track in a {@link VcpExportInput} mix. */
export interface VcpExportTrack {
  /** URL of the stem for this lane (a recast voice stem or the background stem). */
  url: string
  /** Fader position as a percentage: 0 = silent, 100 = unity, 200 = +6dB. */
  gain: number
  /** Whether this lane is muted in the mix. */
  muted: boolean
  /**
   * Which bucket the track is in, and so whether `voiceFx` lands on it. Defaults
   * to `"voice"`. Set `"background"` for the music/SFX lane (the effect never
   * touches it).
   */
  kind?: "voice" | "background"
}

/** Input for {@link VoicesResource.exportMix}. */
export interface VcpExportInput {
  /** The source video to remux the mixed audio onto (stream-copied — never re-encoded). */
  videoUrl: string
  /** The mix: one entry per lane. At least one must be un-muted (all-muted is a 400). Max 16 tracks. */
  tracks: VcpExportTrack[]
  /**
   * A reverb/echo applied to the VOICE tracks only (not `"background"` lanes)
   * at render time — so iterating the effect in your editor is free until you
   * export. Same shape as {@link VoiceChangerProInput.voiceFx}.
   */
  voiceFx?: VoiceChangerProInput["voiceFx"]
}

/** Input for {@link VoicesResource.design}. */
export interface VoiceDesignInput {
  /** A preview line (100–1000 chars) spoken in the designed voice. */
  text: string
  /** Natural-language description of the voice to create. */
  voiceDescription: string
  /** Voice-design model id. Defaults to the server-configured default. */
  model?: string
  /** Output loudness (-1..1). */
  loudness?: number
  /** How strongly the description steers the design (0–100). */
  guidanceScale?: number
  /** Deterministic seed for a reproducible design. */
  seed?: number
  /** Design quality knob (provider-specific). */
  quality?: number
  /** Enhance the generated voice. */
  shouldEnhance?: boolean
  /** Optional extra prompt context (≤8000 chars). */
  userPrompt?: string
}

/** Input for {@link VoicesResource.remix}. */
export interface VoiceRemixInput {
  /** The text (1–5000 chars) to speak in the described voice. */
  text: string
  /** Natural-language description of the voice to speak in. */
  voiceDescription: string
  /** Optional extra prompt context (≤8000 chars). */
  userPrompt?: string
}

/** Input for {@link VoicesResource.dub}. Provide exactly ONE source:
 *  `audioUrl` (dubbed audio out), `videoUrl` (the dubbed VIDEO out, plus the
 *  dubbed audio track as `output_data.audioUrl`), or `sourceUrl` (a link to
 *  a video's page, or a direct link to a file, that the dubbing service
 *  fetches itself). Priced per minute of the dubbed span; the span is capped
 *  at 30 minutes — use `startTime`/`endTime` to dub part of a longer source. */
export interface DubbingInput {
  /** URL of the audio to dub (audio mode). */
  audioUrl?: string
  /** URL of the video to dub — the result is the dubbed VIDEO (+ audio track). */
  videoUrl?: string
  /**
   * A link to a video's page, or a direct link to a file, that the dubbing
   * service fetches itself: an import of that link, made under the content
   * rights declaration (see `confirmationId`).
   */
  sourceUrl?: string
  /**
   * The content rights confirmation for `sourceUrl` (`contentRights.confirm()`).
   * Without one, a deployment that requires a confirmation refuses the dub with
   * `403`, unless the request comes through a key or an agent whose account
   * holds a standing authorization.
   */
  confirmationId?: string
  /** Target language ISO code (2–10 chars), e.g. `"es"`, `"pt-BR"`. */
  targetLanguage: string
  /** Source language ISO code; auto-detected when omitted. */
  sourceLanguage?: string
  /** Expected number of speakers (1–20; 0 = auto-detect) — improves separation when known. */
  numSpeakers?: number
  /** Keep the original voices instead of cloning them into the target language. */
  disableVoiceCloning?: boolean
  /** Drop the background/music bed from the dubbed output. */
  dropBackgroundAudio?: boolean
  /** Dub only this window of the source (seconds). */
  startTime?: number
  endTime?: number
  /** Keep the source resolution on video dubs (slower render). */
  highestResolution?: boolean
  useProfanityFilter?: boolean
  /** Experimental: steer dubbed voices toward an accent. */
  targetAccent?: string
  /** Apply ElevenLabs' own watermark to video dubs. */
  watermark?: boolean
}
