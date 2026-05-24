/**
 * CONSOLIDATED Generate Text (llm-chat) parity regression net — backend + shared.
 *
 * `ai-writer` was merged into `llm-chat` ("Generate Text"). An audit found 17
 * sets/maps where ONLY `ai-writer` lived; `llm-chat` was added to every one of
 * them. This file is the PERMANENT guard: it asserts `llm-chat` is a member of
 * each backend + `@nodaro/shared` set the merge touched, so a future refactor
 * that silently drops it from any single set fails LOUDLY here instead of in
 * production (a missing classification turns into a stale `pending` jobs row +
 * `buildPayload` "Unknown node type" → whole-workflow failure; a missing label
 * map turns into a raw `llm-chat` slug in the UI; a missing passthrough/ref set
 * silently breaks ancestor-image collection; etc.).
 *
 * Each assertion is written so that REMOVING `llm-chat` from the underlying set
 * changes the asserted value. Where the set itself isn't exported (it's private
 * to a module), we assert via the PUBLIC consumer that reads it — that survives
 * refactors of the internal representation while still detecting the removal.
 *
 * The frontend half of the net lives in
 *   frontend/src/components/editor/workflow-editor/__tests__/generate-text-parity.test.ts
 * (a test can only import its own workspace + shared, so the two halves are split).
 *
 * NOT duplicated here (covered elsewhere, referenced for completeness):
 *   - items consumption + DAG fan-out parity → generate-text-dag-consume.test.ts
 *   - GAP A: DAG body forwards image+video+audio refs → sync-http-body.test.ts
 *   - splitGeneratedItems unit behaviour → @nodaro/shared generate-text-items.test.ts
 *   - NODE_REGISTRY has llm-chat (not ai-writer) → node-registry-sync.test.ts
 *   - node-default-mappings model-field mapping → @nodaro/shared node-default-mappings.test.ts
 */

import { describe, it, expect } from "vitest"
import {
  // node-default-mappings — META.field discriminator (private META, public getter)
  getTargetField,
  NODE_DEFAULT_TYPES,
  // presentation-utils — TEXT_OUTPUT_TYPES + MEDIA_PRODUCING_TYPES (private sets, public consumers)
  getOutputType,
  getOutputNodes,
  // repeat-types — REPEATABLE_NODE_TYPES (exported)
  REPEATABLE_NODE_TYPES,
  // ancestor-refs — PASSTHROUGH_TYPES (exported)
  PASSTHROUGH_TYPES,
  // node-mappable-fields — NODE_MAPPABLE_FIELDS (exported)
  NODE_MAPPABLE_FIELDS,
  // llm-models — LLM_FEATURE_DEFAULTS + LlmFeature (exported)
  LLM_FEATURE_DEFAULTS,
  // generate-text-items — the helper both executors share (exported)
  splitGeneratedItems,
  GENERATE_TEXT_DELIMITER,
} from "@nodaro/shared"
import type { GenericNode, GenericEdge } from "@nodaro/shared"
import { TEXT_SOURCE_TYPES } from "../execution-graph.js"
import { SYNC_HTTP_ROUTES } from "../node-executor.js"
import { buildNodeOutputFromJobData } from "../output-extractor.js"
import { NODE_REGISTRY } from "../../../lib/node-registry.js"
import { buildStatsKey } from "../../execution-stats.js"

const NODE = "llm-chat"

// ───────────────────────────────────────────────────────────────────────────
// (A.1) @nodaro/shared sets the merge added llm-chat to
// ───────────────────────────────────────────────────────────────────────────

describe("shared parity net — llm-chat ∈ every shared set the merge touched", () => {
  it("node-default-mappings: getTargetField('llm-chat') === 'model' (META entry present)", () => {
    // META is private; getTargetField is the public consumer. If the llm-chat
    // entry were dropped from META, this throws (undefined.field) — also a
    // failure, which is the point.
    expect(getTargetField(NODE)).toBe("model")
  })

  it("node-default-mappings: 'llm-chat' ∈ NODE_DEFAULT_TYPES", () => {
    expect((NODE_DEFAULT_TYPES as readonly string[]).includes(NODE)).toBe(true)
  })

  it("presentation-utils: getOutputType('llm-chat') === 'text' (TEXT_OUTPUT_TYPES membership)", () => {
    // TEXT_OUTPUT_TYPES is private; getOutputType reads it. Removing llm-chat
    // would drop it to the 'data' fallback.
    expect(getOutputType(NODE)).toBe("text")
  })

  it("presentation-utils: llm-chat counts as a MEDIA_PRODUCING output node even with an outgoing edge", () => {
    // MEDIA_PRODUCING_TYPES is private; getOutputNodes is the consumer. A node
    // with presentationVisible=true AND an outgoing edge is only returned as an
    // output when its type is in MEDIA_PRODUCING_TYPES. We give the llm-chat
    // node a downstream consumer so the ONLY way it qualifies is membership.
    const nodes: GenericNode[] = [
      { id: "llm", type: NODE, data: { presentationVisible: true } },
      { id: "down", type: "generate-image", data: {} },
    ]
    const edges: GenericEdge[] = [
      { source: "llm", target: "down" },
    ]
    const outputs = getOutputNodes(nodes, edges)
    expect(outputs.map((n) => n.id)).toContain("llm")
  })

  it("repeat-types: 'llm-chat' ∈ REPEATABLE_NODE_TYPES", () => {
    expect(REPEATABLE_NODE_TYPES.has(NODE)).toBe(true)
  })

  it("ancestor-refs: 'llm-chat' ∈ PASSTHROUGH_TYPES (ancestor image collection traverses through it)", () => {
    expect(PASSTHROUGH_TYPES.has(NODE)).toBe(true)
  })

  it("node-mappable-fields: NODE_MAPPABLE_FIELDS['llm-chat'] exposes systemPrompt + userInput", () => {
    const fields = NODE_MAPPABLE_FIELDS[NODE]
    expect(fields).toBeDefined()
    expect(fields).toContain("systemPrompt")
    expect(fields).toContain("userInput")
  })

  it("llm-models: LLM_FEATURE_DEFAULTS['llm-chat'] is set (feature → default model)", () => {
    // Removing the 'llm-chat' key drops this to undefined.
    expect(LLM_FEATURE_DEFAULTS[NODE]).toBeTruthy()
    expect(typeof LLM_FEATURE_DEFAULTS[NODE]).toBe("string")
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (A.2) backend sets the merge added llm-chat to
// ───────────────────────────────────────────────────────────────────────────

describe("backend parity net — llm-chat ∈ every backend set the merge touched", () => {
  it("execution-graph: 'llm-chat' ∈ TEXT_SOURCE_TYPES (orchestrator treats its output as a text source)", () => {
    expect(TEXT_SOURCE_TYPES.has(NODE)).toBe(true)
  })

  it("node-executor: 'llm-chat' ∈ SYNC_HTTP_ROUTES → /v1/llm-chat/generate (sync-HTTP dispatch)", () => {
    // SYNC_HTTP_NODES is private but mirrors SYNC_HTTP_ROUTES; the exported
    // route map is what the orchestrator dispatches against. A missing entry
    // means buildSyncHttpBody has no path and the node can't execute server-side.
    expect(SYNC_HTTP_ROUTES[NODE]).toBe("/v1/llm-chat/generate")
  })

  it("output-extractor: buildNodeOutputFromJobData emits items[] ONLY for llm-chat (merge-specific branch)", () => {
    // The llm-chat-specific branch in buildNodeOutputFromJobData splits the
    // generatedText into items on ===NEXT===. ai-writer (and any other text
    // node) must NOT get items — proves the branch is keyed on llm-chat.
    const llm = buildNodeOutputFromJobData(
      { generatedText: "p1===NEXT===p2", model: "x", usage: {} },
      NODE,
    )
    expect(llm.text).toBe("p1===NEXT===p2")
    expect(llm.items).toEqual(["p1", "p2"])

    const aiWriter = buildNodeOutputFromJobData(
      { generatedText: "p1===NEXT===p2", model: "x", usage: {} },
      "ai-writer",
    )
    expect(aiWriter.items).toBeUndefined()
  })

  it("node-registry: NODE_REGISTRY exposes llm-chat as 'Generate Text' / text output (and NOT ai-writer)", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === NODE)
    expect(entry).toBeDefined()
    expect(entry?.label).toBe("Generate Text")
    expect(entry?.outputType).toBe("text")
    expect(NODE_REGISTRY.some((n) => n.type === "ai-writer")).toBe(false)
  })

  it("execution-stats: buildStatsKey routes 'llm-chat' through the LLM group (reads llmModel, not the node type)", () => {
    // LLM-group case → model_identifier = inputData.llmModel. If the
    // `case "llm-chat"` were removed it would fall to the default case →
    // model_identifier = "llm-chat". Asserting the model id detects removal.
    const key = buildStatsKey(NODE, { llmModel: "claude-sonnet-4.6" })
    expect(key).not.toBeNull()
    expect(key?.model_identifier).toBe("claude-sonnet-4.6")
    expect(key?.model_identifier).not.toBe(NODE)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (C) Cross-executor item-split parity.
//
// Both executors split the `items` handle via the SAME shared helper:
//   - frontend single-node executor: execute-node.ts + node-input-resolver.ts
//     both `import { splitGeneratedItems } from "@nodaro/shared"`
//   - backend orchestrator: output-extractor.ts uses it in
//     buildNodeOutputFromJobData (asserted above) + getListInputForNode
//     (asserted in generate-text-dag-consume.test.ts).
//
// Because they import the identical function, locking splitGeneratedItems'
// contract here is the cross-reference: the SAME input yields the SAME items on
// both sides. generate-text-dag-consume.test.ts already proves the backend
// `items` path equals splitGeneratedItems; this anchors the canonical result.
// ───────────────────────────────────────────────────────────────────────────

describe("cross-executor item-split parity — shared splitGeneratedItems is the single source", () => {
  it("the canonical ===NEXT=== split both executors call", () => {
    expect(splitGeneratedItems("p1===NEXT===p2")).toEqual(["p1", "p2"])
    expect(GENERATE_TEXT_DELIMITER).toBe("===NEXT===")
  })

  it("backend buildNodeOutputFromJobData items == splitGeneratedItems (same helper, same result)", () => {
    const text = "a===NEXT===b===NEXT===c"
    const out = buildNodeOutputFromJobData({ generatedText: text, model: "x", usage: {} }, NODE)
    expect(out.items).toEqual(splitGeneratedItems(text))
  })
})
