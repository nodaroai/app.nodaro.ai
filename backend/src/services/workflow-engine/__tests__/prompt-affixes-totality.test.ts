/**
 * TOTALITY GUARD for prompt pre/post text (spec §5 / §10).
 *
 * Every affix-capable node type (the registry in @nodaro/prompts, never a
 * hand-list) is run through the orchestrator's payload builders with a typed
 * core prompt + affix markers. The markers must land in the payload EXACTLY
 * ONCE — a missed read site (marker absent) and a double application (helper +
 * a bespoke wrap on the same path) both fail here.
 *
 * If a type throws for a missing non-prompt input, add the minimal field to
 * EXTRA_DATA / INPUTS. Never remove a type from the loop.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { buildSyncHttpBody } from "../node-executor.js"
import { PROMPT_AFFIX_NODE_TYPES, promptAffixCoreField } from "@nodaro/prompts"
import type { SimpleNode, ResolvedInputs, OrchestratorContext } from "../types.js"

const PRE = "PREFIXMARK"
const POST = "SUFFIXMARK"
const CORE = "COREMARK"

/** Types the orchestrator dispatches through the sync-HTTP lane (buildSyncHttpBody). */
const SYNC_LANE = new Set(["llm-chat", "image-to-text", "suno-style-boost", "image-critic", "3d-title"])
/** Types with a prompt read in BOTH lanes — assert both. */
const BOTH_LANES = new Set(["motion-graphics"])
/** Minimal extra data so the builder reaches the prompt read. */
const EXTRA_DATA: Record<string, Record<string, unknown>> = {
  "text-to-speech": { textSource: "direct" },
  // validateCinematicAvatarPayload rejects a look-less payload before the
  // prompt ever reaches the payload object.
  "cinematic-avatar": { avatarLooks: ["look-1"] },
  // Only the lottie engine is worker-queued; the elements engine throws in
  // buildPayload (it runs on the sync-HTTP lane, asserted separately above).
  "motion-graphics": { engine: "lottie" },
  "suno-extend": { audioId: "a1" },
  "suno-replace-section": { taskId: "t1", audioId: "a1" },
  "suno-upload-extend": { uploadUrl: "https://x/a.mp3" },
  "video-analysis": { videoUrl: "https://x/v.mp4" },
  "video-retake": { videoUrl: "https://x/v.mp4" },
}
const INPUTS: ResolvedInputs = {
  imageUrl: "https://x/i.png",
  videoUrl: "https://x/v.mp4",
  audioUrl: "https://x/a.mp3",
}
const CTX = { userId: "u1" } as OrchestratorContext

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

function nodeFor(type: string): SimpleNode {
  // The data key the RUN wraps — from the shared registry helper (spec §7
  // overrides included), the SAME one the editor's Final view gates on.
  const coreField = promptAffixCoreField(type)!
  return {
    id: "n1",
    type,
    data: { label: type, [coreField]: CORE, promptPrefix: PRE, promptSuffix: POST, ...(EXTRA_DATA[type] ?? {}) },
  }
}

function serialize(type: string, lane: "payload" | "sync"): string {
  const node = nodeFor(type)
  if (lane === "sync") return JSON.stringify(buildSyncHttpBody(node, INPUTS, CTX, undefined, new Map()))
  return JSON.stringify(buildPayload(node, "job-1", INPUTS))
}

describe("prompt affixes reach every affix-capable node's payload exactly once", () => {
  for (const type of [...PROMPT_AFFIX_NODE_TYPES].sort()) {
    const lanes: Array<"payload" | "sync"> = BOTH_LANES.has(type)
      ? ["payload", "sync"]
      : SYNC_LANE.has(type) ? ["sync"] : ["payload"]
    for (const lane of lanes) {
      it(`${type} (${lane} lane)`, () => {
        const json = serialize(type, lane)
        expect(count(json, `${PRE} ${CORE} ${POST}`)).toBe(1)
        expect(count(json, PRE)).toBe(1)
        expect(count(json, POST)).toBe(1)
      })
    }
  }

  it("a node with NO affixes is byte-identical to before (no-op guarantee)", () => {
    const plain = buildPayload({ id: "n1", type: "generate-music", data: { prompt: "a jazzy tune" } }, "job-1", {})
    expect(plain.payload.prompt).toBe("a jazzy tune")
  })

  it("text-prompt is NOT affix-capable", () => {
    expect(PROMPT_AFFIX_NODE_TYPES.has("text-prompt")).toBe(false)
  })

  it("lip-sync: affixes wrap the typed prompt, the built-in default is only used when nothing is typed", () => {
    const withText = buildPayload({ id: "n1", type: "lip-sync", data: { prompt: CORE, promptPrefix: PRE } }, "j", INPUTS)
    expect(withText.payload.prompt).toBe(`${PRE} ${CORE}`)
    const noText = buildPayload({ id: "n1", type: "lip-sync", data: {} }, "j", INPUTS)
    expect(noText.payload.prompt).toBe("A person talking naturally")
  })
})
