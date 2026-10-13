/**
 * UGC Creator's round, the one implementation both engines run (the workflow
 * orchestrator and the editor's canvas): the options a sampled creator's
 * answer asks for, each through its own pipeline (its image, then the gender
 * check) at the same time, and what the round does with what came back.
 *
 * - An option whose image job was blocked by moderation is dropped silently.
 *   When EVERY rendered option was blocked, the round's one fallback runs once;
 *   its image is the single option. Blocked again → the image route's own error.
 * - Any other failure beside an option that passed: the survivors are offered,
 *   with a note (`optionFailed`). With no survivor and nothing checked, that
 *   failure is the round's answer.
 * - A refusal that means the run cannot pay (`UGC_SPEND_REFUSAL_CODES`: an
 *   empty wallet, a daily limit, an allowance, a workspace budget or cap…) on
 *   any job of any option stops the round: no fallback, no re-call; the
 *   options that already passed are kept (`UgcCreatorRoundStopped`).
 * - A gender miss drops the option silently. When an option was checked and
 *   none passed, the builder is called once more, silently — the next seed,
 *   this round's traits as `previous` — and the new round is judged the same
 *   way. None passing twice → the check's refusal, verbatim.
 *
 * Where nobody can pick (`personPicks` false) only the primary is drawn: the
 * one-option case of every rule above. An answer from before options were
 * offered draws its `image` alone, whoever runs it.
 *
 * Content-free: the calls are read through the shared reader
 * (`ugcCreatorCandidates`); the checks' `passToken` / `refusal`, the answer's
 * `seed` and `traits` are passed on unread.
 */
import {
  UGC_NEWER_APP_MESSAGE,
  ugcCallToRouteBody,
  ugcCreatorCallsToRender,
  ugcCreatorCandidate,
  ugcCreatorCandidates,
  type UgcCreatorCall,
  type UgcCreatorCandidate,
  type UgcToolCall,
} from "@nodaro/shared"

/** An option whose image job finished without an image. */
export const UGC_CREATOR_NO_IMAGE_MESSAGE = "The creator image job finished without an image."

/**
 * The refusals that mean the run cannot pay for a job, by the route's stable code: a credits
 * stop (the round stops, keeping only the options already checked), never an option that
 * failed. One list for both engines. Faults (a shared wallet that is down), blocks, storage and
 * rate limits are not here: they are an option that failed.
 */
export const UGC_SPEND_REFUSAL_CODES: ReadonlySet<string> = new Set([
  // The wallet or pool cannot cover the job — also the free and paid tiers' daily limits and an
  // app run's free allowance, which the credit guard answers with this code.
  "insufficient_credits",
  // An app run's free allowance, as the app runner refuses it.
  "insufficient_app_credits",
  // A deployment's per-user allowance.
  "user_allowance_exceeded",
  // The workspace budget, and a member's credit cap in the workspace.
  "budget_exceeded",
  "member_cap_exceeded",
  // A shared wallet that refused the charge.
  "external_wallet_denied",
  // A connected instance's monthly spend cap.
  "instance_cap_reached",
  // Credits that cannot be spent on this surface.
  "subscription_required",
])

/** What each engine supplies: its own calls, and how it recognises a credits refusal and a stopping run. */
export interface UgcCreatorRoundDeps {
  /**
   * One builder call as its public job, with the previous step's image where the call takes one;
   * rejects with the job's error. `step` names the call within the node's run — its round, its
   * option and its place in the option's pipeline — so an engine can key the job on it.
   */
  child(call: UgcToolCall, image?: string, step?: string): Promise<{ readonly imageUrl?: string; readonly text?: string }>
  /** `POST /v1/ugc/creator` with this body (each engine adds the user); resolves with the answer. */
  builder(body: Record<string, unknown>): Promise<Record<string, unknown>>
  /** This engine's credits refusal: a child route answered that the run cannot pay (`UGC_SPEND_REFUSAL_CODES`). */
  isInsufficientCredits(err: unknown): boolean
  /** The run itself is stopping (a cancel, a drain): the round ends at once and the error goes on untouched. */
  isAbort?(err: unknown): boolean
}

export type UgcCreatorRoundResult =
  /** One option passed: hand this creator on, as a single draw does. */
  | { readonly kind: "one"; readonly answer: Record<string, unknown>; readonly images: readonly string[]; readonly optionFailed: boolean }
  /** Two or more passed: they wait for the person's pick. */
  | { readonly kind: "pick"; readonly candidates: readonly UgcCreatorCandidate[]; readonly optionFailed: boolean }

/** The round stopped on a credits refusal (`UGC_SPEND_REFUSAL_CODES`): `refusal` is the engine's own error; `candidates` passed their check before it. */
export class UgcCreatorRoundStopped extends Error {
  constructor(
    readonly refusal: unknown,
    readonly candidates: readonly UgcCreatorCandidate[],
  ) {
    super(refusal instanceof Error ? refusal.message : "Insufficient credits")
    this.name = "UgcCreatorRoundStopped"
  }
}

/** A moderation block of a child image job: the image route's classified hint, never the message text. */
export const isUgcModerationBlock = (err: unknown): boolean =>
  !!err && typeof err === "object" && (err as { errorHint?: { kind?: unknown } }).errorHint?.kind === "safety-block"

/** A creator check (the gender check, the photo check): one image reading; it passes when the reading, trimmed, starts with `passToken`. */
export interface UgcCreatorCheck extends UgcToolCall {
  readonly passToken: string
  readonly refusal: string
}

type Outcome =
  | { readonly kind: "passed"; readonly images: readonly string[] }
  | { readonly kind: "missed" }
  | { readonly kind: "blocked" | "failed" | "insufficient"; readonly error: unknown }

type Obj = Record<string, unknown>
const isObject = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x)

/** Any image will do for asking whether a call maps: the mapping only needs one to be there. */
const SOME_IMAGE = "image"

/** A call this app can run: its tool maps onto a public route (given an image where the call takes one). */
const runnable = (call: UgcToolCall, image?: string): boolean => {
  const mapped = ugcCallToRouteBody(call, image ? { image } : {})
  return mapped !== undefined && !("error" in mapped)
}

/** One of the answer's per-option steps (realism pass, second frame): null or a call that runs on an image. */
function stepOf(raw: unknown): UgcToolCall | null | undefined {
  if (raw === null || raw === undefined) return null
  if (!isObject(raw) || typeof raw.tool !== "string" || !isObject(raw.args)) return undefined
  const call = raw as unknown as UgcToolCall
  return runnable(call, SOME_IMAGE) ? call : undefined
}

/**
 * A creator check as an answer gives it: null when there is none, undefined when the app cannot
 * run it (a tool it does not know, no pass token, no refusal), else the check.
 */
export function ugcCreatorCheck(raw: unknown): UgcCreatorCheck | null | undefined {
  const call = stepOf(raw)
  if (call === null || call === undefined) return call
  const { passToken, refusal } = raw as { passToken?: unknown; refusal?: unknown }
  if (typeof passToken !== "string" || passToken === "" || typeof refusal !== "string") return undefined
  return raw as UgcCreatorCheck
}

interface Pipeline {
  readonly realism: UgcToolCall | null
  readonly secondFrame: UgcToolCall | null
  readonly check: UgcCreatorCheck | null
}

/** A check passes when its reading, trimmed, starts with the check's pass token. */
export const ugcCreatorCheckPasses = (text: string | undefined, check: UgcCreatorCheck): boolean =>
  (text ?? "").trim().startsWith(check.passToken)

/** One option: its image; then its realism pass and second frame, when the answer has them; then its check. */
async function option(call: UgcCreatorCall, pipeline: Pipeline, name: string, deps: UgcCreatorRoundDeps): Promise<Outcome> {
  const failure = (err: unknown, imageJob: boolean): Outcome => {
    if (deps.isAbort?.(err)) throw err
    if (deps.isInsufficientCredits(err)) return { kind: "insufficient", error: err }
    if (imageJob && isUgcModerationBlock(err)) return { kind: "blocked", error: err }
    return { kind: "failed", error: err }
  }
  let image: string | undefined
  try {
    image = (await deps.child(call, undefined, `${name}-image`)).imageUrl
  } catch (err) {
    return failure(err, true)
  }
  if (!image) return { kind: "failed", error: new Error(UGC_CREATOR_NO_IMAGE_MESSAGE) }
  try {
    const first = pipeline.realism ? ((await deps.child(pipeline.realism, image, `${name}-realism`)).imageUrl ?? image) : image
    const second = pipeline.secondFrame ? (await deps.child(pipeline.secondFrame, first, `${name}-frame2`)).imageUrl : undefined
    const images = second ? [first, second] : [first]
    if (!pipeline.check) return { kind: "passed", images }
    const reading = await deps.child(pipeline.check, first, `${name}-check`)
    return ugcCreatorCheckPasses(reading.text, pipeline.check) ? { kind: "passed", images } : { kind: "missed" }
  } catch (err) {
    return failure(err, false)
  }
}

/**
 * One answer's round: every option it renders at once, and the fallback once when every one was
 * blocked. Every call the round could make is checked first, so an answer the app cannot run is
 * refused before any job.
 */
async function round(answer: Obj, attempt: number, deps: UgcCreatorRoundDeps, personPicks: boolean): Promise<readonly Outcome[]> {
  const read = ugcCreatorCandidates(answer)
  if ("error" in read) throw new Error(read.error)
  const calls = ugcCreatorCallsToRender(read, { personPicks })
  const realism = stepOf(answer.realismPass)
  const secondFrame = stepOf(answer.secondFrame)
  const check = ugcCreatorCheck(answer.genderCheck)
  if (calls.length === 0 || !calls.every((call) => runnable(call)) || realism === undefined || secondFrame === undefined || check === undefined) {
    throw new Error(UGC_NEWER_APP_MESSAGE)
  }
  const pipeline: Pipeline = { realism, secondFrame, check }
  const outcomes = await Promise.all(calls.map((call, slot) => option(call, pipeline, `r${attempt}-c${slot}`, deps)))
  if (!outcomes.every((o) => o.kind === "blocked")) return outcomes
  const firstBlock = (outcomes[0] as { readonly error: unknown }).error
  if (!read.fallback || !runnable(read.fallback)) throw firstBlock
  const fallback = await option(read.fallback, pipeline, `r${attempt}-fallback`, deps)
  // Blocked again: the node fails with the image route's own message; nothing is retried.
  if (fallback.kind === "blocked") throw fallback.error
  return [fallback]
}

/** The builder's re-call: the next seed (when the answer names one), this round's traits as `previous`. */
function redraw(request: Obj, answer: Obj): Obj {
  const { seed: _seed, ...rest } = request
  const source = isObject(request.source) ? request.source : {}
  const seed = answer.seed
  return {
    ...rest,
    ...(typeof seed === "number" && Number.isInteger(seed) && seed >= 0 ? { seed: (seed + 1) % 2 ** 31 } : {}),
    source: { ...source, ...(isObject(answer.traits) ? { previous: answer.traits } : {}) },
  }
}

/**
 * A sampled creator, on either engine: render the round's options (every one where a person
 * picks, else the primary), keep the ones that pass, and re-call the builder once, silently,
 * when the check dropped every option it judged. `first` is the builder's answer to `request`.
 */
export async function runUgcCreatorRound(
  first: Record<string, unknown>,
  request: Record<string, unknown>,
  deps: UgcCreatorRoundDeps,
  opts: { readonly personPicks: boolean },
): Promise<UgcCreatorRoundResult> {
  let answer: Obj = first
  for (let attempt = 0; ; attempt++) {
    const outcomes = await round(answer, attempt, deps, opts.personPicks)
    const passed = outcomes.flatMap((o) => (o.kind === "passed" ? [o.images] : []))
    const roundAnswer = answer
    const keep = (): UgcCreatorCandidate[] => passed.map((images) => ugcCreatorCandidate(roundAnswer, images))
    const stop = outcomes.find((o) => o.kind === "insufficient")
    if (stop && "error" in stop) throw new UgcCreatorRoundStopped(stop.error, keep())
    const failed = outcomes.find((o) => o.kind === "failed")
    const optionFailed = failed !== undefined && passed.length > 0
    if (passed.length >= 2) return { kind: "pick", candidates: keep(), optionFailed }
    if (passed.length === 1) return { kind: "one", answer, images: passed[0]!, optionFailed }
    // Nothing passed. With no option checked, a failure is the round's answer. With one checked
    // and missed, the builder is called again, whatever happened to the others.
    const checked = outcomes.some((o) => o.kind === "missed")
    if (!checked && failed && "error" in failed) throw failed.error
    const check = answer.genderCheck as UgcCreatorCheck
    if (attempt === 1) throw new Error(check.refusal)
    answer = await deps.builder(redraw(request, answer))
  }
}
