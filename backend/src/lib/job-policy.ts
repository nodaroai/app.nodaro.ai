/**
 * Job-policy registry (spec 2026-09-03-job-policy-hook-design §5.1).
 *
 * Mirrors `lib/upload-policy.ts` and `lib/prompt-policy.ts` EXACTLY, because
 * two of those already exist and are load-bearing and a third that reads
 * differently decays: an ORDERED list, CONTENT-FREE (the moderation service's
 * URL, timeouts and open/closed stance are the deployment's — inside its
 * registered policy, never in a package and never from `process.env` inside
 * one), registered once at the composition root or the overlay loader
 * (`lib/overlay/load.ts`, which runs in all five entrypoints, so both gates see
 * the same registry in every process that needs them).
 *
 * WITH NOTHING REGISTERED BOTH FUNNELS ARE BYTE-IDENTICAL: no gate call, no
 * extra row read, no audit row, no allocation. `hasJobPolicyFor(hook)` is the
 * fast path and it is per HOOK POINT, not per registry (D23) — a policy that
 * implements only `checkResult` (which is what the SAI overlay ships) must not
 * cost one dead `allow` row per job creation.
 *
 * FAIL-CLOSED BY CONTRACT ON BOTH HOOK POINTS. Once a policy IS registered, a
 * check that throws — or hangs past the backstop — DENIES. A request gate that
 * failed open is the bypass a hostile client engineers (stall the call); a
 * RESULT gate that failed open publishes unmoderated media, which is worse. The
 * two hooks fail closed in different directions on purpose (D20): a request has
 * nothing to preserve, so it blocks; a result has a finished, already-paid-for
 * generation, so it HOLDS when the job is hold-eligible and only blocks when it
 * cannot be parked. Hold is the only fallback that is wrong in a RECOVERABLE
 * direction. A deployment that prefers availability over enforcement catches
 * inside its own `check` and returns `{ verdict: "allow" }` itself — the escape
 * hatch upload-policy.ts documents at its lines 13-18. That is also why the
 * platform never THROWS a timeout at a policy (D21): a platform throw would
 * override the deployment's own `ON_ERROR` stance and make it unreachable.
 *
 * DEPENDENCY RULE (guarded by `__tests__/job-policy-imports.test.ts`): this
 * file imports nothing from `workers/` (which pulls `sharp`,
 * `youtube-dl-exec`, `@remotion/*`), nothing from `lib/queue.js` (eager
 * `new IORedis` at its line 5) and nothing from `ee/`. The APPLIER — which
 * does touch supabase, storage and credits — is `lib/job-policy-gate.ts`.
 */

export type JobPolicyHookPoint = "request" | "result"

/** Where a job came from — `jobs.source` (lib/job-source.ts). */
export type JobSource = string

export interface JobRequestContext {
  /** `row.job_type ?? input_data.type ?? null`. NOT always present: the video
   *  worker stamps `job_type` only at PICKUP and routes like generate-image
   *  insert none at all. Policies must tolerate null. */
  readonly jobType: string | null
  readonly userId: string | null
  /** Post-provenance — i.e. the value that will land on the row. */
  readonly source: JobSource | null
  readonly sourceDetail: string | null
  readonly provider?: string | null
  /** `input_data.provider` on entity/character rows is the MODEL id, not the
   *  vendor — the platform passes both and lets the policy decide. */
  readonly modelIdentifier?: string | null
  /** MAY BE A PLACEHOLDER for orchestrated children: the DAG inserts
   *  `{type, node_id}` and writes the real payload in a separate `.update()`
   *  outside the insert funnel. Check `workflowExecutionId` before judging
   *  content — for those jobs the RESULT gate is the enforcement point. */
  readonly inputData: Record<string, unknown>
  readonly workflowExecutionId?: string | null
  readonly parentJobId?: string | null
  readonly pipelineId?: string | null
  readonly mcpClient?: string | null
  /** How many rows this insert creates (`insertJobs`); 1 for the singular
   *  helpers. A batch is judged ALL-OR-NOTHING on the first row: it is one user
   *  action and a partial insert is worse than a whole denial. */
  readonly rowCount: number
}

/** One media URL found in a completion's `output_data`. */
export interface JobOutputRef {
  readonly role: "primary" | "variant" | "thumbnail" | "mask" | string
  /** `null` when the URL is not ours (an echoed INPUT URL, a provider CDN, a
   *  deployment whose `R2_PUBLIC_URL` is unset or served from a fallback
   *  domain). Only a non-null key that belongs to THIS job's key family is ever
   *  deleted or previewed. */
  readonly key: string | null
  readonly url: string
  readonly mime?: string
  readonly sizeBytes?: number
  readonly durationSeconds?: number
}

export interface JobResultContext {
  readonly jobId: string
  readonly jobType: string | null
  readonly mediaKind: "image" | "video" | "audio" | "other"
  readonly userId: string | null
  /** Always "completed" today. Present so a future funnel (a partial
   *  deliverable, say) can be distinguished without a signature change. */
  readonly statusToBe: "completed"
  /** Exactly `fields.output_data` — what the caller is about to publish. */
  readonly outputData: Record<string, unknown>
  /** EVERY http(s) URL in `outputData`, not only the ones we own — a policy
   *  that received an empty list for a real media job (because a deployment
   *  configured a fallback domain) and allowed it would silently fail open.
   *  `mediaKind` travels alongside so a policy can fail closed on "media kind,
   *  zero outputs". */
  readonly outputs: readonly JobOutputRef[]
  /** Sum of the job's `usage_logs` rows still `reserved`. */
  readonly creditsReserved?: number | null
  readonly provider?: string | null
  readonly durationMs?: number | null
  /** FALSE ⇒ a `hold` verdict is downgraded to `block`. Computed by the
   *  PLATFORM (D8), never by the policy: only the finalize funnel's tail is
   *  replayable on approve, and only an edition with an admin surface has a
   *  reviewer. A policy may read it to decide what `review` means for a job
   *  nobody can review. */
  readonly holdEligible: boolean
  /** Which funnel is asking. */
  readonly funnel: "finalize" | "direct"
}

export type JobRequestVerdict =
  | { readonly verdict: "allow" }
  | { readonly verdict: "block"; readonly reason: string; readonly userMessage?: string }

export type JobResultVerdict =
  | { readonly verdict: "allow" }
  /** Publish, but record the annotation. Never changes the row's status. */
  | { readonly verdict: "flag"; readonly reason: string; readonly labels?: readonly string[] }
  | { readonly verdict: "block"; readonly reason: string; readonly userMessage?: string }
  /** Quarantine for human review: status → `pending_review`, output kept but
   *  NOT exposed, credits stay reserved. */
  | { readonly verdict: "hold"; readonly reason: string }

export interface JobPolicy {
  readonly id: string
  checkRequest?(input: JobRequestContext): Promise<JobRequestVerdict> | JobRequestVerdict
  checkResult?(input: JobResultContext): Promise<JobResultVerdict> | JobResultVerdict
}

interface BaseDecision {
  /** MACHINE text → `job_policy_decisions.reason`. May carry scores and labels;
   *  it must never reach a user. */
  readonly reason?: string
  /** USER-SAFE text → `error_hint.reason`, `job_policy_decisions.user_message`
   *  and the 422 body. A policy that omits it gets the PLATFORM's own sentence
   *  (`DEFAULT_REQUEST_BLOCK_MESSAGE` / `DEFAULT_RESULT_BLOCK_MESSAGE`) — never
   *  `reason`, which is machine text (D13). Set on every BLOCK the platform
   *  resolves; `undefined` on a `flag` and a `hold`, which show the user no
   *  sentence at all. */
  readonly userMessage?: string
  /** The deciding policy's id — logs + the audit row, never the client. */
  readonly policyId?: string
}

export interface JobRequestDecision extends BaseDecision {
  readonly verdict: "allow" | "block"
}

export interface JobResultDecision extends BaseDecision {
  readonly verdict: "allow" | "flag" | "block" | "hold"
  readonly labels?: readonly string[]
  /** True when the policy said `hold` and the platform downgraded it because
   *  the job was not hold-eligible. Recorded, so the audit says "the policy
   *  wanted review and the platform could not offer it" rather than silently
   *  softening. */
  readonly holdDowngraded?: boolean
}

/**
 * `policy_id` values the PLATFORM writes. A registered policy may not claim
 * one, or an audit row would be ambiguous about who decided (spec §5.2).
 *   `*`        — "every registered policy allowed": the allow row has no single
 *                deciding policy.
 *   `platform` — a fail-closed resolution (D20) or a TTL expiry (D31).
 *   `review`   — a human approve/reject through the admin review surface.
 */
export const RESERVED_POLICY_IDS = ["*", "platform", "review"] as const
export const ALL_POLICIES_ALLOWED_ID = "*"
export const PLATFORM_POLICY_ID = "platform"
export const REVIEW_POLICY_ID = "review"

/** The MACHINE reason on every fail-closed row. Stable — the admin queue and
 *  the docs both key on it. */
export const POLICY_UNAVAILABLE_REASON = "policy-unavailable"
/** The USER-VISIBLE string for a fail-closed outcome. Deliberately the
 *  PLATFORM's words and never a policy's, so an outage never reads to the
 *  person who made the request as a moral judgement about their prompt. */
export const POLICY_UNAVAILABLE_MESSAGE = "Generation could not be verified"

/**
 * The PLATFORM's own sentence for a block whose policy supplied no
 * `userMessage` — one per HOOK POINT, because the two are about different
 * things ("we will not run this" vs "we will not publish this").
 *
 * D13 is the whole reason these exist: `reason` is MACHINE text for
 * `job_policy_decisions.reason` — `nsfw_score=0.98 label=explicit` — and it is
 * never a candidate for a user-visible string. A policy that distinguishes the
 * two says so by setting `userMessage`; one that does not gets THESE, never its
 * own reason. Every fresh-block site funnels through them (`applyJobRequest…`,
 * `applyJobResult…`, the insert gate, the 422 body, the re-apply path), so a
 * policy cannot leak a classifier's label onto an owner's canvas by omitting a
 * field.
 */
export const DEFAULT_REQUEST_BLOCK_MESSAGE = "This request is not allowed on this deployment"
export const DEFAULT_RESULT_BLOCK_MESSAGE = "This result was blocked by content policy"

/** What the user sees when a policy asked for human review on a job this
 *  platform cannot park (D8). The policy's own `reason` is machine text — a
 *  `hold` was never going to be shown to anybody — so it must not become the
 *  block's user-visible sentence. The SAME sentence as any other result block,
 *  and deliberately an ALIAS rather than a second literal: to the owner a
 *  downgraded hold simply IS a block, and the platform's inability to park the
 *  job is not theirs to read. */
export const HOLD_DOWNGRADED_MESSAGE = DEFAULT_RESULT_BLOCK_MESSAGE

/**
 * How long the platform waits for a single check before resolving to the
 * fail-closed path (D21). Not a timeout the policy can observe and not a throw:
 * a platform throw would override a deployment's own `ON_ERROR` stance. It only
 * ever catches a check that hangs FOREVER, which would otherwise wedge the
 * finalize claim (10 min TTL) and the BullMQ lock behind it.
 */
export const POLICY_CHECK_BACKSTOP_MS = 120_000

const policies: JobPolicy[] = []

export function registerJobPolicy(policy: JobPolicy): void {
  if ((RESERVED_POLICY_IDS as readonly string[]).includes(policy.id)) {
    throw new Error(
      `[job-policy] "${policy.id}" is a reserved policy id (${RESERVED_POLICY_IDS.join(", ")}) — ` +
        `the platform writes audit rows under it. Pick a deployment-specific id.`,
    )
  }
  policies.push(policy)
}

/** Test/bootstrap hook: drop all registered policies. */
export function clearJobPolicies(): void {
  policies.length = 0
}

/** Ids in registration order (idempotent-registration checks, admin display). */
export function getRegisteredJobPolicyIds(): readonly string[] {
  return policies.map((p) => p.id)
}

/** True when a deployment registered any job policy at all. */
export function hasJobPolicies(): boolean {
  return policies.length > 0
}

/** THE fast path. Per hook point (D23), so a result-only deployment pays
 *  nothing on the insert lane. */
export function hasJobPolicyFor(hook: JobPolicyHookPoint): boolean {
  return policies.some((p) => (hook === "request" ? p.checkRequest : p.checkResult) !== undefined)
}

/** A sentinel, not an exception: the backstop must not turn into a rejection a
 *  policy could observe or a stack a log would blame on the policy. */
const BACKSTOP = Symbol("job-policy-backstop")

/** Resolve the check, or the BACKSTOP sentinel after POLICY_CHECK_BACKSTOP_MS.
 *  The timer is always cleared, so a check that answers leaves no open handle
 *  (an un-cleared 120 s timer would keep a worker process alive). */
async function withBackstop<T>(p: Promise<T> | T): Promise<T | typeof BACKSTOP> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<typeof BACKSTOP>((resolve) => {
        timer = setTimeout(() => resolve(BACKSTOP), POLICY_CHECK_BACKSTOP_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Ask every registered policy in order; FIRST BLOCK WINS. No policy = allow. */
export async function applyJobRequestPolicies(input: JobRequestContext): Promise<JobRequestDecision> {
  for (const p of policies) {
    if (!p.checkRequest) continue
    let v: JobRequestVerdict | typeof BACKSTOP
    try {
      v = await withBackstop<JobRequestVerdict>(p.checkRequest(input))
    } catch (err) {
      v = BACKSTOP
      console.error(
        `[job-policy] policy "${p.id}" threw on request — blocking (fail-closed):`,
        (err as Error).message,
      )
    }
    if (v === BACKSTOP) {
      // Nothing exists yet to preserve pre-insert, so block is the only
      // fail-closed answer here. The PLATFORM owns the row and the wording.
      return {
        verdict: "block",
        policyId: PLATFORM_POLICY_ID,
        reason: POLICY_UNAVAILABLE_REASON,
        userMessage: POLICY_UNAVAILABLE_MESSAGE,
      }
    }
    if (v.verdict === "block") {
      // `?? v.reason` would be the D13 leak: a policy that did not bother to
      // write a sentence would publish its classifier's label to the caller.
      return {
        verdict: "block",
        reason: v.reason,
        userMessage: v.userMessage ?? DEFAULT_REQUEST_BLOCK_MESSAGE,
        policyId: p.id,
      }
    }
  }
  return { verdict: "allow" }
}

const RESULT_RANK = { allow: 0, flag: 1, hold: 2, block: 3 } as const

/**
 * Result gate. Severity `block > hold > flag > allow`: the most severe verdict
 * wins and a later `flag` never softens an earlier `hold`. Unlike the request
 * gate this does NOT short-circuit on the first non-allow — a moderation audit
 * wants every policy's opinion — except on `block`, which is terminal and cheap
 * to act on immediately.
 */
export async function applyJobResultPolicies(input: JobResultContext): Promise<JobResultDecision> {
  let best: JobResultDecision = { verdict: "allow" }
  for (const p of policies) {
    if (!p.checkResult) continue
    let v: JobResultVerdict | typeof BACKSTOP
    try {
      v = await withBackstop<JobResultVerdict>(p.checkResult(input))
    } catch (err) {
      v = BACKSTOP
      console.error(
        `[job-policy] policy "${p.id}" threw on result — failing closed:`,
        (err as Error).message,
      )
    }
    if (v === BACKSTOP) {
      console.error(`[job-policy] policy "${p.id}" did not answer the result gate — failing closed`)
      return failClosedResult(input)
    }
    if (v.verdict === "block") {
      return {
        verdict: "block",
        reason: v.reason,
        userMessage: v.userMessage ?? DEFAULT_RESULT_BLOCK_MESSAGE,
        policyId: p.id,
      }
    }
    if (RESULT_RANK[v.verdict] > RESULT_RANK[best.verdict]) {
      best = {
        verdict: v.verdict,
        reason: "reason" in v ? v.reason : undefined,
        // NO `userMessage`. Neither surviving verdict here shows the owner a
        // sentence — a `flag` publishes and a `hold` parks behind "Awaiting
        // review" — so there is nothing to say, and copying the machine
        // `reason` in would dress a classifier's label up as user-safe text one
        // downstream `??` away from a canvas. The one path that DOES need a
        // sentence, the hold downgraded to a block below, is handed the
        // platform's.
        userMessage: undefined,
        labels: v.verdict === "flag" ? v.labels : undefined,
        policyId: p.id,
      }
    }
  }
  if (best.verdict === "hold" && !input.holdEligible) {
    // A `hold` verdict carries no `userMessage` — nothing was ever going to be
    // shown for it, so its `reason` is free to be machine text. Downgrading it
    // to a block makes that text user-visible via error_hint.reason, which is
    // exactly the leak D13 exists to stop. The platform supplies the sentence.
    return { ...best, verdict: "block", userMessage: HOLD_DOWNGRADED_MESSAGE, holdDowngraded: true }
  }
  return best
}

/** D20: hold if the job can be parked, else block. Never a policy's wording. */
function failClosedResult(input: JobResultContext): JobResultDecision {
  return {
    verdict: input.holdEligible ? "hold" : "block",
    policyId: PLATFORM_POLICY_ID,
    reason: POLICY_UNAVAILABLE_REASON,
    userMessage: POLICY_UNAVAILABLE_MESSAGE,
  }
}

/**
 * The credit-settlement inputs a completion carries that are NOT `jobs` columns
 * (Q2, spec §9.1).
 *
 * `commitJobCredits(usageLogId, jobId, providerCostUsd, extraNonProviderCredits,
 * metered)` recomputes the charge from `provider_cost` for genuinely metered
 * providers (Replicate GPU-time: face-swap, legacy lip-sync, whisper
 * transcribe) — for those the reservation is a CEILING, so an approve that
 * simply committed the reservation would OVERCHARGE. The held row therefore
 * carries the caller's own settlement inputs and approve replays them.
 *
 * They live INSIDE `held_completion_fields` (a jsonb) and must be stripped out
 * of any UPDATE that spreads that object onto the row — `metered` is not a
 * column and PostgREST would reject the write. `splitHeldCompletionFields` is
 * the one place that split happens.
 */
export interface HeldCommitReplay {
  /** `ProviderResult.meteredCost` — a BOOLEAN despite the name: "this provider
   *  is genuinely metered, true up from provider_cost". */
  readonly metered?: boolean
  /** Credits for work we performed that the provider's USD cost does not
   *  reflect (the loop-trim add-on). */
  readonly extraNonProviderCredits?: number
  /** The provider USD cost the true-up computes from, when the caller had one.
   *  Redundant with the `provider_cost` column on the happy path and load-
   *  bearing when the caller omitted that column. */
  readonly meteredCost?: number | null
  /** Loop-trim add-on credits to take OFF the commit (F7): the smart-loop-cut
   *  post-process failed, so the clip was delivered un-trimmed and the add-on
   *  must not be charged. The worker no longer settles that itself — doing so
   *  before the gate spoke left the usage log `committed`, which made every
   *  block/reject/expiry/cancel refund a silent no-op — so the held row carries
   *  it for `approveHeldJob` to replay as (reserved − add-on). */
  readonly loopTrimAddonRefundCredits?: number
}

export const HELD_COMMIT_REPLAY_KEYS = [
  "metered", "extraNonProviderCredits", "meteredCost", "loopTrimAddonRefundCredits",
] as const

/** Split a stored `held_completion_fields` into the real `jobs` columns approve
 *  replays and the settlement inputs it passes to `commitJobCredits`. */
export function splitHeldCompletionFields(held: Record<string, unknown> | null | undefined): {
  columns: Record<string, unknown>
  commit: HeldCommitReplay
} {
  const columns: Record<string, unknown> = {}
  const commit: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(held ?? {})) {
    if ((HELD_COMMIT_REPLAY_KEYS as readonly string[]).includes(k)) commit[k] = v
    else columns[k] = v
  }
  return { columns, commit: commit as HeldCommitReplay }
}

/**
 * The block carried out of the insert funnel. DEFINED HERE (not in
 * `insert-job.ts`) so `JobBlockedError` / `jobBlockOf` can reference it without
 * an import cycle back into the insert helpers.
 */
export interface InsertJobBlock {
  readonly code: "job_blocked"
  readonly policyId: string
  /** USER-SAFE — this is what the 422 body and the node's error say. */
  readonly message: string
}

/** Thrown by the insert helpers that throw (`insertJobIdempotent`) and by
 *  internal creators that must fail their own stage with a coded reason. */
export class JobBlockedError extends Error {
  readonly code = "job_blocked" as const
  readonly statusCode = 422 as const
  constructor(readonly block: InsertJobBlock) {
    super(block.message)
    this.name = "JobBlockedError"
  }
}

/** Recognises BOTH carriers — the thrown error and the `{error:{blocked}}`
 *  arm — so one branch in `sendInternalError` covers every creator lane. */
export function jobBlockOf(e: unknown): InsertJobBlock | null {
  if (e instanceof JobBlockedError) return e.block
  if (e && typeof e === "object" && "blocked" in e) {
    const b = (e as { blocked?: unknown }).blocked
    if (b && typeof b === "object" && (b as InsertJobBlock).code === "job_blocked") return b as InsertJobBlock
  }
  return null
}

/** The uniform 422 body every job-creating lane sends — one shape for the
 *  frontend, mirroring `uploadBlockedBody` (lib/upload-policy.ts:109-118). */
export function jobBlockedBody(d: { userMessage?: string }): {
  error: { code: "job_blocked"; message: string }
} {
  return {
    error: {
      // NO `reason` arm — the shape does not even accept one. The machine text
      // is for `job_policy_decisions`, and a body that fell back to it would
      // put a classifier's label in front of the caller (D13). `||` and not
      // `??`: an empty string is not a sentence.
      code: "job_blocked",
      message: d.userMessage || DEFAULT_REQUEST_BLOCK_MESSAGE,
    },
  }
}
