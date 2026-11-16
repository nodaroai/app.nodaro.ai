/**
 * A use-case route's refusal for want of balance — a run, a continue from a
 * failed step, a Render final: `402 insufficient_credits` with the route's own
 * message and, beside `error`, the figures that message states: `required`
 * (what the balance was checked against) and `balance` (what the payer has),
 * RAW credits. That is the credit guard's shape (`insufficientCreditsRefusal`,
 * ee/lib/credit-guard-impl.ts), so every reader of the guard's refusal reads
 * these too: the editor's not-enough-credits dialog (`creditsShortfallOf`),
 * the SDK's `InsufficientCreditsError`, the `app_reports` telemetry. The
 * message keeps the deployment's terms (lib/stated-credit-messages.ts) and the
 * figures stay raw, as the guard's do; the MCP lane words its refusal from the
 * message alone, never from these fields.
 *
 * The figures are withheld (the message alone, as before) where the guard
 * names no balance either, or where the figure is no price:
 *  - a deployment payer: its pool is the operator's;
 *  - a pay-as-you-go account on a web surface short of its free pool: the
 *    guard answers that with the subscription ask, never a balance;
 *  - a hold above the run's price (what a UGC clip holds while it renders):
 *    `required` would read as the run's price.
 *
 * Where the figures are stated, `estimate: true` rides beside them: `required`
 * is the run's estimate, never its price, and the run is charged what its steps
 * use. Always, for every use-case refusal, not only where a metered step makes
 * the estimate approximate: each is a quote the run is held to start with — a
 * render priced at the full recording, a clip at twice its target length, an
 * unknown length at the 180-minute ceiling — and what the steps then process
 * is what is charged. The editor's dialog says so under the figures.
 */

/** A use-case route's balance refusal: its message, and the figures it states unless they are withheld. */
export interface UseCaseShortfall {
  readonly message: string
  readonly figures?: { readonly required: number; readonly balance: number }
}

/**
 * The refusal worded from `required` and `balance` by `word`: the sentence and
 * the figures from the same two numbers, so they can not disagree. `withhold`
 * keeps the figures off the body; the sentence is the same either way.
 */
export function statedShortfall(
  required: number,
  balance: number,
  word: (required: number, balance: number) => string,
  withhold: boolean,
): UseCaseShortfall {
  return { message: word(required, balance), ...(withhold ? {} : { figures: { required, balance } }) }
}

/**
 * The 402 body: `{ error: { code, message } }`, with `required`, `balance` and
 * `estimate: true` beside it when the refusal states its figures.
 */
export function usecaseShortfallBody(refusal: UseCaseShortfall): {
  error: { code: "insufficient_credits"; message: string }
  required?: number
  balance?: number
  estimate?: true
} {
  return {
    error: { code: "insufficient_credits", message: refusal.message },
    ...(refusal.figures ? { required: refusal.figures.required, balance: refusal.figures.balance, estimate: true as const } : {}),
  }
}
