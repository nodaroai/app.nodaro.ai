/**
 * The invariant behind `STALE_THRESHOLD_MS["anthropic-sync"]`.
 *
 * A sync LLM route holds its job row `pending` for exactly as long as the call
 * runs, and the reconciliation cron force-fails + refunds any row past its
 * kind's threshold. So the threshold is not a taste question: it must outlast
 * the longest run the route can legitimately produce, or the sweep kills a
 * LIVE draft and refunds under it — which is what happened on 2026-09-01
 * ("Reconciliation could not recover this job. Please re-run.", a studio
 * Director draft on `POST /v1/llm/structured`, whose 240 s-per-lane budget can
 * legitimately reach 32 minutes against a threshold that fired at 5).
 *
 * The budget is DERIVED (`STRUCTURED_LLM_MAX_RUNTIME_MS`), so raising the
 * route's timeout, its retry ceiling, or `llmComplete`'s lane count fails this
 * test instead of silently re-opening the race.
 */
import { describe, it, expect } from "vitest"
import { STALE_THRESHOLD_MS, MIN_STALE_THRESHOLD_MS, isSyncKind, MAX_ATTEMPTS } from "../types.js"
import {
  STRUCTURED_LLM_MAX_RUNTIME_MS,
  STRUCTURED_LLM_MAX_RETRIES,
  STRUCTURED_LLM_TIMEOUT_MS,
} from "../../llm-structured-request.js"
import { LLM_MAX_LANES_PER_CALL, LLM_STRUCTURED_DIRECT_BACKUP_ASKS } from "../../llm-client.js"

describe("anthropic-sync staleness threshold vs the structured route's budget", () => {
  it("outlasts the longest legitimate POST /v1/llm/structured call", () => {
    expect(STALE_THRESHOLD_MS["anthropic-sync"]).toBeGreaterThanOrEqual(STRUCTURED_LLM_MAX_RUNTIME_MS)
  })

  it("derives that budget from the three constants that actually bound a call", () => {
    // Spelled out so a change to any one of them lands here, not in production:
    // (attempts × lanes + the direct-tool backup's one ask) × the per-lane timeout.
    expect(LLM_STRUCTURED_DIRECT_BACKUP_ASKS).toBe(1)
    expect(STRUCTURED_LLM_MAX_RUNTIME_MS).toBe(
      ((STRUCTURED_LLM_MAX_RETRIES + 1) * LLM_MAX_LANES_PER_CALL + LLM_STRUCTURED_DIRECT_BACKUP_ASKS) * STRUCTURED_LLM_TIMEOUT_MS,
    )
  })

  it("is still a sync kind — the sweep is fail+refund, so the threshold is the only guard", () => {
    expect(isSyncKind("anthropic-sync")).toBe(true)
  })

  it("leaves the cron's SQL pre-filter and attempt budget alone", () => {
    // MIN_STALE_THRESHOLD_MS drives the candidate scan's cutoff; raising ONE
    // kind must not move it (kie-llm / elevenlabs-sync / fal-request still sit
    // at the 5-minute floor), and 18 attempts × the 5-minute cron cadence must
    // still cover the raised threshold.
    expect(MIN_STALE_THRESHOLD_MS).toBe(5 * 60 * 1000)
    expect(STALE_THRESHOLD_MS["anthropic-sync"]).toBeLessThan(MAX_ATTEMPTS * 5 * 60 * 1000)
  })
})
