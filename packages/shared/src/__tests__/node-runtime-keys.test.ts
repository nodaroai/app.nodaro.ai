import { describe, it, expect } from "vitest"
import {
  EXECUTION_DATA_KEYS,
  TRANSIENT_RUNTIME_KEYS,
  stripTransientRuntimeData,
} from "../index.js"

/**
 * TRANSIENT_RUNTIME_KEYS = run-state that must neither mark the workflow
 * dirty nor be persisted in the save payload (the phantom-dirty →
 * spurious-save → false "changed in another tab" → frozen-autosave chain).
 * Results (generatedResults, URLs, lora outputs, errorMessage) stay
 * persisted — users expect them after reload.
 */
describe("TRANSIENT_RUNTIME_KEYS", () => {
  it("is a strict subset of EXECUTION_DATA_KEYS (undo skip ⊇ dirty skip)", () => {
    for (const key of TRANSIENT_RUNTIME_KEYS) {
      expect(EXECUTION_DATA_KEYS.has(key), `${key} missing from EXECUTION_DATA_KEYS`).toBe(true)
    }
    expect(TRANSIENT_RUNTIME_KEYS.size).toBeLessThan(EXECUTION_DATA_KEYS.size)
  })

  it("covers the per-tick run-state keys", () => {
    for (const key of [
      "executionStatus",
      "currentJobId",
      "currentJobProgress",
      "isStreaming",
      "subWorkflowProgress",
      "__listTotal",
      "__listCompleted",
      "__listRunning",
      "__runsInFlight",
      "_upstreamRefresh",
      "__upstreamCount",
      "downloadPercent",
      "downloadPhase",
    ]) {
      expect(TRANSIENT_RUNTIME_KEYS.has(key), `${key} should be transient`).toBe(true)
    }
  })

  it("NEVER includes persisted results or user-visible outcomes", () => {
    for (const key of [
      "generatedResults",
      "generatedImageUrl",
      "generatedVideoUrl",
      "generatedText",
      "activeResultIndex",
      "errorMessage",
      "loraTriggerWord",
      "loraReplicateVersion",
      "loraTrainingStatus",
      "lastInputs",
      "shots",
      "result",
      "zoom",
      // A Video URL node's download OUTCOME persists — only its ticks are transient.
      "downloadStatus",
      "downloadedVideoUrl",
      "downloadId",
      // "Clear results" stamps it for the NEXT load to read — stripping it on
      // save would bring every cleared result back on reload.
      "resultsClearedAt",
    ]) {
      expect(TRANSIENT_RUNTIME_KEYS.has(key), `${key} must stay persisted`).toBe(false)
    }
  })
})

describe("EXECUTION_DATA_KEYS", () => {
  it("files the clear-results watermark as runtime bookkeeping — never preset / template / copilot-visible config", () => {
    expect(EXECUTION_DATA_KEYS.has("resultsClearedAt")).toBe(true)
  })
})

describe("stripTransientRuntimeData", () => {
  it("removes transient keys, keeps results, does not mutate input", () => {
    const nodes = [
      {
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          prompt: "a cat",
          executionStatus: "running",
          currentJobId: "job-1",
          currentJobProgress: 42,
          generatedResults: [{ url: "https://r2/x.png" }],
          errorMessage: "boom",
        },
      },
    ]
    const out = stripTransientRuntimeData(nodes)
    expect(out[0]!.data).toEqual({
      label: "Img",
      prompt: "a cat",
      generatedResults: [{ url: "https://r2/x.png" }],
      errorMessage: "boom",
    })
    // input untouched (pure)
    expect((nodes[0]!.data as Record<string, unknown>).executionStatus).toBe("running")
    // node identity fields preserved
    expect(out[0]!.id).toBe("n1")
    expect(out[0]!.type).toBe("generate-image")
  })

  it("never saves a trigger's last run values — run history keeps them, under its retention", () => {
    const trigger = {
      id: "t1",
      type: "telegram-account-trigger",
      data: { label: "Inbox", chatIds: ["777"], __triggerData: { text: "a message", senderId: "555" } },
    }
    const [out] = stripTransientRuntimeData([trigger])
    expect(out!.data).toEqual({ label: "Inbox", chatIds: ["777"] })
  })

  it("passes through nodes without data and avoids copying when nothing is transient", () => {
    const bare = { id: "n2" } as { id: string; data?: Record<string, unknown> }
    const clean = { id: "n3", data: { label: "T", prompt: "p" } }
    const out = stripTransientRuntimeData([bare, clean])
    expect(out[0]).toBe(bare)
    expect(out[1]).toBe(clean) // no transient keys → same reference is fine
  })
})
