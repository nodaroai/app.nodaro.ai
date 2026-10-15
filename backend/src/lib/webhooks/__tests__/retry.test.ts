/**
 * The retry schedule (lib/webhooks/retry.ts): an attempt that did not get a
 * 2xx is tried again after 30 s, 2 min, 10 min, 1 h, 6 h, 12 h and 24 h
 * (each ±10%), so a delivery gets 8 attempts over about 43 hours; then it
 * fails for good. A test ping is tried once.
 */
import { describe, it, expect } from "vitest"
import {
  DISABLE_AFTER_FAILED_DELIVERIES,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  attemptsFor,
  nextRetryDelayMs,
} from "../retry.js"

const MIDDLE = () => 0.5

describe("retry schedule", () => {
  it("is the documented schedule, eight attempts in all", () => {
    expect(RETRY_DELAYS_MS).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000, 43_200_000, 86_400_000])
    expect(MAX_ATTEMPTS).toBe(8)
    expect(attemptsFor("job.completed")).toBe(8)
    expect(attemptsFor("job.failed")).toBe(8)
    expect(attemptsFor("ping")).toBe(1)
  })

  it("waits the scheduled delay after each failed attempt (no jitter at the middle)", () => {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(nextRetryDelayMs("job.completed", attempt, MIDDLE)).toBe(RETRY_DELAYS_MS[attempt - 1])
    }
  })

  it("spreads each delay by at most 10% either way", () => {
    expect(nextRetryDelayMs("job.failed", 1, () => 0)).toBe(27_000)
    expect(nextRetryDelayMs("job.failed", 1, () => 0.999999)).toBeLessThanOrEqual(33_000)
    expect(nextRetryDelayMs("job.failed", 7, () => 0)).toBe(77_760_000)
  })

  it("gives up after the last attempt", () => {
    expect(nextRetryDelayMs("job.completed", MAX_ATTEMPTS, MIDDLE)).toBeNull()
    expect(nextRetryDelayMs("job.completed", MAX_ATTEMPTS + 3, MIDDLE)).toBeNull()
  })

  it("never retries a test ping", () => {
    expect(nextRetryDelayMs("ping", 1, MIDDLE)).toBeNull()
  })

  it("switches an endpoint off after 50 deliveries in a row fail for good", () => {
    expect(DISABLE_AFTER_FAILED_DELIVERIES).toBe(50)
  })
})
