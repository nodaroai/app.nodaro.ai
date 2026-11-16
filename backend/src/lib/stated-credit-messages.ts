/**
 * THE ONE PLACE a failure sentence that names a credit figure is worded
 * (decided 2026-11-15): a balance check's refusal, a reservation the database
 * refused, a hold the balance can not cover, a charged failure. So is a
 * refusal saved the same way that advises a purchase (decided 2026-11-16).
 *
 * These sentences are SAVED with the run — `jobs.error_message`, a node's
 * `error` in `node_states`, the execution's `error_message` — and every reader
 * hands them on as saved: the MCP job tools (an MCP client is a language
 * model and repeats the figure it reads), the editor, the REST reads. So the
 * figure is stated in the deployment's terms when the sentence is WRITTEN,
 * once, rather than rewritten by each reader: no reader parses these figures
 * back out of the text (they take `required` / `balance` as fields), and the
 * unit is deployment-wide, so what is written is what every reader should show.
 *
 * WITH NOTHING CONFIGURED (no unit, no external wallet, self-serve on) every
 * function returns exactly the sentence it replaced, byte for byte
 * (`ee/billing/__tests__/stored-credit-messages.test.ts` holds the recording).
 *
 * WHATEVER IS CONFIGURED, a balance that is not the requester's own (a
 * deployment payer's pool, `BalanceSeen.payerPool`) is never stated: a
 * deployment payer can be set with no unit, no external wallet and self-serve
 * on, and the operator's pool is not its users' to read there either.
 *
 * On a deployment in its own terms (`ownTermsActive()`, `lib/mcp/amounts.ts`):
 *  - every figure is converted into the deployment's unit and named with the
 *    unit's word (credits where it has none), through the same conversion
 *    every other surface uses (`toUnits`); the rate is never stated;
 *  - a balance that is not the requester's own (a deployment payer's pool) is
 *    never stated: the requester is told what the run needs, not what the
 *    operator holds;
 *  - a sentence keeps the word "Insufficient" and names the balance, so the
 *    readers that classify a failure by its words (`diagnose_run`, the
 *    orchestrator's metered-hold catch) reach the same verdict;
 *  - no purchase advice is added, and a sentence that carries some (the free
 *    tier's daily cap, and the refusals below: the storage limit, a model the
 *    plan may not run, a video beyond the free-credit limits) keeps it only
 *    where self-serve is on. Without self-serve the advice is dropped, and a
 *    sentence it would leave with no next step ends with what is true there
 *    (delete files; the model is not available on this account). The words a
 *    failure reader classifies by are kept, so each is classified as before.
 *
 * Core code (every edition, no `ee/` import): the producers in `ee/billing`,
 * the routes and the workflow engine all word their sentences here.
 * `__tests__/stated-credit-messages-totality.test.ts` fails a sentence that
 * names a credit figure anywhere else in the backend.
 */
import type { FreeVideoLock } from "@nodaro/render-rules"
import { toUnits } from "./billing-display-unit.js"
import { amountTerms, ownTermsActive, type AmountTerms } from "./mcp/amounts.js"

/** The deployment's terms, as a sentence states a figure in them. */
interface Stating {
  /** `n` in the deployment's unit, as text. */
  readonly figure: (n: number) => string
  /** The unit's word, or "credits". */
  readonly word: string
  readonly selfServe: boolean
}

/** Null with nothing configured: the caller writes the sentence it always wrote. */
function stating(t: AmountTerms = amountTerms()): Stating | null {
  if (!ownTermsActive(t)) return null
  const u = t.unit
  return {
    figure: (n) => {
      const shown = u === null ? n : toUnits(n, u.rate, u.decimals)
      return shown === null ? "an unavailable amount of" : String(shown)
    },
    word: u?.label ?? "credits",
    selfServe: t.selfServe,
  }
}

/** Whose balance a refusal measured: the requester's own pool, or one it may not see (a deployment payer's). */
export interface BalanceSeen {
  /** True when the balance is a deployment payer's pool, not the requester's. */
  readonly payerPool?: boolean
}

/** The balance check's refusal: the run's price over what the payer has. */
export function insufficientCreditsMessage(required: number, available: number, seen: BalanceSeen = {}): string {
  const s = stating()
  if (!s) return seen.payerPool ? `Insufficient credits. Required: ${required}` : `Insufficient credits. Required: ${required}, Available: ${available}`
  const need = `Insufficient balance. Required: ${s.figure(required)} ${s.word}`
  return seen.payerPool ? `${need}.` : `${need}, Available: ${s.figure(available)} ${s.word}`
}

/** A consumer surface spends the free pool only, and it can not cover the run. */
export function freePoolShortfallMessage(need: number, freePool: number): string {
  const s = stating()
  if (!s) return `Your free credits can't cover this run (need ${need}, free pool has ${freePool}).`
  return `Your free balance can't cover this run (need ${s.figure(need)} ${s.word}, free pool has ${s.figure(freePool)} ${s.word}).`
}

/** An app run on the free tier, short of the app allowance it earned. */
export function appCreditsShortfallMessage(have: number, need: number): string {
  const s = stating()
  if (!s) return `Insufficient app credits. You have ${have} app credits but need ${need}. Earn app credits by running flows in the editor.`
  return `Insufficient app balance. You have ${s.figure(have)} ${s.word} of app balance but need ${s.figure(need)} ${s.word}. Earn more by running flows in the editor.`
}

/** The free tier's daily cap, reached. */
export function freeTierDailyLimitMessage(limit: number, spentToday: number): string {
  const s = stating()
  if (!s) return `Daily credit limit reached for free tier. Limit: ${limit}, Spent today: ${spentToday}. Upgrade for higher limits.`
  return `Daily limit reached for free tier. Limit: ${s.figure(limit)} ${s.word}, Spent today: ${s.figure(spentToday)} ${s.word}.${s.selfServe ? " Upgrade for higher limits." : ""}`
}

/** A paid tier's daily cap, reached. */
export function dailyLimitMessage(limit: number, spent: number): string {
  const s = stating()
  if (!s) return `Daily credit limit reached. Limit: ${limit}, Spent: ${spent}`
  return `Daily limit reached. Limit: ${s.figure(limit)} ${s.word}, Spent: ${s.figure(spent)} ${s.word}`
}

/** A metered call's hold the balance can not cover: how much the run may need. */
export function holdShortfallMessage(holdCredits: number): string {
  const s = stating()
  if (!s) return `Needs up to ${holdCredits} credits`
  return `Needs up to ${s.figure(holdCredits)} ${s.word}`
}

/**
 * A use-case run's estimate over the balance: `subject` is the run as the
 * sentence names it ("This episode is", "Continuing this episode is").
 */
export function estimateShortfallMessage(subject: string, totalCredits: number, balance: number): string {
  const s = stating()
  if (!s) return `${subject} estimated at about ${totalCredits} credits; your balance is ${balance}.`
  return `${subject} estimated at about ${s.figure(totalCredits)} ${s.word}; your balance is ${s.figure(balance)} ${s.word}.`
}

/** A continued use-case run whose renders hold more than its estimate, over the balance. */
export function continueHoldShortfallMessage(holdCredits: number, balance: number): string {
  const s = stating()
  if (!s) return `Continuing this episode can hold up to about ${holdCredits} credits while it renders; your balance is ${balance}.`
  return `Continuing this episode can hold up to about ${s.figure(holdCredits)} ${s.word} while it renders; your balance is ${s.figure(balance)} ${s.word}.`
}

/** A Render final whose hold the balance can not cover. */
export function renderFinalHoldShortfallMessage(holdCredits: number): string {
  const s = stating()
  if (!s) return `Render final can hold up to about ${holdCredits} credits while it renders.`
  return `Render final can hold up to about ${s.figure(holdCredits)} ${s.word} while it renders.`
}

/** A failed metered call that was charged (a route's structured call): `message`, then the charge. */
export function chargedRouteFailureMessage(message: string, charged: number): string {
  const s = stating()
  if (!s) return `${message} Charged ${charged === 1 ? "1 credit" : `${charged} credits`}: the model did billed work before it failed.`
  return `${message} Charged ${s.figure(charged)} ${s.word}: the model did billed work before it failed.`
}

/** A failed metered sync call that was charged: `message`, then the charge. */
export function chargedSyncFailureMessage(message: string, charged: number): string {
  const s = stating()
  if (!s) {
    return `${message} The AI provider had already processed the request, so ${charged} credit${charged === 1 ? "" : "s"} ${charged === 1 ? "was" : "were"} charged for the usage it billed.`
  }
  return `${message} The AI provider had already processed the request, so it was charged ${s.figure(charged)} ${s.word} for the usage it billed.`
}

/**
 * Whether a refusal may advise buying or upgrading: always with nothing
 * configured (it is today's sentence), and on a deployment in its own terms
 * only where self-serve purchase is on.
 */
function purchaseAdvised(): boolean {
  const s = stating()
  return !s || s.selfServe
}

/**
 * The storage limit, reached (the credit guard's 413, saved as the node's
 * failure by the engine's sync-HTTP and use-case lanes). `usedGB` / `limitGB`
 * are the figures as written ("2.4"). Without self-serve, deleting files is
 * what the user can do.
 */
export function storageLimitMessage(usedGB: string, limitGB: string): string {
  const reached = `Storage limit reached (${usedGB} GB of ${limitGB} GB used).`
  return purchaseAdvised() ? `${reached} Delete files or upgrade your plan.` : `${reached} Delete files to free up space.`
}

/** A model restricted to `tier` and up, refused below it (saved by the engine's preflight). */
export function modelTierRestrictedMessage(tier: string): string {
  const requires = `This model requires ${tier} tier or higher.`
  return purchaseAdvised() ? `${requires} Please upgrade your plan.` : `${requires} It is not available on this account.`
}

/**
 * A model on the free tier's blocklist, refused under free-tier semantics
 * (saved by the engine's preflight). Without self-serve no subscription can be
 * bought here, so the sentence does not name one.
 */
export function modelNeedsPaidPlanMessage(): string {
  return purchaseAdvised() ? "This model requires a paid subscription. Upgrade to Basic or higher." : "This model is not available on this account."
}

/**
 * A video request beyond the free-credit limits (saved by the engine's
 * preflight; the credit guard answers it as `free_video_limit`). Each lock
 * names the limit, which is the next step on its own; the advice to pay rides
 * only where self-serve is on.
 */
export function freeVideoLimitMessage(lock: FreeVideoLock): string {
  const paid = purchaseAdvised() ? " Upgrade or buy credits to use it." : ""
  switch (lock.kind) {
    case "model":
      return `${lock.label} is not available on free credits.${paid}`
    case "upscale":
      return `Upscaling video is not available on free credits.${paid}`
    case "extend":
      return `Extending video is not available on free credits.${paid}`
    case "shortest":
      return `On free credits videos are at most ${lock.max} seconds, and ${lock.label}'s shortest is ${lock.shortest}.${paid}`
    case "auto":
      return `On free credits pick a length of up to ${lock.max} seconds (not Auto).${paid}`
    case "duration":
      return `On free credits videos are at most ${lock.max} seconds.${paid}`
    case "resolution":
      return `On free credits ${lock.label} runs at ${lock.lowest} only.${paid}`
    case "size":
      return `On free credits ${lock.label} runs at the standard size only.${paid}`
  }
}

/** What a billed attempt was charged, as a clause after "You were charged" (empty while the charge is not settled). */
export function chargedAttemptClause(charged: number | undefined): string {
  if (charged === undefined) return ""
  const s = stating()
  if (!s) return charged === 1 ? " 1 credit" : ` ${charged} credits`
  return ` ${s.figure(charged)} ${s.word}`
}

/**
 * The reservation RPCs' refusals that carry figures, by their live wording
 * (`supabase/migrations`, held by the totality test): each one read into its
 * figures and worded like the check that answers it before the RPC.
 */
/** The reserve RPC's shortfall: what the run needs, and what the payer's pool has. */
const INSUFFICIENT_RESERVE = /^Insufficient credits: need (-?\d+(?:\.\d+)?), have (-?\d+(?:\.\d+)?)$/

const RESERVE_REFUSALS: ReadonlyArray<{ re: RegExp; stated: (m: RegExpExecArray, s: Stating, seen: BalanceSeen) => string }> = [
  {
    re: INSUFFICIENT_RESERVE,
    stated: (m, s, seen) => {
      const need = `Insufficient balance: need ${s.figure(Number(m[1]))} ${s.word}`
      return seen.payerPool ? need : `${need}, have ${s.figure(Number(m[2]))} ${s.word}`
    },
  },
  {
    re: /^Daily credit limit reached: limit (-?\d+(?:\.\d+)?), spent today (-?\d+(?:\.\d+)?), need (-?\d+(?:\.\d+)?)$/,
    stated: (m, s) => `Daily limit reached: limit ${s.figure(Number(m[1]))} ${s.word}, spent today ${s.figure(Number(m[2]))} ${s.word}, need ${s.figure(Number(m[3]))} ${s.word}`,
  },
  {
    re: /^Insufficient app credits: need (-?\d+(?:\.\d+)?), have (-?\d+(?:\.\d+)?)\. Earn app credits by running flows\.$/,
    stated: (m, s) => `Insufficient app balance: need ${s.figure(Number(m[1]))} ${s.word}, have ${s.figure(Number(m[2]))} ${s.word}. Earn more by running flows.`,
  },
  {
    // The marker stays: the route guard and the side-hold lane answer it with the subscription modal.
    re: /^SUBSCRIPTION_REQUIRED: web spending draws only free-pool credits: need (-?\d+(?:\.\d+)?), free pool has (-?\d+(?:\.\d+)?)$/,
    stated: (m, s) => `SUBSCRIPTION_REQUIRED: web spending draws only the free pool: need ${s.figure(Number(m[1]))} ${s.word}, free pool has ${s.figure(Number(m[2]))} ${s.word}`,
  },
  {
    re: /^Credits must be positive, got (-?\d+(?:\.\d+)?)$/,
    stated: () => "the amount to reserve must be positive",
  },
]

/** The RPC refusals `reservationFailedMessage` states, as their templates match them (for the totality test). */
export function statesReserveRefusal(rpcMessage: string): boolean {
  return RESERVE_REFUSALS.some(({ re }) => re.test(rpcMessage))
}

/**
 * What a reservation the database refused throws, from the RPC's own message.
 * With nothing configured, `Credit reservation failed: <the RPC's message>`,
 * as always. In the deployment's own terms a refusal that carries a credit
 * figure is stated in its unit (`RESERVE_REFUSALS`); any other message is
 * repeated as it is, since the catches above this one branch on its words
 * (`SUBSCRIPTION_REQUIRED:`, `SIDE_HOLD_CONFLICT:`, a unique violation). That
 * every refusal the reservation functions raise with a credit figure is one of
 * `RESERVE_REFUSALS` or a prefixed one `lib/reserve-errors.ts` translates is
 * held by the totality test, against the migrations. Whatever is configured, a
 * deployment payer's pool (`seen.payerPool`) is never repeated: the shortfall
 * keeps what the run needed and drops what the pool had.
 */
export function reservationFailedMessage(rpcMessage: string, seen: BalanceSeen = {}): string {
  const s = stating()
  if (!s) {
    const short = seen.payerPool ? INSUFFICIENT_RESERVE.exec(rpcMessage) : null
    return short ? `Credit reservation failed: Insufficient credits: need ${short[1]}` : `Credit reservation failed: ${rpcMessage}`
  }
  for (const { re, stated } of RESERVE_REFUSALS) {
    const m = re.exec(rpcMessage)
    if (m) return `Credit reservation failed: ${stated(m, s, seen)}`
  }
  return `Credit reservation failed: ${rpcMessage}`
}
