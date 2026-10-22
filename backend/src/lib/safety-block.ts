/**
 * The seam between a provider's content-policy block and the worker's retry
 * decision (PR9 spec 2026-09-03-pr9-safety-block-handling). Redis-free and
 * dependency-light on purpose — it must be importable from a test (or any
 * future caller) without pulling in a queue connection.
 *
 * `KieError.contentPolicyClass` (`providers/kie/client.ts`) is the primary
 * signal, but this module deliberately duck-types instead of using
 * `instanceof KieError`: the private-plugin toolkit throws its own `Error`
 * subclasses that carry the same `contentPolicyClass` property (the
 * cross-repo contract already documented on `KieError.contentPolicy`), and
 * this seam must recognize those too. `KieError` is imported type-only so
 * this file never executes `providers/kie/client.ts`'s module body.
 */
import type { KieError } from "../providers/kie/client.js"
import { safetyRetryPolicy, getModel } from "@nodaro/shared/model-catalog"

export type SafetyBlock = {
  class: "copyright" | "likeness" | "safety"
  maxAttempts: 1 | 2
  fallback?: string
}

function classOf(err: unknown): SafetyBlock["class"] | null {
  // Never throws: the worker's failure path calls this before it marks the
  // row failed and refunds, so a thrown value with a throwing getter (or a
  // Proxy) must read as "not a block", not abort that path.
  try {
    if (!(err instanceof Error)) return null
    const cls = (err as KieError).contentPolicyClass
    return cls === "copyright" || cls === "likeness" || cls === "safety" ? cls : null
  } catch {
    return null
  }
}

/**
 * Classifies a thrown error into a bounded retry policy, or null when it is
 * not a content-policy block at all (a normal retryable failure). `safety` is
 * the one class the provider is known to be non-deterministic on for some
 * models — `safetyRetryPolicy` (from the catalog's `safetyFilter` flag)
 * decides whether that model gets a second attempt and a fallback to offer.
 * `copyright`/`likeness` blocks are deterministic on the same input, so they
 * always get exactly one attempt and no fallback.
 */
export function safetyBlockOf(err: unknown, modelId: string | null | undefined): SafetyBlock | null {
  const cls = classOf(err)
  if (!cls) return null
  if (cls !== "safety") return { class: cls, maxAttempts: 1 }

  const policy = safetyRetryPolicy(modelId ?? "")
  return policy.fallback
    ? { class: cls, maxAttempts: policy.maxAttempts, fallback: policy.fallback }
    : { class: cls, maxAttempts: policy.maxAttempts }
}

/** BullMQ semantics mirror (see `workers/shared.ts` isFinalJobAttempt): a
 *  policy's `maxAttempts` — not the queue's global `attempts: 3` — decides
 *  when a content-policy block stops retrying. */
export function isFinalAttemptFor(job: { attemptsMade: number }, block: SafetyBlock): boolean {
  return job.attemptsMade + 1 >= block.maxAttempts
}

/** The `jobs.error_hint` (migration 376) wire shape — a user-safe,
 *  machine-readable verdict the editor/MCP can act on without parsing the
 *  free-text `error_message`. Named (not just `errorHintFor`'s inline return
 *  type) so callers two layers away (node-executor.ts's node-state carry, the
 *  MCP failure-guidance helper) can reference it without re-deriving it.
 *
 *  A PROVIDER's verdict. Contrast PolicyBlockHint, which is Nodaro's own. */
export type SafetyBlockHint = {
  kind: "safety-block"
  class: SafetyBlock["class"]
  retried: boolean
  suggestedProvider?: string
  /** Present when the provider refused the INPUT VIDEO itself, not the prompt,
   *  a reference image or the output — a caller can then send a different clip. */
  subject?: "input_video"
}

/** A NODARO-side policy decision, not a provider's — written by the job-policy
 *  registry on a `block` verdict at either hook point (spec
 *  2026-09-03-job-policy-hook-design §9, D12/D13).
 *
 *  `reason` is USER-SAFE BY CONTRACT: `error_hint` is on `PUBLIC_JOB_KEYS`, so
 *  `sanitizeJobForPublic` passes it through to non-admins unchanged and it
 *  lands verbatim on the owner's canvas — exactly like `upload_blocked`. It is
 *  the verdict's `userMessage ?? reason`; the MACHINE text (scores, labels)
 *  stays in `job_policy_decisions.reason` and must never be copied here. A
 *  policy that would leak its internals has to return a generic reason.
 *
 *  `hookPoint` lets one surface render both gates: "blocked before it ran"
 *  (request) vs "the result was blocked and wasn't saved" (result). */
export type PolicyBlockHint = {
  kind: "policy-block"
  policyId: string
  reason: string
  hookPoint: "request" | "result"
}

/** The run could not be paid for partway through: a handler's own credit
 *  reservation (a child job it dispatches) was refused — the balance ran out,
 *  or a plan or workspace cap was reached. The job is refunded like any plain
 *  failure; the hint lets a client say "top up" instead of "it failed".
 *
 *  `code` is the refusal code the reserving route answered with
 *  (`insufficient_credits`, `free_video_limit`, `budget_exceeded`, …): a
 *  lowercase snake_case token, never free text — `creditsHintOf` drops
 *  anything else, so it is user-safe like the other arms. */
export type CreditsHint = {
  kind: "credits"
  code: string
}

/** A PROVIDER refused the job's input video without naming a content-policy
 *  class (its message is about the file, not a policy). Like an unclassified
 *  failure for the person — no fallback model is offered — but a caller that
 *  can change the input (send a different clip) knows which input to change. */
export type InputRefusedHint = {
  kind: "input-refused"
  subject: "input_video"
}

/** One jsonb column, several verdict sources. A DISCRIMINATED UNION on `kind` —
 *  which was already the discriminant every reader tested
 *  (`hint.kind === "safety-block"`), so widening it breaks none of them.
 *
 *  Hand-copied mirrors that must be updated in the same change (each says so in
 *  its own comment): `frontend/src/types/nodes.ts` `JobErrorHint`,
 *  `packages/client/src/resources/jobs.ts` `JobErrorHint` (minor + changeset),
 *  `lib/private-plugins/types.ts` `PluginJobErrorHint` (and the plugin repo's
 *  copy of that contract).
 *  `packages/client/dist/index.d.ts` is REBUILT, never hand-edited. */
export type ErrorHint = SafetyBlockHint | PolicyBlockHint | CreditsHint | InputRefusedHint

/** A credits refusal code as a route sends it; anything else is not passed on. */
const CREDITS_CODE_RE = /^[a-z0-9_]{1,64}$/

/** A handler's credits refusal, read off the thrown error (or anything on its
 *  `cause` chain): a duck-typed `failureHint: { kind: "credits", code }` own
 *  property, which survives the plugin boundary where a class would not.
 *  Returns a FRESH object of exactly those two fields — the column reaches
 *  non-admins verbatim, so nothing else the thrower attached may ride along.
 *  A malformed hint (other kind, a code that is not a plain token) is null.
 *  Never throws: the worker calls it before it marks the row failed and
 *  refunds, so a throwing getter or Proxy anywhere on the chain reads as "no
 *  hint" rather than aborting that path. */
export function creditsHintOf(err: unknown): CreditsHint | null {
  try {
    let cur: unknown = err
    for (let depth = 0; depth < 8 && typeof cur === "object" && cur !== null; depth++) {
      const hint = (cur as { failureHint?: unknown }).failureHint
      if (typeof hint === "object" && hint !== null) {
        const { kind, code } = hint as { kind?: unknown; code?: unknown }
        if (kind === "credits" && typeof code === "string" && CREDITS_CODE_RE.test(code)) {
          return { kind: "credits", code }
        }
      }
      cur = (cur as { cause?: unknown }).cause
    }
    return null
  } catch {
    return null
  }
}

/** Constructor for the policy arm, so no call site hand-writes the literal
 *  `kind` (the way a mistyped discriminant silently falls through every
 *  reader's `switch` to "unknown failure"). */
export function policyBlockHint(
  policyId: string,
  reason: string,
  hookPoint: "request" | "result",
): PolicyBlockHint {
  return { kind: "policy-block", policyId, reason, hookPoint }
}

/** Constructor for the input-refused arm (same reason as `policyBlockHint`). */
export function inputRefusedHint(): InputRefusedHint {
  return { kind: "input-refused", subject: "input_video" }
}

/** True when the thrown error (or anything on its `cause` chain) says the
 *  provider refused the input video: a duck-typed `inputVideoRefused === true`
 *  own property (`KieError.inputVideoRefused`, or a plugin's error carrying
 *  the same flag across the plugin boundary). Never throws, for the same
 *  reason as `creditsHintOf`. */
export function inputVideoRefusedOf(err: unknown): boolean {
  try {
    let cur: unknown = err
    for (let depth = 0; depth < 8 && typeof cur === "object" && cur !== null; depth++) {
      if ((cur as { inputVideoRefused?: unknown }).inputVideoRefused === true) return true
      cur = (cur as { cause?: unknown }).cause
    }
    return false
  } catch {
    return false
  }
}

const nonBlank = (v: unknown): boolean => typeof v === "string" && v.trim() !== ""

/** True when the job's payload sent a video to the provider: a source video
 *  (`videoUrl` — video-to-video, motion transfer, retake…) or a reference
 *  video (`referenceVideoUrl` / `referenceVideoUrls` — the multi-reference
 *  video models). The worker marks an input-video refusal only on such a
 *  job: the provider's file-level wording is generic, and a job that sent no
 *  video has no input video to blame. */
export function sentVideoInput(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  const d = data as { videoUrl?: unknown; referenceVideoUrl?: unknown; referenceVideoUrls?: unknown }
  return (
    nonBlank(d.videoUrl) ||
    nonBlank(d.referenceVideoUrl) ||
    (Array.isArray(d.referenceVideoUrls) && d.referenceVideoUrls.some(nonBlank))
  )
}

export function errorHintFor(
  block: SafetyBlock,
  retried: boolean,
  opts?: { inputVideoRefused?: boolean },
): SafetyBlockHint {
  const hint: SafetyBlockHint = block.fallback
    ? { kind: "safety-block", class: block.class, retried, suggestedProvider: block.fallback }
    : { kind: "safety-block", class: block.class, retried }
  return opts?.inputVideoRefused ? { ...hint, subject: "input_video" } : hint
}

/** The `jobs.error_hint` for a provider's refusal of a job, or null when it was
 *  not one: a classified content-policy block (naming the input video when
 *  the provider refused that), else a refused input video with no class. The
 *  ONE mapping shared by every writer that fails a job on a provider's
 *  verdict — the worker's catch path and the reconcile path (a job re-picked
 *  after a worker restart is failed there, and must carry the same hint).
 *  `inputVideoRefused` is already gated on the job having sent a video
 *  (`inputVideoRefusedOf(err) && sentVideoInput(data)`). */
export function refusalHintFor(
  block: SafetyBlock | null,
  retried: boolean,
  inputVideoRefused: boolean,
): SafetyBlockHint | InputRefusedHint | null {
  if (block) return errorHintFor(block, retried, { inputVideoRefused })
  return inputVideoRefused ? inputRefusedHint() : null
}

/** The model a job runs under, read off its payload (the BullMQ data or the
 *  `jobs.input_data` request — same keys): `model` wins when set — the
 *  synthetic LoRA model, or, on a workflow run, the image-to-image sibling a
 *  reference swapped to (the workflow engine's payload-builder sends it there
 *  and keeps `provider` as the model the user picked) — then `resolvedModel`,
 *  the same fact as the single-node route records it (on `input_data` only:
 *  the sibling or the LoRA model its queue payload sends), else `provider`
 *  (the route enqueue shape). */
export function jobModelIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null
  const { model, resolvedModel, provider } = data as { model?: unknown; resolvedModel?: unknown; provider?: unknown }
  if (typeof model === "string") return model
  if (typeof resolvedModel === "string") return resolvedModel
  return typeof provider === "string" ? provider : null
}

/** True iff the thrown error ITSELF vouches that its `message` is user-safe:
 *  a strict `userSafeMessage === true` own property. A plugin handler that
 *  fails a job with a fixed sentence of its own (and `contentPolicyClass` for
 *  the hint) sets it so the worker keeps that sentence instead of the generic
 *  `safetyBlockMessage` — whose "adjust the prompt" advice is wrong for a run
 *  whose prompt the user never wrote.
 *
 *  Read on the TOP-LEVEL error only, never the `cause` chain: the text kept is
 *  the top-level message, and a marker on a cause would vouch for a wrapper's
 *  text nobody checked. Never throws (a throwing getter or Proxy reads as "not
 *  marked"). The worker honours it for plugin-served job types only. */
export function hasUserSafeMessage(err: unknown): boolean {
  try {
    return err instanceof Error && Object.hasOwn(err, "userSafeMessage")
      && (err as { userSafeMessage?: unknown }).userSafeMessage === true
  } catch {
    return false
  }
}

/** User-facing message for a FINAL `safety`-class block only — copyright and
 *  likeness blocks are deterministic and never retried, so they keep KIE's
 *  existing `CONTENT_POLICY_MESSAGES` text unchanged. `retried` must reflect
 *  what actually happened: a model without the stochastic flag gets ONE
 *  attempt, and its message must not claim a retry. */
export function safetyBlockMessage(fallbackLabel?: string, retried = true): string {
  const lead = retried
    ? "The provider's safety filter blocked this output. This filter is not always consistent, so the request was retried once."
    : "The provider's safety filter blocked this output."
  return fallbackLabel
    ? `${lead} You can try the same prompt and references on ${fallbackLabel}, or adjust the prompt.`
    : `${lead} Try adjusting the prompt or the input image.`
}

/** The catalog display label for a fallback model id, or undefined when the
 *  id isn't a real catalog entry. */
export function fallbackLabelOf(modelId: string): string | undefined {
  return getModel(modelId)?.label
}
