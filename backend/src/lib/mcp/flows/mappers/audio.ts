import { bool, defined, inputsOf, num, str, urls, type Body, type FlowMediaKind, type FlowOutputKey, type RouteMapper, type RouteMappers } from "./kit.js"

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv|avi)$/i

/** A route field that takes audio or video (Trim Audio's `videoUrl`): which one this URL is. */
function mediaKindOfUrl(url: string): FlowMediaKind {
  try {
    return VIDEO_EXTENSION.test(new URL(url).pathname) ? "video" : "audio"
  } catch {
    return "audio"
  }
}

/** A `{ audioUrl } | { videoUrl }` body: the one source and its kind (the verbs send one, a video winning). */
function audioOrVideoSource(body: Body): { url: string; kind: FlowMediaKind } | null {
  const video = str(body.videoUrl)
  if (video) return { url: video, kind: "video" }
  const audio = str(body.audioUrl)
  return audio ? { url: audio, kind: "audio" } : null
}

const outputKeyOf = (kind: FlowMediaKind): FlowOutputKey => (kind === "video" ? "generatedVideoUrl" : "generatedAudioUrl")

/**
 * Suno Create Music. The route runs a body without `customMode` as NOT custom,
 * while the node infers custom mode from a style, title or lyrics
 * (`getEffectiveSunoCustomMode`), so both flags are always written.
 */
const sunoGenerate: RouteMapper = {
  tools: ["suno_generate", "generate_music"],
  fields: new Set([
    "prompt", "model", "style", "title", "lyrics", "negativeStyle", "vocalGender",
    "customMode", "instrumental", "styleWeight", "weirdnessConstraint", "audioWeight", "duration",
  ]),
  map(body) {
    const prompt = str(body.prompt)
    const model = str(body.model)
    if (!prompt || !model) return null
    return {
      type: "suno-generate",
      outputKey: "generatedAudioUrl",
      prompt,
      inputs: [],
      data: defined({
        label: "Suno Create Music",
        prompt,
        model,
        style: str(body.style),
        title: str(body.title),
        lyrics: str(body.lyrics),
        negativeStyle: str(body.negativeStyle),
        vocalGender: str(body.vocalGender),
        customMode: bool(body.customMode) ?? false,
        instrumental: bool(body.instrumental) ?? false,
        styleWeight: num(body.styleWeight),
        weirdnessConstraint: num(body.weirdnessConstraint),
        audioWeight: num(body.audioWeight),
        duration: num(body.duration),
        fieldMappings: {},
      }),
    }
  },
}

/** Audio routes whose calls become nodes. */
export const AUDIO_ROUTE_MAPPERS: RouteMappers = {
  "/v1/text-to-speech": {
    tools: ["generate_speech"],
    fields: new Set([
      "text", "voice", "provider", "voiceType", "stability", "similarityBoost", "style", "speed",
      "languageCode", "previousText", "nextText",
    ]),
    map(body) {
      const text = str(body.text)
      const provider = str(body.provider)
      if (!text || !provider) return null
      const voice = str(body.voice)
      return {
        type: "text-to-speech",
        outputKey: "generatedAudioUrl",
        prompt: text,
        inputs: [],
        // The node speaks `directText` only when its text source is "direct".
        data: defined({
          label: "Text to Speech",
          provider,
          textSource: "direct",
          directText: text,
          voiceId: voice,
          voiceDisplayName: voice,
          // The route's own default for a body without one.
          voiceType: str(body.voiceType) ?? "premade",
          stability: num(body.stability),
          similarityBoost: num(body.similarityBoost),
          style: num(body.style),
          speed: num(body.speed),
          languageCode: str(body.languageCode),
          previousText: str(body.previousText),
          nextText: str(body.nextText),
          fieldMappings: {},
        }),
      }
    },
  },

  "/v1/text-to-dialogue": {
    tools: ["generate_dialogue"],
    fields: new Set(["dialogue", "provider", "stability", "similarityBoost", "languageCode", "seed", "applyTextNormalization"]),
    map(body) {
      const lines = Array.isArray(body.dialogue) ? (body.dialogue as unknown[]) : []
      const dialogue = lines.map((line, i) => {
        const record = (line ?? {}) as Record<string, unknown>
        const text = str(record.text)
        const voice = str(record.voice)
        return text && voice ? { id: `line-${i + 1}`, text, voice } : null
      })
      if (dialogue.length === 0 || dialogue.some((l) => l === null)) return null
      return {
        type: "text-to-dialogue",
        outputKey: "generatedAudioUrl",
        prompt: dialogue.map((l) => l!.text).join("\n"),
        inputs: [],
        data: defined({
          label: "Text to Dialogue",
          dialogue,
          provider: str(body.provider),
          stability: num(body.stability),
          similarityBoost: num(body.similarityBoost),
          languageCode: str(body.languageCode),
          seed: num(body.seed),
          applyTextNormalization: str(body.applyTextNormalization),
          fieldMappings: {},
        }),
      }
    },
  },

  "/v1/text-to-audio": {
    tools: ["text_to_audio"],
    fields: new Set(["prompt", "provider", "duration", "loop", "promptInfluence"]),
    map(body) {
      const prompt = str(body.prompt)
      if (!prompt) return null
      // No duration stays none: the route prices and runs it as 5 s, the node's default would ask for 10.
      return {
        type: "text-to-audio",
        outputKey: "generatedAudioUrl",
        prompt,
        inputs: [],
        data: defined({
          label: "Text to Audio",
          prompt,
          provider: str(body.provider),
          duration: num(body.duration),
          loop: bool(body.loop),
          promptInfluence: num(body.promptInfluence),
          fieldMappings: {},
        }),
      }
    },
  },

  "/v1/suno/generate": sunoGenerate,

  // MiniMax Music: generate_music's non-Suno lane. Its reference track is the node's `ref-audio` input.
  "/v1/generate-music": {
    tools: ["generate_music"],
    fields: new Set(["prompt", "provider", "duration", "instrumental", "lyrics", "genre", "mood", "referenceAudioUrl"]),
    map(body) {
      const prompt = str(body.prompt)
      const provider = str(body.provider)
      const reference = str(body.referenceAudioUrl)
      if (!prompt || !provider) return null
      return {
        type: "generate-music",
        outputKey: "generatedAudioUrl",
        prompt,
        inputs: reference ? inputsOf("audio", "ref-audio", [reference]) : [],
        data: defined({
          label: "Generate Music",
          prompt,
          provider,
          duration: num(body.duration),
          genre: str(body.genre),
          mood: str(body.mood),
          // Written either way: the node's default is instrumental, the route's is not.
          instrumental: bool(body.instrumental) ?? false,
          lyrics: str(body.lyrics),
          fieldMappings: {},
        }),
      }
    },
  },

  "/v1/voice-changer": {
    tools: ["voice_changer"],
    fields: new Set(["audioUrl", "videoUrl", "voiceId", "model", "stability", "similarityBoost", "style", "removeBackgroundNoise"]),
    map(body) {
      const source = audioOrVideoSource(body)
      const voiceId = str(body.voiceId)
      if (!source || !voiceId) return null
      // A wired video switches the node to video mode, its result the revoiced video.
      return {
        type: "voice-changer",
        outputKey: outputKeyOf(source.kind),
        inputs: inputsOf(source.kind, source.kind, [source.url]),
        data: defined({
          label: "Voice Changer",
          voiceId,
          voiceLabel: voiceId,
          model: str(body.model),
          stability: num(body.stability),
          similarityBoost: num(body.similarityBoost),
          style: num(body.style),
          removeBackgroundNoise: bool(body.removeBackgroundNoise),
          fieldMappings: {},
        }),
      }
    },
  },

  "/v1/voice-design": {
    tools: ["voice_design"],
    fields: new Set(["text", "voiceDescription", "model", "loudness", "guidanceScale", "seed", "quality", "shouldEnhance"]),
    map(body) {
      const text = str(body.text)
      const voiceDescription = str(body.voiceDescription)
      if (!text || !voiceDescription) return null
      return {
        type: "voice-design",
        outputKey: "generatedAudioUrl",
        prompt: voiceDescription,
        inputs: [],
        data: defined({
          label: "Voice Design",
          text,
          voiceDescription,
          model: str(body.model),
          loudness: num(body.loudness),
          guidanceScale: num(body.guidanceScale),
          seed: num(body.seed),
          quality: num(body.quality),
          shouldEnhance: bool(body.shouldEnhance),
          fieldMappings: {},
        }),
      }
    },
  },

  "/v1/audio-isolation": {
    tools: ["audio_isolation"],
    fields: new Set(["audioUrl"]),
    map(body) {
      const audioUrl = str(body.audioUrl)
      if (!audioUrl) return null
      return {
        type: "audio-isolation",
        outputKey: "generatedAudioUrl",
        inputs: inputsOf(mediaKindOfUrl(audioUrl), "audio", [audioUrl]),
        data: { label: "Voice Extractor", fieldMappings: {} },
      }
    },
  },

  // The route's `videoUrl` is the source either way: ffmpeg takes the audio of an audio file or a video.
  "/v1/trim-audio": {
    tools: ["trim_audio"],
    fields: new Set(["videoUrl", "audioFormat", "startTime", "endTime"]),
    map(body) {
      const source = str(body.videoUrl)
      if (!source) return null
      return {
        type: "trim-audio",
        outputKey: "generatedAudioUrl",
        inputs: inputsOf(mediaKindOfUrl(source), "in", [source]),
        data: defined({
          label: "Trim Audio",
          audioFormat: str(body.audioFormat) ?? "mp3",
          startTime: num(body.startTime),
          endTime: num(body.endTime),
          fieldMappings: {},
        }),
      }
    },
  },

  // A plain mix only: the node keys track volumes and the duck track by the
  // id of the node each track comes from, which a body of URLs cannot name.
  "/v1/mix-audio": {
    tools: ["mix_audio"],
    fields: new Set(["audioUrls"]),
    map(body) {
      const audioUrls = urls(body.audioUrls)
      // One edge per URL: a track given twice would be mixed once.
      if (audioUrls.length < 2 || new Set(audioUrls).size !== audioUrls.length) return null
      return {
        type: "mix-audio",
        outputKey: "generatedAudioUrl",
        inputs: audioUrls.map((url) => ({ url, kind: mediaKindOfUrl(url), targetHandle: "in" })),
        data: { label: "Mix Audio", trackCount: audioUrls.length, trackVolumes: {}, fieldMappings: {} },
      }
    },
  },

  "/v1/pitch-tempo": {
    tools: ["pitch_tempo"],
    fields: new Set(["audioUrl", "videoUrl", "semitones", "tempo", "preserveFormants"]),
    map(body) {
      const source = audioOrVideoSource(body)
      if (!source) return null
      // The route's defaults, written so the node shows what ran.
      return {
        type: "pitch-tempo",
        outputKey: outputKeyOf(source.kind),
        inputs: inputsOf(source.kind, "in", [source.url]),
        data: {
          label: "Pitch & Tempo",
          semitones: num(body.semitones) ?? 0,
          tempo: num(body.tempo) ?? 1,
          preserveFormants: bool(body.preserveFormants) ?? true,
          fieldMappings: {},
        },
      }
    },
  },
}
