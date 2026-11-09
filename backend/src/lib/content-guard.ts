/**
 * THE CONTENT GUARD: a request whose content combines a minor with sexual or
 * nudity content is refused, on every generation lane, before any credit is
 * reserved and before any provider is called.
 *
 * Content-free, like the three deployment policy seams it sits beside
 * (`lib/prompt-policy.ts`, `lib/upload-policy.ts`, `lib/job-policy.ts`): the
 * words are the deployment's, inside the guard it registers; none of them are
 * in this repository. With no guard registered every funnel below returns at
 * its first line and the platform is byte-identical.
 *
 * WHY NOT JUST THE JOB-POLICY REQUEST GATE. That gate sits at the job insert,
 * and a job row does not always hold what the provider will be sent: a workflow
 * run's row is a placeholder, a route assembles the final prompt from fields and
 * pickers, a plugin assembles its own prompts mid-run. So the guard is asked at
 * each place the request's content is final, through ONE function:
 *
 *   - the prompt funnel (`applyPromptPolicies`): every final prompt, including
 *     prefix, suffix and field mappings, on every route, worker and workflow
 *     step (`prompt-policy-totality.test.ts` holds that), and through
 *     `tk.prompts.applyPolicies` every prompt a plugin sends;
 *   - the insert funnel (`gateJobInsert`): whatever a row carries, which is how
 *     a lane with no prompt to police is still judged on what text it has;
 *   - the workflow engine (`node-executor.ts`): the built payload of a workflow
 *     step, whose row was a placeholder at the insert. Before the reservation.
 *
 * `content-guard-totality.test.ts` fails the build if any of these stops
 * asking.
 *
 * A refusal is the request gate's own shape (`job_blocked`, 422 on a route), so
 * every creator and client that handles a policy block already handles this.
 * It is recorded in `job_policy_decisions` with a hash of the text, never the
 * text, and nothing the request said is logged or echoed.
 */
import {
  JobBlockedError,
  PLATFORM_POLICY_ID,
  POLICY_UNAVAILABLE_MESSAGE,
  POLICY_UNAVAILABLE_REASON,
  type InsertJobBlock,
} from "./job-policy.js"
import type { PromptAssembly } from "./prompt-policy.js"
import { subjectOfAssembly } from "./content-guard-subject.js"
import { currentRequestUserId } from "./request-user-scope.js"
import { getJobUserId } from "./job-cancellation.js"

/** The id a refusal of this guard carries, beside the platform's other rules. */
export const CONTENT_GUARD_POLICY_ID = "platform:content-guard"

/** What the person who asked is told. Names no rule and no word on purpose. */
export const CONTENT_GUARD_MESSAGE = "This request isn't allowed under our content rules."

/** The audit reason for a request too large to read in full. */
const OVER_LIMIT_REASON = "content-guard:over-limit"

/** What a guard is asked. `minorSignal` is what the catalog and the structured fields say, and only that. */
export interface ContentGuardSubject {
  readonly texts: readonly string[]
  readonly minorSignal: boolean
  readonly kind?: PromptAssembly["kind"]
  /** The request is too large to read in full: it is refused, and the guard is never asked about part of it. */
  readonly overLimit?: boolean
}

export type ContentGuardVerdict =
  | { readonly refused: false }
  /** `reason` is MACHINE text for the audit row: never words from the request, and never shown to a person. */
  | { readonly refused: true; readonly reason: string }

export interface ContentGuard {
  readonly id: string
  check(subject: ContentGuardSubject): ContentGuardVerdict
  /**
   * Proof that this guard can refuse anything: true only when it has its word
   * lists and its own `check` refuses a combination drawn from them. Asked once,
   * at registration, so `hasContentGuard()` means a working guard and not merely
   * a module that loaded.
   */
  proveReady(): boolean
}

let activeGuard: ContentGuard | null = null

function provesReady(guard: ContentGuard): boolean {
  try {
    return typeof guard.proveReady === "function" && guard.proveReady() === true
  } catch {
    return false
  }
}

/** Register the deployment's guard. One per deployment; a second replaces the first. Throws for a guard that cannot prove itself. */
export function registerContentGuard(guard: ContentGuard): void {
  if (!provesReady(guard)) throw new Error(`"${guard.id}" could not prove it can refuse anything`)
  activeGuard = guard
}

/** Test hook: back to no guard. */
export function clearContentGuard(): void {
  activeGuard = null
}

/** True when this process has a guard that proved it works: what makes the funnels below do anything. */
export function hasContentGuard(): boolean {
  return activeGuard !== null
}

/** The registered guard's id, or null. */
export function getContentGuardId(): string | null {
  return activeGuard?.id ?? null
}

/** Where a request is being asked about, and whose it is, for the audit row and the log line. */
export interface ContentGuardContext {
  readonly lane: string
  readonly userId?: string | null
  readonly jobType?: string | null
}

/**
 * In-flight audit writes. The refusal must not wait on the audit (the prompt
 * funnel is synchronous, and an audit failure is never a reason to change the
 * answer), so the write runs beside it; tracking the promise makes it
 * awaitable for a test.
 */
const pendingAudits = new Set<Promise<unknown>>()

function recordRefusal(
  subject: ContentGuardSubject,
  ctx: ContentGuardContext,
  policyId: string,
  reason: string,
  userMessage: string,
): void {
  // Loaded here, not at the top: this module sits in the import graph of every
  // route through the prompt funnel, and only a refusal ever needs the audit.
  const write = import("./job-policy-audit.js")
    .then(({ recordJobPolicyDecision, hashGateSubject }) =>
      recordJobPolicyDecision({
        jobId: null,
        hookPoint: "request",
        policyId,
        verdict: "block",
        reason,
        userMessage,
        payloadHash: hashGateSubject({ texts: subject.texts, minorSignal: subject.minorSignal, kind: subject.kind ?? null }),
        userId: ctx.userId ?? null,
        jobType: ctx.jobType ?? null,
      }),
    )
    .catch((err: unknown) => {
      console.warn(`[content-guard] the refusal could not be recorded: ${err instanceof Error ? err.message : String(err)}`)
    })
  pendingAudits.add(write)
  void write.finally(() => pendingAudits.delete(write))
}

/** Test hook: settle every audit write started so far. */
export async function __flushContentGuardAuditForTests(): Promise<void> {
  while (pendingAudits.size > 0) await Promise.allSettled([...pendingAudits])
}

/**
 * Ask the guard about one subject. Returns the block to answer with, or null to
 * go on. Synchronous on purpose: the prompt funnel is, and a word list needs
 * nothing else.
 *
 * FAIL CLOSED, as the job-policy registry is: a guard that throws refuses, in
 * the platform's own words, so a broken check never reads as a judgement about
 * someone's prompt and never lets a request past.
 */
export function refuseProhibitedContent(subject: ContentGuardSubject, ctx: ContentGuardContext): InsertJobBlock | null {
  const guard = activeGuard
  if (!guard) return null

  if (subject.overLimit) {
    console.warn(`[content-guard] refused a request too large to read on lane ${ctx.lane}${ctx.userId ? ` (user ${ctx.userId})` : ""}`)
    recordRefusal(subject, ctx, PLATFORM_POLICY_ID, OVER_LIMIT_REASON, POLICY_UNAVAILABLE_MESSAGE)
    return { code: "job_blocked", policyId: PLATFORM_POLICY_ID, message: POLICY_UNAVAILABLE_MESSAGE }
  }

  let refusedReason: string | null = null
  try {
    const verdict = guard.check(subject)
    if (!verdict.refused) return null
    refusedReason = verdict.reason
  } catch (err) {
    console.error(`[content-guard] guard "${guard.id}" threw on lane ${ctx.lane}, refusing: ${err instanceof Error ? err.message : String(err)}`)
    recordRefusal(subject, ctx, PLATFORM_POLICY_ID, POLICY_UNAVAILABLE_REASON, POLICY_UNAVAILABLE_MESSAGE)
    return { code: "job_blocked", policyId: PLATFORM_POLICY_ID, message: POLICY_UNAVAILABLE_MESSAGE }
  }

  // The lane and the owner, never a word the request said.
  console.warn(`[content-guard] refused a request on lane ${ctx.lane}${ctx.userId ? ` (user ${ctx.userId})` : ""}`)
  recordRefusal(subject, ctx, CONTENT_GUARD_POLICY_ID, refusedReason, CONTENT_GUARD_MESSAGE)
  return { code: "job_blocked", policyId: CONTENT_GUARD_POLICY_ID, message: CONTENT_GUARD_MESSAGE }
}

/**
 * The prompt funnel's check (`applyPromptPolicies`). Throws `JobBlockedError`
 * for a refusal: a route answers 422 through the root error handler, a worker
 * fails the job and refunds, the workflow engine fails the node, and a plugin's
 * provider member stops before the provider is called.
 */
export function guardAssembledPrompt(a: PromptAssembly): void {
  if (!activeGuard) return
  const block = refuseProhibitedContent(subjectOfAssembly(a), {
    lane: `prompt:${a.kind}`,
    userId: currentRequestUserId() ?? getJobUserId() ?? null,
  })
  if (block) throw new JobBlockedError(block)
}
