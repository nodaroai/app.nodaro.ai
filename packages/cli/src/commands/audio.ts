import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { warn, type OutputOpts } from "../output.js"
import { collectVariadic, reportQueuedJob } from "../util.js"
import type { AudioFxPreset } from "@nodaro/sdk"
import {
  TRANSCRIBE_PROVIDERS,
  DEFAULT_TRANSCRIBE_PROVIDER,
  transcribeLaneSupportsWordTimestamps,
  type TranscribeProvider,
} from "@nodaro/shared"

// The providers this command ACCEPTS that can also honour word timestamps —
// the capability table intersected with the accepted enum, exactly as
// `/v1/transcribe` does it, so the refusal below never names a provider this
// same command would reject on `--provider`.
const WORD_TIMESTAMP_PROVIDERS = TRANSCRIBE_PROVIDERS.filter((p) => transcribeLaneSupportsWordTimestamps(p))

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface WatchOpts extends GlobalOpts {
  watch?: boolean
  pollInterval: number
}

const FX_PRESETS = "room|bathroom|car|hall|concert-hall|church|cave|arena|outdoor|telephone|megaphone|echo|custom"

/** Parse a `--segment url[@start-end]` entry (seconds, floats allowed). */
function parseSegment(raw: string): { url: string; startTime?: number; endTime?: number } {
  const at = raw.lastIndexOf("@")
  if (at < 0) return { url: raw }
  const range = raw.slice(at + 1)
  const m = range.match(/^([0-9]+(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)?)$/)
  const start = m ? parseFloat(m[1]) : NaN
  const end = m ? parseFloat(m[2]) : NaN
  if (!m || !(start < end)) {
    warn(`--segment range must be "url@<start>-<end>" in seconds with start < end (got "${raw}")`)
    process.exit(1)
  }
  return { url: raw.slice(0, at), startTime: start, endTime: end }
}

export function audioCommand(): Command {
  const cmd = new Command("audio").description(
    "audio primitives — the building blocks Voice Changer Pro composes: separate, isolate, fx, mix, level, combine, transcribe",
  )

  cmd
    .command("separate")
    .description("separate an audio track into stems (Demucs) — voice vs music/SFX, or the full stem breakdown")
    .requiredOption("--audio <url>", "audio URL to separate")
    .option("--mode <mode>", "vocal_instrumental (default) or stems (drums/bass/other/…)")
    .option("--quality <q>", "separation quality: auto (default), fast, or best")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (opts: { audio: string; mode?: string; quality?: string } & WatchOpts) => {
        try {
          if (opts.mode && !["vocal_instrumental", "stems"].includes(opts.mode)) {
            warn(`--mode must be vocal_instrumental or stems (got "${opts.mode}")`)
            process.exit(1)
          }
          if (opts.quality && !["auto", "fast", "best"].includes(opts.quality)) {
            warn(`--quality must be auto, fast, or best (got "${opts.quality}")`)
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.audio.separate({
            audioUrl: opts.audio,
            ...(opts.mode ? { mode: opts.mode as "vocal_instrumental" | "stems" } : {}),
            ...(opts.quality ? { quality: opts.quality as "auto" | "fast" | "best" } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: opts.mode ?? "vocal_instrumental" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("isolate")
    .description("isolate the primary voice and strip background noise (ElevenLabs voice isolation)")
    .requiredOption("--audio <url>", "audio URL to isolate")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { audio: string } & WatchOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.audio.isolate({ audioUrl: opts.audio })
        await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "voice isolation" })
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("fx")
    .description("apply a reverb / echo / telephone / megaphone effect to an audio track — the same presets VCP's voice-fx uses, standalone")
    .requiredOption("--audio <url>", "audio URL to process")
    .option("--preset <preset>", `effect preset: ${FX_PRESETS} (server default when omitted)`)
    .option("--mix <n>", "reverb wet/dry mix % (0-100) — reverb presets", parseFloat)
    .option("--delay <ms>", "echo delay in ms (20-2000) — echo/custom presets", (v) => parseInt(v, 10))
    .option("--decay <n>", "echo decay (0-1) — echo/custom presets", parseFloat)
    .option("--eq-low <db>", "low-shelf gain in dB — telephone/megaphone shaping", parseFloat)
    .option("--eq-high <db>", "high-shelf gain in dB — telephone/megaphone shaping", parseFloat)
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Example:
  $ nodaro audio fx --audio https://.../voice.mp3 --preset hall --mix 35 --watch`)
    .action(
      async (
        opts: { audio: string; preset?: string; mix?: number; delay?: number; decay?: number; eqLow?: number; eqHigh?: number } & WatchOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.audio.applyFx({
            audioUrl: opts.audio,
            ...(opts.preset ? { preset: opts.preset as AudioFxPreset } : {}),
            ...(opts.mix !== undefined ? { mix: opts.mix } : {}),
            ...(opts.delay !== undefined ? { delayMs: opts.delay } : {}),
            ...(opts.decay !== undefined ? { decay: opts.decay } : {}),
            ...(opts.eqLow !== undefined ? { eqLow: opts.eqLow } : {}),
            ...(opts.eqHigh !== undefined ? { eqHigh: opts.eqHigh } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: opts.preset ?? "audio fx" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("mix")
    .description("layer multiple audio tracks into one (tracks are summed)")
    .option("--audio <url>", "audio track URL — repeat the flag for each track (2-20)", collectVariadic)
    .option("--volumes <csv>", 'per-track level %, positionally (0-200 each), e.g. "100,80"')
    .option("--duck-under <index>", "duck every OTHER track under this track (0-based index of the voice) — a music bed that dips under speech", (v) => parseInt(v, 10))
    .option("--duck-amount <n>", "how hard the others dip, 0-100 (default 75); needs --duck-under", parseFloat)
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Example:
  $ nodaro audio mix --audio https://.../voice.mp3 --audio https://.../bed.mp3 --volumes 100,60 --watch
  $ nodaro audio mix --audio https://.../voice.mp3 --audio https://.../bed.mp3 --duck-under 0 --duck-amount 80 --watch`)
    .action(
      async (opts: { audio?: string[]; volumes?: string; duckUnder?: number; duckAmount?: number } & WatchOpts) => {
        try {
          const urls = opts.audio ?? []
          if (urls.length < 2) {
            warn("Provide at least two tracks: --audio <url> --audio <url> ...")
            process.exit(1)
          }
          let trackVolumes: number[] | undefined
          if (opts.volumes) {
            trackVolumes = opts.volumes.split(",").map((s) => parseFloat(s.trim()))
            if (trackVolumes.length !== urls.length || trackVolumes.some((v) => Number.isNaN(v))) {
              warn(`--volumes must be ${urls.length} comma-separated numbers (one per --audio, in order)`)
              process.exit(1)
            }
          }
          if (opts.duckAmount !== undefined && opts.duckUnder === undefined) {
            warn("--duck-amount needs --duck-under <index> (the track the others duck under)")
            process.exit(1)
          }
          if (opts.duckUnder !== undefined && (!Number.isInteger(opts.duckUnder) || opts.duckUnder < 0 || opts.duckUnder >= urls.length)) {
            warn(`--duck-under must be the 0-based index of one of the ${urls.length} --audio tracks (0-${urls.length - 1})`)
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.audio.mix({
            audioUrls: urls,
            ...(trackVolumes ? { trackVolumes } : {}),
            ...(opts.duckUnder !== undefined
              ? { duck: { under: opts.duckUnder, ...(opts.duckAmount !== undefined ? { amount: opts.duckAmount } : {}) } }
              : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: `${urls.length} tracks` })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("adjust-volume")
    .description("adjust an audio (or a video's audio) level — set %, loudness-normalize, fade in/out")
    .option("--audio <url>", "audio URL to adjust")
    .option("--video <url>", "video URL whose audio to adjust")
    .option("--volume <n>", "level % (default 100)", parseFloat)
    .option("--normalize", "apply loudness normalization")
    .option("--fade-in <sec>", "fade-in duration in seconds", parseFloat)
    .option("--fade-out <sec>", "fade-out duration in seconds", parseFloat)
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        opts: { audio?: string; video?: string; volume?: number; normalize?: boolean; fadeIn?: number; fadeOut?: number } & WatchOpts,
      ) => {
        try {
          if (!opts.audio && !opts.video) {
            warn("Provide --audio <url> or --video <url> (one is required)")
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.audio.adjustVolume({
            ...(opts.audio ? { audioUrl: opts.audio } : {}),
            ...(opts.video ? { videoUrl: opts.video } : {}),
            ...(opts.volume !== undefined ? { volume: opts.volume } : {}),
            ...(opts.normalize ? { normalize: true } : {}),
            ...(opts.fadeIn !== undefined ? { fadeIn: opts.fadeIn } : {}),
            ...(opts.fadeOut !== undefined ? { fadeOut: opts.fadeOut } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "adjust volume" })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("combine")
    .description("concatenate audio segments end-to-end")
    .option("--segment <url[@a-b]>", 'segment URL with an optional "@start-end" sub-range in seconds — repeat per segment, in order', collectVariadic)
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Example:
  $ nodaro audio combine --segment https://.../intro.mp3 --segment "https://.../talk.mp3@12-95" --watch`)
    .action(
      async (opts: { segment?: string[] } & WatchOpts) => {
        try {
          const raws = opts.segment ?? []
          if (raws.length === 0) {
            warn("Provide at least one segment: --segment <url[@start-end]> ...")
            process.exit(1)
          }
          const segments = raws.map(parseSegment)
          const client = buildClient(opts.profile)
          const result = await client.audio.combine({ segments })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), {
            ...opts,
            note: `${segments.length} segment${segments.length === 1 ? "" : "s"}`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("transcribe")
    .description("transcribe an audio (or video) track to text — elevenlabs-stt is always word-level and can diarize + tag audio events")
    .requiredOption("--audio <url>", "audio (or video) URL to transcribe")
    .option(
      "--provider <name>",
      `transcription engine: ${TRANSCRIBE_PROVIDERS.join(" | ")} — "${DEFAULT_TRANSCRIBE_PROVIDER}" returns NO word timings, named or reached by omitting this flag`,
    )
    .option("--language <code>", "language code to force (default: auto-detect)")
    .option("--diarize", "label which speaker said each word (elevenlabs-stt)")
    .option("--tag-audio-events", "tag laughter / applause / other non-speech events (elevenlabs-stt)")
    .option("--word-timestamps", "ask for per-word timings — rejected up front on a lane that cannot produce them")
    .option("--watch", "poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
The completed job's output_data carries: text (the whole transcript), words
(one entry per word, in MILLISECONDS) and json (the normalized transcript, also
ms). A top-level segments array (SECONDS) exists only on the legacy lanes —
elevenlabs-stt returns none, so read words.

Feed the words straight into a kinetic caption render:
  $ nodaro audio transcribe --audio https://.../talk.mp3 --provider elevenlabs-stt --watch
  $ nodaro jobs get <jobId> --json | jq '.output_data.words' > words.json
  $ nodaro media add-captions https://.../talk.mp4 --captions-file words.json \\
      --style word-highlight --no-auto-transcribe --watch

Example:
  $ nodaro audio transcribe --audio https://.../interview.mp3 --provider elevenlabs-stt --diarize --watch`)
    .action(
      async (
        opts: {
          audio: string
          provider?: string
          language?: string
          diarize?: boolean
          tagAudioEvents?: boolean
          wordTimestamps?: boolean
        } & WatchOpts,
      ) => {
        try {
          if (opts.provider && !(TRANSCRIBE_PROVIDERS as readonly string[]).includes(opts.provider)) {
            warn(`--provider must be one of ${TRANSCRIBE_PROVIDERS.join(", ")} (got "${opts.provider}")`)
            process.exit(1)
          }
          // Word timings are a per-lane CAPABILITY, asked of the same shared
          // table the route asks — so this pre-empts the route's 400 with the
          // identical verdict instead of encoding a second copy of the policy.
          const resolvedLane = opts.provider ?? DEFAULT_TRANSCRIBE_PROVIDER
          if (opts.wordTimestamps && !transcribeLaneSupportsWordTimestamps(resolvedLane)) {
            warn(
              `--word-timestamps is not supported by "${resolvedLane}"${opts.provider ? "" : " (the default when --provider is omitted)"} — ` +
                `pass --provider ${WORD_TIMESTAMP_PROVIDERS.join(" or ")}`,
            )
            process.exit(1)
          }
          const client = buildClient(opts.profile)
          const result = await client.audio.transcribe({
            audioUrl: opts.audio,
            ...(opts.provider ? { provider: opts.provider as TranscribeProvider } : {}),
            ...(opts.language ? { language: opts.language } : {}),
            ...(opts.diarize ? { diarize: true } : {}),
            ...(opts.tagAudioEvents ? { tagAudioEvents: true } : {}),
            ...(opts.wordTimestamps ? { wordTimestamps: true } : {}),
          })
          await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: resolvedLane })
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
