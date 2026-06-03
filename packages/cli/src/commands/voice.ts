import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, warn, type OutputOpts } from "../output.js"
import { watchUntilTerminal } from "../util.js"

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

  return cmd
}
