/**
 * A run's unpriced part (`RunCreditLine.unpriced`): a metered LLM call the
 * server refuses to price (`llm_model_unpriced`). Its own module, so every
 * surface that totals a run's lines reads one rule (the run estimate, the UGC
 * run figure, the run-set price) whatever a test stubs of the estimator.
 */
import type { RunCreditLine } from "./types"

/** A run's unpriced part, when it has one: the total leaves that node out, and the run would be refused. */
export interface RunUnpriced {
  /** The server's sentence for the refusal (`llm_model_unpriced`), when it gave one. */
  readonly message?: string
}

/**
 * Whether any of a run's lines is a metered LLM call the server refuses to price
 * (`llm_model_unpriced`): its total then leaves that node out — it is no price
 * for the run, which the server refuses before it starts — and every surface that
 * shows the total says so, with the server's own sentence.
 */
export function runLinesUnpriced(lines: ReadonlyArray<Pick<RunCreditLine, "unpriced" | "unpricedMessage">>): RunUnpriced | undefined {
  const line = lines.find((l) => l.unpriced === true)
  if (!line) return undefined
  return line.unpricedMessage ? { message: line.unpricedMessage } : {}
}
