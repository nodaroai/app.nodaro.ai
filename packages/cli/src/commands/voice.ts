import { Command } from "commander"
import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, info, warn, table, type OutputOpts } from "../output.js"
import { reportQueuedJob } from "../util.js"
import type { VcpAnalysis, VcpExportInput, VcpExportTrack, VoiceChangerProInput } from "@nodaro/sdk"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface WatchOpts extends GlobalOpts {
  watch?: boolean
  pollInterval: number
}

const FX_PRESETS = "room|bathroom|car|hall|concert-hall|church|cave|arena|outdoor|telephone|megaphone|echo|custom"

/** MIME by extension for `voice clones create --file` uploads. */
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
}

interface VoiceFxFlags {
  voiceFx?: string
  voiceFxMix?: number
  voiceFxDelay?: number
  voiceFxDecay?: number
}

/**
 * Validate + build the `voiceFx` payload from the shared flag set. Exits with
 * the standard warning when tuning flags are passed without a preset.
 */
function buildVoiceFx(opts: VoiceFxFlags): VoiceChangerProInput["voiceFx"] {
  if ((opts.voiceFxMix !== undefined || opts.voiceFxDelay !== undefined || opts.voiceFxDecay !== undefined) && !opts.voiceFx) {
    warn("--voice-fx-mix / --voice-fx-delay / --voice-fx-decay require --voice-fx <preset>")
    process.exit(1)
  }
  return opts.voiceFx
    ? {
        preset: opts.voiceFx as NonNullable<VoiceChangerProInput["voiceFx"]>["preset"],
        ...(opts.voiceFxMix !== undefined ? { wetDryMix: opts.voiceFxMix } : {}),
        ...(opts.voiceFxDelay !== undefined ? { delayMs: opts.voiceFxDelay } : {}),
        ...(opts.voiceFxDecay !== undefined ? { decay: opts.voiceFxDecay } : {}),
      }
    : undefined
}

/**
 * Read a JSON value passed either inline (`--<base>-json <json>`) or as a file
 * (`--<base>-file <path>`). Exits on both-given or unparseable input; returns
 * `undefined` when neither flag was passed.
 */
function readJsonFlag(inline: string | undefined, file: string | undefined, flagBase: string): unknown {
  if (inline && file) {
    warn(`--${flagBase}-json and --${flagBase}-file are mutually exclusive — pass one`)
    process.exit(1)
  }
  const raw = file ? readFileSync(file, "utf8") : inline
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    warn(`--${flagBase}-${file ? "file" : "json"} is not valid JSON`)
    process.exit(1)
  }
}

/** The completed analyze job's `output_data` (loose — fields are best-effort). */
interface AnalyzeOutput {
  speakers?: Array<{ id?: string; firstStartSec?: number; wordCount?: number; snippet?: string }>
  languageCode?: string
  languageProbability?: number
  suggestedTitle?: string
  vocalsUrl?: string
  backgroundUrl?: string
}

/** Human rendering of a completed analyze job: speaker table + stems + chain hints. */
function renderAnalyzeOutput(outputData: unknown): void {
  const out = (outputData ?? {}) as AnalyzeOutput
  if (out.suggestedTitle) info(`title: ${out.suggestedTitle}`)
  if (out.languageCode) {
    const p = out.languageProbability !== undefined ? ` (confidence ${out.languageProbability.toFixed(2)})` : ""
    info(`language: ${out.languageCode}${p}`)
  }
  const speakers = Array.isArray(out.speakers) ? out.speakers : []
  table(
    speakers.map((s, i) => ({
      "#": i + 1,
      id: s.id,
      "first heard": s.firstStartSec !== undefined ? `${s.firstStartSec.toFixed(1)}s` : "",
      words: s.wordCount,
      snippet: s.snippet,
    })),
    ["#", "id", "first heard", "words", "snippet"],
  )
  if (out.vocalsUrl) dim(`vocals stem:     ${out.vocalsUrl}`)
  if (out.backgroundUrl) dim(`background stem: ${out.backgroundUrl}`)
  dim("next: nodaro voice recast --voices <v1,v2,...> maps entry N to speaker #N (`keep` keeps a speaker's original voice).")
  dim("      save this job's output_data as a JSON file and pass --analysis-file <path> to skip re-detection.")
}

export function voiceCommand(): Command {
  const cmd = new Command("voice").description("voice tools — revoice an audio track or a whole talking video")

  cmd
    .command("changer")
    .alias("change")
    .description("replace the voice in an audio track (--audio) or a talking video (--video) with a different voice")
    .requiredOption("--voice <id>", "target voice — premade name (Rachel, Aria, Roger, ...) or an ElevenLabs clone UUID")
    .option("--audio <url>", "audio URL to revoice (audio → audio)")
    .option("--video <url>", "video URL to revoice (returns the video + the new audio track). Wins over --audio when both are given.")
    .option("--model <id>", "speech-to-speech model override")
    .option("--stability <n>", "voice stability 0..1", parseFloat)
    .option("--similarity <n>", "similarity boost 0..1", parseFloat)
    .option("--style <n>", "style exaggeration 0..1 — amplifies the source's delivery (default 0; higher adds latency / less stable)", parseFloat)
    .option("--use-speaker-boost", "sharpen fidelity to the target speaker (small latency cost)")
    .option("--seed <n>", "deterministic speech-to-speech seed for reproducible output (integer)", (v) => parseInt(v, 10))
    .option("--remove-background-noise", "clean, voice-only output; omit to keep the music/SFX bed under the new voice")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro voice changer --audio https://.../speech.mp3 --voice Rachel --watch
  $ nodaro voice changer --video https://.../talking.mp4 --voice Aria --watch
  $ nodaro voice changer --video https://.../talking.mp4 --voice Roger --remove-background-noise --watch`)
    .action(
      async (
        opts: {
          voice: string
          audio?: string
          video?: string
          model?: string
          stability?: number
          similarity?: number
          style?: number
          useSpeakerBoost?: boolean
          seed?: number
          removeBackgroundNoise?: boolean
        } & WatchOpts,
      ) => {
        try {
          if (!opts.audio && !opts.video) {
            warn("Provide --audio <url> or --video <url> (one is required)")
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.voices.change({
            voiceId: opts.voice,
            audioUrl: opts.audio,
            videoUrl: opts.video,
            model: opts.model,
            stability: opts.stability,
            similarityBoost: opts.similarity,
            style: opts.style,
            useSpeakerBoost: opts.useSpeakerBoost,
            seed: opts.seed,
            removeBackgroundNoise: opts.removeBackgroundNoise,
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), {
            ...opts,
            note: `${opts.video ? "video" : "audio"} mode`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("recast")
    .alias("pro")
    .description(
      "multi-speaker recast (Voice Changer Pro, Cloud only) — detects each speaker and recasts speaker N to the N-th entry of --voices; a `keep` entry keeps that speaker's original voice",
    )
    .option("--audio <url>", "audio URL to recast (audio → audio)")
    .option("--video <url>", "video URL to recast (the audio track is recast and remuxed). Wins over --audio when both are given.")
    .option(
      "--voices <list>",
      "comma-separated voices in speaker order — each entry is a premade name (Rachel), an ElevenLabs clone UUID, or the literal `keep` to keep that speaker's original voice",
    )
    .option(
      "--voices-json <json>",
      'JSON array for per-voice settings — entries are a voice id string, a {"voiceId","stability","similarityBoost","style","useSpeakerBoost","seed","volumeMode","volume"} object, or null to keep that speaker\'s original voice',
    )
    .option("--model <id>", "speech-to-speech model override")
    .option("--output <mode>", "output mode: video (default — merged, rendered result) or stems (dry per-track stems for an interactive mix; render later with `voice export`)")
    .option("--analysis-json <json>", "a completed `voice analyze` job's output_data, inline — skips re-detection (the interactive-flow fast-path)")
    .option("--analysis-file <path>", "same as --analysis-json but read from a JSON file")
    .option("--no-preserve-background", "drop the separated music/SFX bed for a clean voice-only result (kept by default)")
    .option("--separation-quality <q>", "voice/music separation quality: fast (default) or best")
    .option("--music-volume-mode <mode>", "preserved background level: match (default), normalize, or manual")
    .option("--music-volume <n>", "background level % (0-200) when --music-volume-mode is manual", parseFloat)
    .option("--remove-background-noise", "denoise for a cleaner voice-only result")
    .option("--voice-fx <preset>", `reverb/echo on the combined recast voices: ${FX_PRESETS}`)
    .option("--voice-fx-mix <n>", "reverb wet/dry mix % (0-100) — reverb presets", parseFloat)
    .option("--voice-fx-delay <ms>", "echo delay in ms (20-2000) — echo/custom presets", (v) => parseInt(v, 10))
    .option("--voice-fx-decay <n>", "echo decay (0-1) — echo/custom presets", parseFloat)
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro voice recast --audio https://.../podcast.mp3 --voices Rachel,Aria --watch
  $ nodaro voice recast --video https://.../panel.mp4 --voices Rachel,keep,Aria --watch
      # speaker 1 → Rachel, speaker 2 keeps their original voice, speaker 3 → Aria
  $ nodaro voice recast --audio https://.../ad.mp3 \\
      --voices-json '[{"voiceId":"Rachel","stability":0.6},null,"Aria"]' --no-preserve-background
  $ nodaro voice recast --video https://.../panel.mp4 --voices Rachel,Aria \\
      --analysis-file analysis.json --output stems --watch
      # interactive flow: reuse a \`voice analyze\` result, get dry stems to mix, render with \`voice export\``)
    .action(
      async (
        opts: {
          audio?: string
          video?: string
          voices?: string
          voicesJson?: string
          model?: string
          output?: string
          analysisJson?: string
          analysisFile?: string
          preserveBackground: boolean
          separationQuality?: string
          musicVolumeMode?: string
          musicVolume?: number
          removeBackgroundNoise?: boolean
        } & VoiceFxFlags &
          WatchOpts,
      ) => {
        try {
          if (!opts.audio && !opts.video) {
            warn("Provide --audio <url> or --video <url> (one is required)")
            process.exit(1)
          }
          if (opts.voices && opts.voicesJson) {
            warn("--voices and --voices-json are mutually exclusive — pass one")
            process.exit(1)
          }
          if (!opts.voices && !opts.voicesJson) {
            warn("Provide --voices <v1,v2,...> (use `keep` to keep a speaker's original voice) or --voices-json <json>")
            process.exit(1)
          }
          if (opts.output && opts.output !== "video" && opts.output !== "stems") {
            warn(`--output must be "video" or "stems" (got "${opts.output}")`)
            process.exit(1)
          }

          let orderedVoices: VoiceChangerProInput["orderedVoices"]
          if (opts.voices) {
            const entries = opts.voices.split(",").map((s) => s.trim())
            if (entries.some((e) => e === "")) {
              warn(`--voices has an empty entry: ${JSON.stringify(opts.voices)}`)
              process.exit(1)
            }
            // The literal `keep` (any case) marks a keep-slot — that speaker's
            // original voice is kept (a null entry on the wire). Collision-free:
            // premade voice names and ElevenLabs UUIDs never equal "keep".
            orderedVoices = entries.map((e) => (e.toLowerCase() === "keep" ? null : e))
          } else {
            let parsed: unknown
            try {
              parsed = JSON.parse(opts.voicesJson!)
            } catch {
              warn("--voices-json is not valid JSON")
              process.exit(1)
            }
            if (
              !Array.isArray(parsed) ||
              parsed.length === 0 ||
              !parsed.every((v) => v === null || typeof v === "string" || (typeof v === "object" && !Array.isArray(v)))
            ) {
              warn("--voices-json must be a non-empty JSON array of voice id strings, per-voice settings objects, or null keep-slots")
              process.exit(1)
            }
            orderedVoices = parsed as VoiceChangerProInput["orderedVoices"]
          }
          if (!orderedVoices.some((v) => v !== null)) {
            warn("At least one speaker must get a new voice — `keep` only marks speakers whose original voice stays")
            process.exit(1)
          }

          const voiceFx = buildVoiceFx(opts)

          // A prior analyze result skips re-detection. Accept the completed
          // job's output_data verbatim: pick only the analysis keys, so the
          // extra reporting fields it carries (suggestedTitle, …) never leak
          // into the request body.
          const analysisRaw = readJsonFlag(opts.analysisJson, opts.analysisFile, "analysis")
          let analysis: VcpAnalysis | undefined
          if (analysisRaw !== undefined) {
            const a = analysisRaw as Partial<VcpAnalysis> | null
            if (!a || typeof a !== "object" || Array.isArray(a) || typeof a.vocalsUrl !== "string" || !Array.isArray(a.speakers)) {
              warn("--analysis-json/--analysis-file must be an analyze result object (vocalsUrl + speakers[]) — pass a completed `voice analyze` job's output_data")
              process.exit(1)
            }
            analysis = {
              vocalsUrl: a.vocalsUrl,
              ...(a.backgroundUrl !== undefined ? { backgroundUrl: a.backgroundUrl } : {}),
              speakers: a.speakers,
              ...(a.languageCode !== undefined ? { languageCode: a.languageCode } : {}),
              ...(a.languageProbability !== undefined ? { languageProbability: a.languageProbability } : {}),
            }
          }

          const client = buildClient(opts.profile)
          const input: VoiceChangerProInput = {
            orderedVoices,
            // Video wins when both are given (matches the route + `voice changer`).
            ...(opts.video ? { videoUrl: opts.video } : { audioUrl: opts.audio }),
            ...(opts.model ? { model: opts.model } : {}),
            ...(opts.output ? { output: opts.output as NonNullable<VoiceChangerProInput["output"]> } : {}),
            ...(analysis ? { analysis } : {}),
            // Only sent when --no-preserve-background was used; otherwise omitted
            // so the server default (true) applies.
            ...(opts.preserveBackground === false ? { preserveBackground: false } : {}),
            ...(opts.separationQuality ? { separationQuality: opts.separationQuality as NonNullable<VoiceChangerProInput["separationQuality"]> } : {}),
            ...(opts.musicVolumeMode ? { musicVolumeMode: opts.musicVolumeMode as NonNullable<VoiceChangerProInput["musicVolumeMode"]> } : {}),
            ...(opts.musicVolume !== undefined ? { musicVolume: opts.musicVolume } : {}),
            ...(opts.removeBackgroundNoise ? { removeBackgroundNoise: true } : {}),
            ...(voiceFx ? { voiceFx } : {}),
          }
          const result = await client.voices.recast(input)
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), {
            ...opts,
            note: `${opts.video ? "video" : "audio"} mode${opts.output === "stems" ? ", stems output" : ""}`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("analyze")
    .description(
      "detect the speakers in a clip WITHOUT recasting (Voice Changer Pro, Cloud only) — the first step of the interactive flow: pick voices against the printed speaker list, then `voice recast`",
    )
    .option("--audio <url>", "audio URL to analyze")
    .option("--video <url>", "video URL to analyze (its audio track is used). Wins over --audio when both are given.")
    .option("--separation-quality <q>", "voice/music separation quality: fast (default) or best")
    .option("--suggest-title", "also suggest a title for the clip from its transcript")
    .option("--watch", "poll until the job completes, then print the detected speakers")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro voice analyze --video https://.../panel.mp4 --watch
  $ nodaro voice analyze --audio https://.../podcast.mp3 --separation-quality best --suggest-title --watch

The completed job's output_data carries the separated stems + the speaker list;
save it to a file and pass it to \`voice recast --analysis-file\` to skip re-detection.`)
    .action(
      async (
        opts: {
          audio?: string
          video?: string
          separationQuality?: string
          suggestTitle?: boolean
        } & WatchOpts,
      ) => {
        try {
          if (!opts.audio && !opts.video) {
            warn("Provide --audio <url> or --video <url> (one is required)")
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.voices.analyze({
            // Video wins when both are given (matches `voice recast`).
            ...(opts.video ? { videoUrl: opts.video } : { audioUrl: opts.audio }),
            ...(opts.separationQuality ? { separationQuality: opts.separationQuality as "fast" | "best" } : {}),
            ...(opts.suggestTitle ? { suggestTitle: true } : {}),
          })
          const terminal = await reportQueuedJob(result, () => client.jobs.get(result.jobId), {
            ...opts,
            note: "speaker detection",
          })
          // Render the speaker list on a watched non-JSON completion (failed /
          // cancelled runs exit inside the watch loop; --json already emitted).
          if (terminal && !opts.json && terminal.data.status === "completed") {
            renderAnalyzeOutput((terminal.data as { output_data?: unknown }).output_data)
          }
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("export")
    .description(
      "render the final video from a mixed set of stems (Voice Changer Pro, Cloud only) — the last step of the interactive flow, after `voice recast --output stems`",
    )
    .requiredOption("--source <url>", "the source video to remux the mixed audio onto (stream-copied, never re-encoded)")
    .option("--tracks-json <json>", 'the mix, inline — a JSON array of { "url", "gain" (0-200), "muted", "kind"? ("voice"|"background") } lanes (max 16)')
    .option("--tracks-file <path>", "same as --tracks-json but read from a JSON file")
    .option("--voice-fx <preset>", `reverb/echo on the voice lanes at render time: ${FX_PRESETS}`)
    .option("--voice-fx-mix <n>", "reverb wet/dry mix % (0-100) — reverb presets", parseFloat)
    .option("--voice-fx-delay <ms>", "echo delay in ms (20-2000) — echo/custom presets", (v) => parseInt(v, 10))
    .option("--voice-fx-decay <n>", "echo decay (0-1) — echo/custom presets", parseFloat)
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro voice export --source https://.../panel.mp4 --tracks-file mix.json --watch
  $ nodaro voice export --source https://.../panel.mp4 --voice-fx hall --voice-fx-mix 30 \\
      --tracks-json '[{"url":"https://.../s0.mp3","gain":100,"muted":false},
                      {"url":"https://.../bg.mp3","gain":80,"muted":false,"kind":"background"}]'

Track urls come from a \`voice recast --output stems\` job's output_data. --voice-fx
lands on the voice lanes only (never a "background" lane).`)
    .action(
      async (
        opts: {
          source: string
          tracksJson?: string
          tracksFile?: string
        } & VoiceFxFlags &
          WatchOpts,
      ) => {
        try {
          const parsed = readJsonFlag(opts.tracksJson, opts.tracksFile, "tracks")
          if (parsed === undefined) {
            warn("Provide --tracks-json <json> or --tracks-file <path> — the mix's track list")
            process.exit(1)
          }
          if (
            !Array.isArray(parsed) ||
            parsed.length === 0 ||
            !parsed.every((t) => t !== null && typeof t === "object" && !Array.isArray(t) && typeof (t as { url?: unknown }).url === "string")
          ) {
            warn('tracks must be a non-empty JSON array of { "url", "gain", "muted", "kind"? } objects')
            process.exit(1)
          }
          const tracks = parsed as VcpExportTrack[]
          if (tracks.every((t) => t.muted === true)) {
            warn("At least one track must be un-muted — an all-muted mix renders silence and the server rejects it")
            process.exit(1)
          }
          const voiceFx = buildVoiceFx(opts)

          const client = buildClient(opts.profile)
          const input: VcpExportInput = {
            videoUrl: opts.source,
            tracks,
            ...(voiceFx ? { voiceFx } : {}),
          }
          const result = await client.voices.exportMix(input)
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), {
            ...opts,
            note: `${tracks.length} track${tracks.length === 1 ? "" : "s"}`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("design")
    .description("design a brand-new synthetic voice from a text description (ElevenLabs text-to-voice)")
    .requiredOption("--text <line>", "a preview line (100-1000 chars) spoken in the designed voice")
    .requiredOption("--description <desc>", "natural-language description of the voice to create")
    .option("--model <id>", "voice-design model override")
    .option("--loudness <n>", "output loudness (-1..1)", parseFloat)
    .option("--guidance-scale <n>", "how strongly the description steers the design (0-100)", parseFloat)
    .option("--seed <n>", "deterministic seed for a reproducible design (integer)", (v) => parseInt(v, 10))
    .option("--quality <n>", "design quality knob (provider-specific)", parseFloat)
    .option("--enhance", "enhance the generated voice")
    .option("--user-prompt <text>", "optional extra prompt context")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Example:
  $ nodaro voice design --description "a warm, gravelly narrator in his 60s" \\
      --text "Some stories don't begin at the beginning; they begin the moment everything changes, and this one is no different." --watch`)
    .action(
      async (
        opts: {
          text: string
          description: string
          model?: string
          loudness?: number
          guidanceScale?: number
          seed?: number
          quality?: number
          enhance?: boolean
          userPrompt?: string
        } & WatchOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.voices.design({
            text: opts.text,
            voiceDescription: opts.description,
            ...(opts.model ? { model: opts.model } : {}),
            ...(opts.loudness !== undefined ? { loudness: opts.loudness } : {}),
            ...(opts.guidanceScale !== undefined ? { guidanceScale: opts.guidanceScale } : {}),
            ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
            ...(opts.quality !== undefined ? { quality: opts.quality } : {}),
            ...(opts.enhance ? { shouldEnhance: true } : {}),
            ...(opts.userPrompt ? { userPrompt: opts.userPrompt } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "voice design" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("remix")
    .description("speak a text in a voice described in natural language, without cloning (ElevenLabs voice remix)")
    .requiredOption("--text <text>", "the text (1-5000 chars) to speak")
    .requiredOption("--description <desc>", "natural-language description of the voice to speak in")
    .option("--user-prompt <text>", "optional extra prompt context")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: {
          text: string
          description: string
          userPrompt?: string
        } & WatchOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.voices.remix({
            text: opts.text,
            voiceDescription: opts.description,
            ...(opts.userPrompt ? { userPrompt: opts.userPrompt } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "voice remix" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("dub")
    .description("dub an audio clip into another language while preserving each speaker's voice")
    .requiredOption("--audio <url>", "audio URL to dub")
    .requiredOption("--target-language <code>", 'target language ISO code, e.g. "es", "fr", "pt-BR"')
    .option("--source-language <code>", "source language ISO code (auto-detected when omitted)")
    .option("--num-speakers <n>", "expected number of speakers (1-20) — improves separation when known", (v) => parseInt(v, 10))
    .option("--disable-voice-cloning", "keep the original voices instead of cloning them into the target language")
    .option("--drop-background-audio", "drop the background/music bed from the dubbed output")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Example:
  $ nodaro voice dub --audio https://.../interview.mp3 --target-language es --num-speakers 2 --watch`)
    .action(
      async (
        opts: {
          audio: string
          targetLanguage: string
          sourceLanguage?: string
          numSpeakers?: number
          disableVoiceCloning?: boolean
          dropBackgroundAudio?: boolean
        } & WatchOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.voices.dub({
            audioUrl: opts.audio,
            targetLanguage: opts.targetLanguage,
            ...(opts.sourceLanguage ? { sourceLanguage: opts.sourceLanguage } : {}),
            ...(opts.numSpeakers !== undefined ? { numSpeakers: opts.numSpeakers } : {}),
            ...(opts.disableVoiceCloning ? { disableVoiceCloning: true } : {}),
            ...(opts.dropBackgroundAudio ? { dropBackgroundAudio: true } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), {
            ...opts,
            note: `dub → ${opts.targetLanguage}`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("list")
    .description("list the premade voices you can pass to --voice / --voices (or your voice clones with --clones)")
    .option("--clones", "list your voice clones instead of the premade catalog")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { clones?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        if (opts.clones) {
          const clones = await client.voices.listClones()
          if (opts.json) {
            emit(clones, opts)
            return
          }
          table(
            clones.map((c) => ({ name: c.name, voice_id: c.elevenlabsVoiceId, clone_id: c.id, created: c.createdAt })),
            ["name", "voice_id", "clone_id", "created"],
          )
          dim(`${clones.length} clone${clones.length === 1 ? "" : "s"} — pass voice_id to --voice / --voices`)
          return
        }
        const voices = await client.voices.list()
        if (opts.json) {
          emit(voices, opts)
          return
        }
        table(
          voices.map((v) => ({ name: v.name, voice_id: v.voice_id, gender: v.gender, accent: v.accent, age: v.age, category: v.category })),
          ["name", "voice_id", "gender", "accent", "age", "category"],
        )
        dim(`${voices.length} premade voice${voices.length === 1 ? "" : "s"} — pass a name or voice_id to --voice / --voices`)
      } catch (err) {
        handleError(err)
      }
    })

  const clones = new Command("clones").description("manage your voice clones (list / create / delete)")

  clones
    .command("list")
    .description("list your voice clones")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const rows = await client.voices.listClones()
        if (opts.json) {
          emit(rows, opts)
          return
        }
        table(
          rows.map((c) => ({ name: c.name, voice_id: c.elevenlabsVoiceId, clone_id: c.id, created: c.createdAt })),
          ["name", "voice_id", "clone_id", "created"],
        )
        dim(`${rows.length} clone${rows.length === 1 ? "" : "s"} — pass voice_id to --voice / --voices`)
      } catch (err) {
        handleError(err)
      }
    })

  clones
    .command("create")
    .description("clone a voice from a sample — an already-uploaded URL (--audio) or a local file (--file). Costs credits.")
    .requiredOption("--name <name>", "name for the new clone")
    .option("--audio <url>", "URL of an uploaded audio sample to clone from")
    .option("--file <path>", "local audio file to upload and clone from (mp3/wav/m4a/aac/ogg/flac/webm)")
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro voice clones create --name "Narrator" --audio https://.../sample.mp3
  $ nodaro voice clones create --name "Narrator" --file ./sample.wav`)
    .action(async (opts: { name: string; audio?: string; file?: string } & GlobalOpts) => {
      try {
        if (!opts.audio && !opts.file) {
          warn("Provide --audio <url> or --file <path> (one is required)")
          process.exit(1)
        }
        if (opts.audio && opts.file) {
          warn("--audio and --file are mutually exclusive — pass one")
          process.exit(1)
        }
        const client = buildClient(opts.profile)
        const clone = opts.file
          ? await client.voices.createCloneFromFile({
              name: opts.name,
              file: readFileSync(opts.file),
              filename: basename(opts.file),
              contentType: AUDIO_CONTENT_TYPES[extname(opts.file).toLowerCase()] ?? "audio/mpeg",
            })
          : await client.voices.createClone({ name: opts.name, audioUrl: opts.audio! })
        if (opts.json) {
          emit(clone, opts)
          return
        }
        success(`created voice clone "${clone.name}"`)
        info(`voice_id: ${clone.elevenlabsVoiceId}`)
        dim(`use it: nodaro voice changer --voice ${clone.elevenlabsVoiceId} --audio <url>`)
      } catch (err) {
        handleError(err)
      }
    })

  clones
    .command("delete <id>")
    .description("delete one of your voice clones (the clone row id, not the voice_id)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.voices.deleteClone(id)
        if (opts.json) emit({ id, deleted: true }, opts)
        else success(`deleted voice clone ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd.addCommand(clones)

  return cmd
}
