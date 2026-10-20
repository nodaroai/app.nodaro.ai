import { describe, it, expect } from "vitest"
import {
  EXECUTION_DATA_KEYS,
  NODE_TYPE_EXECUTION_DATA_KEYS,
  TRANSIENT_RUNTIME_KEYS,
  UGC_CREATOR_CANDIDATES_KEY,
  executionDataKeysOf,
  isExecutionDataKey,
  stripTransientRuntimeData,
} from "../index.js"
import { SUNO_SEPARATE_RESULT_FIELDS } from "../suno-separate.js"

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
      "__runSkipReason",
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

describe("a use-case node's continuation", () => {
  it("is one run's, never saved: a save strips it, so a saved one cannot turn a later run into a continuation", () => {
    expect(EXECUTION_DATA_KEYS.has("useCaseContinue")).toBe(true)
    expect(TRANSIENT_RUNTIME_KEYS.has("useCaseContinue")).toBe(true)
    const [saved] = stripTransientRuntimeData([{ data: { useCaseContinue: { mode: "from-failed", jobId: "j1" }, captions: true } }])
    expect(saved!.data).toEqual({ captions: true })
  })
})

describe("EXECUTION_DATA_KEYS", () => {
  it("files the clear-results watermark as runtime bookkeeping — never preset / template / copilot-visible config", () => {
    expect(EXECUTION_DATA_KEYS.has("resultsClearedAt")).toBe(true)
  })

  it("files a UGC run's own fields as run results of the UGC types only: a run writing them is never an undo step, and they persist", () => {
    // What the UGC lanes write beside the generic keys: the outputs a node hands on, UGC Creator's
    // options of a draw and their note, UGC Clips' quote, UGC Clip's warnings, length and Re-render marks.
    const own: Record<string, readonly string[]> = {
      "ugc-creator": ["ugcOutputs", UGC_CREATOR_CANDIDATES_KEY, "optionFailed"],
      "ugc-script": ["ugcOutputs"],
      "ugc-clips": ["ugcOutputs", "quote"],
      "ugc-clip": ["ugcOutputs", "clipWarnings", "durationSec", "rerenderPending"],
      "ugc-cards": ["ugcOutputs"],
    }
    for (const [type, keys] of Object.entries(own)) {
      for (const key of keys) {
        expect(isExecutionDataKey(key, type), `${type}.${key}`).toBe(true)
        expect(TRANSIENT_RUNTIME_KEYS.has(key), `${key} must stay persisted`).toBe(false)
      }
    }
    // A fan-out's notes rows are every fan-out's, whatever the node.
    expect(EXECUTION_DATA_KEYS.has("__listResultMeta")).toBe(true)
  })

  it("never files those generic names as run state of another node: a setting stored under one stays a setting", () => {
    for (const key of ["ugcOutputs", UGC_CREATOR_CANDIDATES_KEY, "optionFailed", "quote", "clipWarnings", "durationSec", "rerenderPending"]) {
      expect(EXECUTION_DATA_KEYS.has(key), `${key} must not be global`).toBe(false)
      expect(isExecutionDataKey(key, "llm-chat"), key).toBe(false)
      expect(isExecutionDataKey(key, "video-overlay"), key).toBe(false)
      expect(isExecutionDataKey(key, undefined), key).toBe(false)
    }
    // Each type's list is its own: UGC Clips' quote is not UGC Script's.
    expect(isExecutionDataKey("quote", "ugc-script")).toBe(false)
    expect(isExecutionDataKey("candidates", "ugc-clip")).toBe(false)
  })

  it("files only UGC types' and Suno Separate's own names: Video Overlay's results stay as every other surface reads them", () => {
    // Presets capture them, Reset clears them, exports and the Copilot keep them — as on any node.
    for (const key of ["durationSec", "width", "height", "warnings", "resultCompositionKey"]) {
      expect(isExecutionDataKey(key, "video-overlay"), key).toBe(false)
    }
    expect(executionDataKeysOf("video-overlay")).toBe(EXECUTION_DATA_KEYS)
    for (const type of Object.keys(NODE_TYPE_EXECUTION_DATA_KEYS)) expect(type, type).toMatch(/^(ugc-|suno-separate$)/)
  })

  it("files every Suno Separate result field and run fact as that type's run result: never undo, preset or template state", () => {
    for (const key of [...SUNO_SEPARATE_RESULT_FIELDS, "engineUsed", "sunoRefused", "fallbackReason", "separateType"]) {
      expect(isExecutionDataKey(key, "suno-separate"), key).toBe(true)
      expect(TRANSIENT_RUNTIME_KEYS.has(key), `${key} must stay persisted`).toBe(false)
    }
  })

  it("never files Suno Separate's settings as run state, nor its result names on another node", () => {
    // stemName is the instrument SETTING (the run only echoes it back).
    for (const key of ["stemName", "type", "fallbackToDemucs", "taskId", "audioId", "label"]) {
      expect(isExecutionDataKey(key, "suno-separate"), key).toBe(false)
    }
    for (const key of ["vocalUrl", "isolatedUrl", "engineUsed"]) {
      expect(isExecutionDataKey(key, "audio-separation"), key).toBe(false)
      expect(isExecutionDataKey(key, undefined), key).toBe(false)
    }
  })

  it("a type's own keys come with every global one, as a set", () => {
    const ugcClip = executionDataKeysOf("ugc-clip")
    for (const key of EXECUTION_DATA_KEYS) expect(ugcClip.has(key), key).toBe(true)
    expect(ugcClip.has("clipWarnings")).toBe(true)
    expect(executionDataKeysOf("llm-chat")).toBe(EXECUTION_DATA_KEYS)
    expect(executionDataKeysOf(undefined)).toBe(EXECUTION_DATA_KEYS)
  })

  it("never files a UGC node's choices as run state: an edit of one stays undoable", () => {
    for (const key of ["keepResult", "rerender", "voiceId", "source", "gender", "photoUrl", "categoryOverride", "seed", "targetDurationSec"]) {
      for (const type of ["ugc-creator", "ugc-script", "ugc-clips", "ugc-clip", "ugc-cards"]) {
        expect(isExecutionDataKey(key, type), `${type}.${key}`).toBe(false)
      }
    }
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
