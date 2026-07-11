import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, warn, type OutputOpts } from "../output.js"
import { watchUntilTerminal } from "../util.js"
import type { VoiceChangerProInput } from "@nodaro/sdk"

interface GlobalOpts extends OutputOpts {
  profile?: string
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
    .option("--stability <n>", "voice stability 0..1", parseFloat)
    .option("--similarity <n>", "similarity boost 0..1", parseFloat)
    .option("--style <n>", "style exaggeration 0..1 — amplifies the source's delivery (default 0; higher adds latency / less stable)", parseFloat)
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
          stability?: number
          similarity?: number
          style?: number
          removeBackgroundNoise?: boolean
          watch?: boolean
          pollInterval: number
        } & GlobalOpts,
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
            stability: opts.stability,
            similarityBoost: opts.similarity,
            style: opts.style,
            removeBackgroundNoise: opts.removeBackgroundNoise,
          })
          const jobId = result.jobId

          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }

          success(`job ${jobId} queued (${opts.video ? "video" : "audio"} mode)`)
          if (!opts.watch) {
            dim(`follow: nodaro jobs get ${jobId}`)
            return
          }
          await watchUntilTerminal({
            fetch: () => client.jobs.get(jobId),
            label: jobId,
            intervalMs: opts.pollInterval,
            ...opts,
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
    .option("--no-preserve-background", "drop the separated music/SFX bed for a clean voice-only result (kept by default)")
    .option("--separation-quality <q>", "voice/music separation quality: fast (default) or best")
    .option("--music-volume-mode <mode>", "preserved background level: match (default), normalize, or manual")
    .option("--music-volume <n>", "background level % (0-200) when --music-volume-mode is manual", parseFloat)
    .option("--remove-background-noise", "denoise for a cleaner voice-only result")
    .option("--voice-fx <preset>", "reverb/echo on the combined recast voices: room|bathroom|car|hall|concert-hall|church|cave|arena|outdoor|telephone|megaphone|echo|custom")
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
      --voices-json '[{"voiceId":"Rachel","stability":0.6},null,"Aria"]' --no-preserve-background`)
    .action(
      async (
        opts: {
          audio?: string
          video?: string
          voices?: string
          voicesJson?: string
          model?: string
          preserveBackground: boolean
          separationQuality?: string
          musicVolumeMode?: string
          musicVolume?: number
          removeBackgroundNoise?: boolean
          voiceFx?: string
          voiceFxMix?: number
          voiceFxDelay?: number
          voiceFxDecay?: number
          watch?: boolean
          pollInterval: number
        } & GlobalOpts,
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

          if ((opts.voiceFxMix !== undefined || opts.voiceFxDelay !== undefined || opts.voiceFxDecay !== undefined) && !opts.voiceFx) {
            warn("--voice-fx-mix / --voice-fx-delay / --voice-fx-decay require --voice-fx <preset>")
            process.exit(1)
          }
          const voiceFx: VoiceChangerProInput["voiceFx"] = opts.voiceFx
            ? {
                preset: opts.voiceFx as NonNullable<VoiceChangerProInput["voiceFx"]>["preset"],
                ...(opts.voiceFxMix !== undefined ? { wetDryMix: opts.voiceFxMix } : {}),
                ...(opts.voiceFxDelay !== undefined ? { delayMs: opts.voiceFxDelay } : {}),
                ...(opts.voiceFxDecay !== undefined ? { decay: opts.voiceFxDecay } : {}),
              }
            : undefined

          const client = buildClient(opts.profile)
          const input: VoiceChangerProInput = {
            orderedVoices,
            // Video wins when both are given (matches the route + `voice changer`).
            ...(opts.video ? { videoUrl: opts.video } : { audioUrl: opts.audio }),
            ...(opts.model ? { model: opts.model } : {}),
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
          const jobId = result.jobId

          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }

          success(`job ${jobId} queued (${opts.video ? "video" : "audio"} mode)`)
          if (!opts.watch) {
            dim(`follow: nodaro jobs get ${jobId}`)
            return
          }
          await watchUntilTerminal({
            fetch: () => client.jobs.get(jobId),
            label: jobId,
            intervalMs: opts.pollInterval,
            ...opts,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
