import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { dim, emit, info, success, terminalSafe, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * `nodaro cast-swap full-quality estimate|run <jobId>`: spending is its own
 * subcommand (as in `nodaro trends`), so a quote can never start a run.
 */
function fullQualityCommand(): Command {
  const cmd = new Command("full-quality").description(
    "finish a draft run (Cast Swap or trend) at Full Quality: the same take at 1080p, as a new job — `estimate` quotes it (free), `run` SPENDS CREDITS",
  )

  cmd
    .command("estimate <jobId>")
    .description("quote finishing the draft at Full Quality (free): the credits, and until when the draft can be finished")
    .option("--profile <name>")
    .option("--json")
    .action(async (jobId: string, opts: GlobalOpts) => {
      try {
        const quote = await buildClient(opts.profile).castSwap.fullQualityEstimate(jobId)
        if (opts.json) {
          emit(quote, opts)
          return
        }
        info(`about ${quote.totalCredits} credits`)
        dim(`  castSwap: ${quote.breakdown.castSwap}`)
        dim(`  seedanceHd: ${quote.breakdown.seedanceHd}`)
        if (quote.breakdown.seedanceHd === 0) dim("  an earlier try's 1080p render is reused")
        dim(`available until ${terminalSafe(quote.availableUntil)}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run <jobId>")
    .description("start Full Quality — SPENDS CREDITS; run `estimate` first. Prints the job to follow")
    .option("--session <id>", "a generation session of yours to file the result in")
    .option("--profile <name>")
    .option("--json")
    .action(async (jobId: string, opts: { session?: string } & GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).castSwap.fullQuality(
          jobId,
          opts.session !== undefined ? { sessionId: opts.session } : {},
        )
        if (opts.json) {
          emit(result, opts)
          return
        }
        const id = terminalSafe(result.jobId)
        if (result.existing) info(`this draft's Full Quality already exists — job ${id} (nothing new was charged)`)
        else success(`started Full Quality — job ${id}`)
        dim(`follow it: nodaro jobs get ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

export function castSwapCommand(): Command {
  const cmd = new Command("cast-swap").description("Cast Swap — replace who and what is in a short video (Cloud edition)")
  cmd.addCommand(fullQualityCommand())
  return cmd
}
