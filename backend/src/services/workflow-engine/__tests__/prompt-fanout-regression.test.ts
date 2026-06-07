/**
 * Regression tests for the FE/BE prompt-precedence unification (Task 9 of 10).
 *
 * Two behaviors the migration depends on, locked at the REAL build-path level
 * (`buildPayload` / `buildSyncHttpBody`) so they can't silently regress:
 *
 *   A/B. List fan-out wins. When list fan-out splits a list into a node, it
 *        sets the highest-precedence `resolvedInputs.overridePrompt` to the
 *        per-item value (text items only, via `overrideInputWithListItem`).
 *        That override MUST beat a typed `data.prompt` / `data.userInput` /
 *        `data.directText` / `data.caption`. Without it a fan-out into a node
 *        that ALSO has a typed prompt would emit the typed prompt N times
 *        (the exact bug the override field was added to prevent). Precedence
 *        is implemented once in `resolvePrompt` (override > typed > wired) and
 *        wired into every case via `computeNodePrompt` / `computeLlmChatFields`.
 *
 *   C.   generate-video keeps motionPrompt. The unified generate-video node's
 *        legacy inline picker writes `data.motionPrompt`, not `data.prompt`.
 *        `NODE_PROMPT_CANDIDATE_FIELDS["generate-video"] === ["prompt","motionPrompt"]`,
 *        so an empty `data.prompt` with a non-empty `data.motionPrompt` must
 *        resolve the prompt to motionPrompt — in BOTH the main (kling/veo)
 *        t2v branch AND the LTX branch (both call `computeNodePrompt`).
 *
 * These exercise the production `buildPayload` / `buildSyncHttpBody` directly
 * (no re-implementation of precedence in the test) — the same way the existing
 * payload-builder.test.ts / sync-http-body.test.ts / ltx-dispatch.test.ts do.
 */

import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { buildSyncHttpBody } from "../node-executor.js"
import type {
  SimpleNode,
  ResolvedInputs,
  OrchestratorContext,
} from "../types.js"

function node(type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id: "n1", type, data }
}

const JOB_ID = "job-1"

const CTX: OrchestratorContext = {
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
}

// ---------------------------------------------------------------------------
// A + B. Override (list fan-out per-item value) beats a typed prompt.
// ---------------------------------------------------------------------------

describe("list fan-out override beats typed prompt", () => {
  describe("via buildPayload (worker-queued nodes)", () => {
    it("generate-image: overridePrompt wins over typed data.prompt", () => {
      const n = node("generate-image", { prompt: "typed prompt" })
      const inputs: ResolvedInputs = { overridePrompt: "ITEM-VALUE" }
      const result = buildPayload(n, JOB_ID, inputs)
      expect(result.payload.prompt).toBe("ITEM-VALUE")
    })

    it("image-to-video: overridePrompt wins over typed data.prompt", () => {
      // image-to-video needs a primary frame to not fall back to a mention
      // URL slot; supply a minimal imageUrl so only the prompt field varies.
      const n = node("image-to-video", { provider: "kling", prompt: "typed prompt", duration: 5 })
      const inputs: ResolvedInputs = {
        overridePrompt: "ITEM-VALUE",
        imageUrl: "https://img.png",
      }
      const result = buildPayload(n, JOB_ID, inputs)
      expect(result.payload.prompt).toBe("ITEM-VALUE")
    })

    it("text-to-speech: overridePrompt wins over typed directText (direct source)", () => {
      // directText is only a typed candidate when textSource === "direct".
      const n = node("text-to-speech", { textSource: "direct", directText: "typed" })
      const inputs: ResolvedInputs = { overridePrompt: "ITEM" }
      const result = buildPayload(n, JOB_ID, inputs)
      // TTS payload carries the resolved string on `text`.
      expect(result.payload.text).toBe("ITEM")
    })
  })

  describe("via buildSyncHttpBody (sync-HTTP nodes)", () => {
    it("llm-chat: overridePrompt wins over typed data.userInput", () => {
      const body = buildSyncHttpBody(
        node("llm-chat", { systemPrompt: "data-sys", userInput: "typed-user" }),
        { overridePrompt: "ITEM" },
        CTX,
      )
      expect(body.userInput).toBe("ITEM")
      // Override applies to userInput only — systemPrompt stays typed-primary.
      expect(body.systemPrompt).toBe("data-sys")
    })
  })
})

// ---------------------------------------------------------------------------
// C. generate-video resolves the prompt from data.motionPrompt when
//    data.prompt is empty — in both the main and LTX branches.
// ---------------------------------------------------------------------------

describe("generate-video keeps motionPrompt when data.prompt is empty", () => {
  it("main t2v branch (no image inputs): prompt resolves to motionPrompt", () => {
    // kling provider, no wired media → text-to-video main path. No upstream
    // hint nodes, so composeVideoPrompt passes the raw prompt through verbatim.
    const n = node("generate-video", {
      provider: "kling",
      prompt: "",
      motionPrompt: "a dragon flying",
    })
    const result = buildPayload(n, JOB_ID, {}, undefined, {
      nodes: [n],
      edges: [],
      nodeStates: {},
    })
    expect(result.jobName).toBe("text-to-video")
    expect(result.payload.prompt).toBe("a dragon flying")
  })

  it("LTX branch (ltx-2.3-pro, no inputs): prompt resolves to motionPrompt", () => {
    // ltx-2.3-pro provider forces the dedicated LTX dispatch; with no media
    // wired it picks the text_to_video task and sets payload.prompt directly
    // from computeNodePrompt (no composeVideoPrompt step on this branch).
    const n = node("generate-video", {
      provider: "ltx-2.3-pro",
      prompt: "",
      motionPrompt: "a dragon flying",
    })
    const result = buildPayload(n, JOB_ID, {}, undefined, {
      nodes: [n],
      edges: [],
      nodeStates: {},
    })
    expect(result.payload.task).toBe("text_to_video")
    expect(result.payload.prompt).toBe("a dragon flying")
  })
})
