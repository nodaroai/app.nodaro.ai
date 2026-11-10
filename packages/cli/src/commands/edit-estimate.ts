// `--estimate` on `nodaro edit`'s use-case node commands (tighten-episode,
// episode-chapters, episode-trailer, clip-pack, speaker-layout): the same flags
// as the run, sent to the type's `/estimate` route instead, so the quote is for
// exactly the run the same command line would start. Its own module so
// edit-use-case.ts keeps to the run commands.
import type { UseCaseEstimate } from "@nodaro/sdk/edit"
import { dim, emit, success } from "../output.js"
import type { GlobalOpts } from "./edit-shared.js"

/** The help of the `--estimate` flag every use-case command takes. */
export const ESTIMATE_HELP =
  "quote the run only: what these flags would be charged, with nothing created or charged (--watch and --idempotency-key are not used)"

/** "1 h 05 min", "12 min 30 s", "40 s": a recording's length as the quote read it. */
function lengthOf(sec: number): string {
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`
  if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`
  return `${s} s`
}

/**
 * Print a use-case quote: the route's figures as they are under --json, else
 * one line (`≈` when a step is a metered estimate) and the recording's length.
 * An edition without credits answers every figure 0: that is said, not quoted.
 */
export function reportUseCaseEstimate(label: string, quote: UseCaseEstimate, opts: GlobalOpts): void {
  if (opts.json) {
    emit(quote, opts)
    return
  }
  const approx = quote.estimate ? "≈" : ""
  if (quote.totalCredits === 0 && quote.stepsCredits === 0 && quote.feeCredits === 0) {
    success(`${label}: not billed in credits on this edition`)
  } else {
    success(`${label} is estimated at ${approx}${quote.totalCredits} credits (its steps ${approx}${quote.stepsCredits} + the per-run fee ${quote.feeCredits})`)
  }
  dim(quote.durationSec === null ? "the recording's length could not be read" : `the recording is ${lengthOf(quote.durationSec)}`)
  dim("nothing was created or charged")
}
