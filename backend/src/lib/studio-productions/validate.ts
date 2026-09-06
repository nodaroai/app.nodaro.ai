import {
  importProduction,
  type MentionCandidate,
} from "@nodaro/studio-production"
import type { StudioPlanIssue, StudioValidatePlanResponse } from "@nodaro/shared"

import { durationsFor } from "./durations.js"

/**
 * Validate a plan against the caller's own library, and change nothing.
 *
 * The whole value of this route is that it is FREE and IDEMPOTENT: an author —
 * a person or a model — can loop on it until the plan is right without spending
 * a credit or creating a row. So it runs the real importer (the same parse →
 * validate → repair → resolve → map the create path runs) and throws the result
 * away, keeping only what it learned.
 *
 * The library matters as much as the schema. A plan is not "valid" in the
 * abstract: `@Kira` either finds a character this user owns or it does not, and
 * the difference is the whole point of validating before importing.
 */
export function validatePlan(
  plan: unknown,
  candidates: ReadonlyArray<MentionCandidate>,
): StudioValidatePlanResponse {
  const result = importProduction(plan, { candidates, durationsFor })

  if (!result.ok) {
    // A structural failure is ONE error, and it names the field. The importer
    // stops at the first thing it cannot make sense of, deliberately: a
    // cascade of downstream complaints about a document that failed to parse
    // sends an author chasing symptoms.
    return {
      valid: false,
      errors: [{ path: result.path ?? "", message: result.error }],
      warnings: [],
    }
  }

  return {
    valid: true,
    errors: [],
    warnings: result.warnings.map(toIssue),
    summary: {
      ...(result.title ? { name: result.title } : {}),
      scenes: result.summary.scenes,
      shots: result.summary.shots,
      cast: result.summary.cast,
      bound: result.summary.castBound,
    },
  }
}

function toIssue(warning: { code: string; message: string; path?: string }): StudioPlanIssue {
  return {
    path: warning.path ?? "",
    message: warning.message,
    // The warning CODE is the actionable half — `unresolved-cast` tells an
    // author to create the character, `newer-version` to re-read the format.
    hint: warning.code,
  }
}
