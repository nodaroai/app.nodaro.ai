import { describe, it, expect } from "vitest"
import {
  PROVIDER_KIND_VALUES,
  STALE_THRESHOLD_MS,
  isAsyncKind,
  isSyncKind,
  KIE_RECOVER_KINDS,
  REPLICATE_RECOVER_KINDS,
  ELEVENLABS_RECOVER_KINDS,
  ASYNC_RECOVERABLE_KINDS,
  isReconcileRecoverable,
} from "../types.js"

describe("ProviderKind registry", () => {
  it("exposes spec-listed kinds at runtime (14 base + 2 suno-voice in P5.2 + 3 reconcile blind-spot fixes + heygen stall-retry guard)", () => {
    expect(PROVIDER_KIND_VALUES).toEqual([
      "kie-standard", "kie-veo", "kie-veo-1080p", "kie-suno",
      "kie-suno-voice-create", "kie-suno-voice-validate",
      "kie-kontext", "kie-luma",
      "kie-kling3", "kie-runway", "kie-aleph", "kie-lip-sync", "kie-llm",
      "replicate-prediction", "replicate-training",
      "elevenlabs-async", "elevenlabs-sync", "anthropic-sync",
      "heygen",
      "pre-task",
    ])
  })

  it("has a stale-threshold for every kind", () => {
    for (const kind of PROVIDER_KIND_VALUES) {
      expect(STALE_THRESHOLD_MS[kind]).toBeGreaterThan(0)
    }
  })

  it("marks sync kinds correctly", () => {
    expect(isSyncKind("kie-llm")).toBe(true)
    expect(isSyncKind("elevenlabs-sync")).toBe(true)
    expect(isSyncKind("anthropic-sync")).toBe(true)
    expect(isSyncKind("kie-suno-voice-create")).toBe(true)
    expect(isSyncKind("kie-suno-voice-validate")).toBe(true)
    expect(isSyncKind("pre-task")).toBe(true)
    expect(isSyncKind("heygen")).toBe(true)
    expect(isSyncKind("kie-standard")).toBe(false)
    expect(isSyncKind("kie-aleph")).toBe(false)
    expect(isSyncKind("kie-veo-1080p")).toBe(false)
    expect(isSyncKind("replicate-prediction")).toBe(false)
  })

  it("isAsyncKind is the inverse of isSyncKind for all values", () => {
    for (const kind of PROVIDER_KIND_VALUES) {
      expect(isAsyncKind(kind)).toBe(!isSyncKind(kind))
    }
  })
})

describe("recoverable-kind sets (single source of truth — audit M5)", () => {
  it("ASYNC_RECOVERABLE_KINDS is exactly the union of the per-provider dispatch sets", () => {
    const union = new Set([
      ...KIE_RECOVER_KINDS,
      ...REPLICATE_RECOVER_KINDS,
      ...ELEVENLABS_RECOVER_KINDS,
    ])
    expect(new Set(ASYNC_RECOVERABLE_KINDS)).toEqual(union)
  })

  it("parity guard: ASYNC_RECOVERABLE_KINDS ≡ every async kind in the registry", () => {
    // A new ProviderKind that is async but missing from a dispatch set would
    // silently fall into the cron's unknown-kind sweep (fail+refund) instead
    // of being recovered. This derivation pins the two classifications to
    // each other so they cannot drift.
    const derived = new Set(PROVIDER_KIND_VALUES.filter(isAsyncKind))
    expect(new Set(ASYNC_RECOVERABLE_KINDS)).toEqual(derived)
  })
})

describe("isReconcileRecoverable (worker leave-for-reconcile predicate)", () => {
  const row = (provider_kind: string | null, provider_task_id: string | null) => ({
    provider_kind,
    provider_task_id,
  })

  it("true for async kinds with a task id", () => {
    expect(isReconcileRecoverable(row("kie-standard", "t-1"))).toBe(true)
    expect(isReconcileRecoverable(row("kie-suno", "t-2"))).toBe(true)
    expect(isReconcileRecoverable(row("replicate-prediction", "p-1"))).toBe(true)
    expect(isReconcileRecoverable(row("elevenlabs-async", "dub-1"))).toBe(true)
  })

  it("true for heygen with a task id (decision D3: leave for the sync-sweep's fail+refund)", () => {
    expect(isReconcileRecoverable(row("heygen", "video-1"))).toBe(true)
  })

  it("false without a provider_task_id (nothing to re-poll)", () => {
    expect(isReconcileRecoverable(row("kie-standard", null))).toBe(false)
  })

  it("false for sync kinds (result existed only in memory)", () => {
    expect(isReconcileRecoverable(row("elevenlabs-sync", "t-x"))).toBe(false)
    expect(isReconcileRecoverable(row("anthropic-sync", "t-y"))).toBe(false)
    expect(isReconcileRecoverable(row("pre-task", "t-z"))).toBe(false)
  })

  it("false for unknown or null kinds", () => {
    expect(isReconcileRecoverable(row("kie-mysterious", "t-1"))).toBe(false)
    expect(isReconcileRecoverable(row(null, "t-1"))).toBe(false)
  })
})
