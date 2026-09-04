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
import { safetyRetryPolicy, getModel } from "@nodaro/shared"

export type SafetyBlock = {
  class: "copyright" | "likeness" | "safety"
  maxAttempts: 1 | 2
  fallback?: string
}

function classOf(err: unknown): SafetyBlock["class"] | null {
  if (!(err instanceof Error)) return null
  const cls = (err as KieError).contentPolicyClass
  return cls === "copyright" || cls === "likeness" || cls === "safety" ? cls : null
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

/** One jsonb column, two verdict sources. A DISCRIMINATED UNION on `kind` —
 *  which was already the discriminant every reader tested
 *  (`hint.kind === "safety-block"`), so widening it breaks none of them.
 *
 *  Hand-copied mirrors that must be updated in the same change (each says so in
 *  its own comment): `frontend/src/types/nodes.ts` `JobErrorHint`,
 *  `packages/client/src/resources/jobs.ts` `JobErrorHint` (minor + changeset).
 *  `packages/client/dist/index.d.ts` is REBUILT, never hand-edited. */
export type ErrorHint = SafetyBlockHint | PolicyBlockHint

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

export function errorHintFor(block: SafetyBlock, retried: boolean): SafetyBlockHint {
  return block.fallback
    ? { kind: "safety-block", class: block.class, retried, suggestedProvider: block.fallback }
    : { kind: "safety-block", class: block.class, retried }
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
