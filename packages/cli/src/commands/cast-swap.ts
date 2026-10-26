import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { dim, emit, info, success, terminalSafe, type OutputOpts } from "../output.js"
import { neutralQuote, quotePartLabel } from "../quote-parts.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * `nodaro cast-swap full-quality estimate|run <jobId>`: spending is its own
 * subcommand (as in `nodaro trends`), so a quote can never start a run.
 */
function fullQualityCommand(): Command {
  const cmd = new Command("full-quality").description(
    "finish a run (Nodaro Motion or trend) at Full Quality at 1080p, as a new job: a draft's same take, or a new take of a Nodaro Motion Pulse 720p run — `estimate` quotes it (free), `run` SPENDS CREDITS",
  )

  cmd
    .command("estimate <jobId>")
    .description("quote finishing the run at Full Quality (free): same or new take, the credits, and until when it can be finished")
    .option("--profile <name>")
    .option("--json")
    .action(async (jobId: string, opts: GlobalOpts) => {
      try {
        const quote = neutralQuote(await buildClient(opts.profile).castSwap.fullQualityEstimate(jobId))
        if (opts.json) {
          emit(quote, opts)
          return
        }
        info(`about ${quote.totalCredits} credits`)
        // An older engine sends no kind: its Full Quality is the same take.
        if (quote.kind === "new-take") dim("a NEW take at 1080p from the same inputs (the 720p run stays)")
        else dim("the same take at 1080p")
        for (const [part, credits] of Object.entries(quote.breakdown)) {
          if (typeof credits === "number") dim(`  ${terminalSafe(quotePartLabel(part))}: ${credits}`)
        }
        if (quote.kind !== "new-take" && quote.breakdown.motionHd === 0) dim("  an earlier try's 1080p render is reused")
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
        if (result.existing) info(`this run's Full Quality already exists — job ${id} (nothing new was charged)`)
        else success(`started Full Quality — job ${id}`)
        dim(`follow it: nodaro jobs get ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

export function castSwapCommand(): Command {
  const cmd = new Command("cast-swap").description("Nodaro Motion — replace who and what is in a short video (Cloud edition)")
  cmd.addCommand(fullQualityCommand())
  return cmd
}
