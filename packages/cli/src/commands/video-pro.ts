import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, type OutputOpts } from "../output.js"
import { reportQueuedJob } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * Generate Video Pro run control (Cloud edition) — the checkpointed long-video
 * engine generates one segment at a time, so a run can be stopped mid-way
 * (keeping and paying for only what was generated) and continued later from
 * any already-delivered segment.
 */
export function videoProCommand(): Command {
  const cmd = new Command("video-pro").description(
    "stop / continue generate-video-pro runs (segmented long-video engine)",
  )

  cmd
    .command("stop <jobId>")
    .description(
      "gracefully stop a running job: keep + deliver the completed segments as the final video, refund the rest (the in-flight segment is billed — the provider keeps rendering it)",
    )
    .option("--profile <name>")
    .option("--json")
    .action(async (jobId: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.videoPro.stop(jobId)
        if (opts.json) {
          emit(result, opts)
          return
        }
        if (result.stopping) {
          success(`stop requested for ${jobId} — the engine finalizes the partial within seconds`)
          dim(`follow: nodaro jobs get ${jobId}`)
        } else {
          success(`job ${jobId} had not started — cancelled with a full refund`)
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("continue <jobId>")
    .description(
      "continue a stopped/failed/completed run as a NEW job — reuses the delivered segments, regenerates from --from-segment on (default: the first missing one); billed only for the regenerated segments",
    )
    .option("--from-segment <n>", "1-based segment to regenerate from (overrides everything from that point)", (v) => parseInt(v, 10))
    .option("--watch", "poll the new job until it finishes")
    .option("--poll-interval <ms>", "poll interval with --watch", (v) => parseInt(v, 10))
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        jobId: string,
        opts: GlobalOpts & { fromSegment?: number; watch?: boolean; pollInterval?: number },
      ) => {
        try {
          const client = buildClient(opts.profile)
          const result = await client.videoPro.continueRun(jobId, {
            ...(opts.fromSegment !== undefined ? { fromSegment: opts.fromSegment } : {}),
          })
          await reportQueuedJob({ jobId: result.jobId }, () => client.jobs.getStatus(result.jobId), {
            json: opts.json,
            watch: opts.watch,
            pollInterval: opts.pollInterval,
            note: result.fromSegment !== undefined ? `continues ${jobId} from segment ${result.fromSegment}` : `continues ${jobId}`,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
