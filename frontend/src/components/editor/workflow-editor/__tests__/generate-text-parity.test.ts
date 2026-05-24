/**
 * CONSOLIDATED Generate Text (llm-chat) parity regression net — frontend half.
 *
 * Companion to backend/src/services/workflow-engine/__tests__/generate-text-parity.test.ts.
 * A vitest file can only import its own workspace + @nodaro/shared, so the net
 * is split: this file guards the FRONTEND sets the ai-writer → llm-chat merge
 * added `llm-chat` to. If a future refactor drops `llm-chat` from any of them,
 * this fails loudly instead of shipping a broken Run button / a raw `llm-chat`
 * slug in the UI / a wrong fan-out-handle classification.
 *
 * Two assertion styles:
 *  1. RUNTIME IMPORT — for module-level exports (sets, label getters). These
 *     survive reformatting and assert the live value the app uses.
 *  2. SOURCE-TEXT — for constants/functions that are PRIVATE to a heavy `.tsx`
 *     component file (cost-tab, tag-textarea, speech-to-video-node,
 *     workflow-canvas). Importing those pulls in React Flow + Zustand stores +
 *     ee/ hooks, which is brittle and slow for a membership check. We instead
 *     assert the literal `"llm-chat"` appears inside the relevant labelled
 *     region of the source — exactly the pattern node-registry-sync.test.ts
 *     uses to reach the frontend EXECUTABLE_TYPES from the backend. The match
 *     is whitespace-tolerant so it survives reformatting but breaks on removal.
 *
 * NOTE: EXECUTABLE_TYPES.has("llm-chat") is ALSO asserted in
 * workflow-editor/__tests__/types.test.ts — kept here too so this one file is
 * the single place a reviewer checks for "is Generate Text wired into every
 * frontend set?".
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, it, expect } from "vitest"

// Runtime-importable frontend modules ----------------------------------------
import { EXECUTABLE_TYPES } from "../types"
import { getNodeTypeLabel } from "@/lib/template-utils"
import { formatNodeType, JOB_TYPE_LABELS } from "@/components/editor/execution-utils"
import { pickRelevantFields } from "@/lib/node-defaults"
import { MAIN_TEXT_HANDLE, TEXT_PRODUCING_SOURCE_TYPES } from "@/lib/main-text-handle"

const NODE = "llm-chat"

// __dirname shim for ESM. This file sits at
//   frontend/src/components/editor/workflow-editor/__tests__/
// so the frontend src root is five levels up.
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "..", "..", "..") // → frontend/src

function readSrc(relPath: string): string {
  return readFileSync(join(SRC, relPath), "utf8")
}

// ───────────────────────────────────────────────────────────────────────────
// (B.1) Runtime-import guards — module-level frontend sets/maps
// ───────────────────────────────────────────────────────────────────────────

describe("frontend parity net (runtime) — llm-chat ∈ every reachable frontend set", () => {
  it("workflow-editor/types: 'llm-chat' ∈ EXECUTABLE_TYPES (Run button + DAG executor)", () => {
    // Also covered by types.test.ts; duplicated here as the consolidated anchor.
    expect(EXECUTABLE_TYPES.has(NODE)).toBe(true)
  })

  it("template-utils: getNodeTypeLabel('llm-chat') === 'Generate Text' (label map)", () => {
    // NODE_TYPE_LABELS is private; getNodeTypeLabel is the consumer. Removing the
    // llm-chat row drops to the title-cased fallback ("Llm Chat").
    expect(getNodeTypeLabel(NODE)).toBe("Generate Text")
  })

  it("execution-utils: formatNodeType('llm-chat') === 'Generate Text' (JOB_TYPE_LABELS)", () => {
    expect(JOB_TYPE_LABELS[NODE]).toBe("Generate Text")
    expect(formatNodeType(NODE)).toBe("Generate Text")
  })

  it("node-defaults: pickRelevantFields keys 'llm-chat' to ['model'] only (RELEVANT_FIELDS)", () => {
    // RELEVANT_FIELDS is private; pickRelevantFields reads it. With the llm-chat
    // entry → ["model"], so a provider value is dropped. If the entry were
    // removed it falls back to ["provider","model"] and provider would survive —
    // so asserting provider is ABSENT detects removal.
    const picked = pickRelevantFields(NODE, { provider: "should-be-dropped", model: "m1" })
    expect(picked.model).toBe("m1")
    expect(picked.provider).toBeUndefined()
  })

  it("main-text-handle: MAIN_TEXT_HANDLE['llm-chat'] exposes prompt + system-prompt handles", () => {
    const handles = MAIN_TEXT_HANDLE[NODE]
    expect(handles).toBeDefined()
    const fields = handles.map((h) => h.field)
    expect(fields).toContain("userInput")
    expect(fields).toContain("systemPrompt")
  })

  it("main-text-handle: 'llm-chat' ∈ TEXT_PRODUCING_SOURCE_TYPES (auto-fill treats it as text source)", () => {
    expect(TEXT_PRODUCING_SOURCE_TYPES.has(NODE)).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (B.2) Source-text guards — constants private to heavy .tsx component files.
//
// Each asserts the literal "llm-chat" sits inside the specific labelled region
// that drives the merged behaviour, so removal breaks the test even though we
// never import the (heavy) component module.
// ───────────────────────────────────────────────────────────────────────────

describe("frontend parity net (source) — llm-chat in component-private sets", () => {
  it("cost-tab: NODE_TYPE_LABELS maps 'llm-chat' → 'Generate Text'", () => {
    const src = readSrc("components/editor/cost-tab.tsx")
    // Match `"llm-chat": "Generate Text"` tolerant of whitespace.
    expect(src).toMatch(/"llm-chat"\s*:\s*"Generate Text"/)
  })

  it("tag-textarea: nodeTypeCategory classifies 'llm-chat' as the Text bucket", () => {
    const src = readSrc("components/editor/config-panels/tag-textarea.tsx")
    // The Text-category line lists llm-chat then returns "Text".
    const match = src.match(/\[([^\]]*?"llm-chat"[^\]]*?)\]\.includes\(type\)\)\s*return\s*"Text"/)
    expect(
      match,
      'tag-textarea nodeTypeCategory no longer lists "llm-chat" in the line that `return "Text"`. The Generate Text node would fall to the generic "Node" category in the @-mention dropdown.',
    ).not.toBeNull()
  })

  it("speech-to-video-node: TEXT_OUTPUT_TYPES includes 'llm-chat'", () => {
    const src = readSrc("components/nodes/speech-to-video-node.tsx")
    // Assert llm-chat appears within the TEXT_OUTPUT_TYPES array literal.
    const match = src.match(/TEXT_OUTPUT_TYPES\s*=\s*\[([\s\S]*?)\]/)
    expect(match, "TEXT_OUTPUT_TYPES array literal not found in speech-to-video-node.tsx — has the declaration changed?").not.toBeNull()
    expect(match![1]).toMatch(/"llm-chat"/)
  })

  it("workflow-canvas: getMiniMapNodeColor treats 'llm-chat' as a brand-pink AI node", () => {
    const src = readSrc("components/editor/workflow-canvas.tsx")
    // The AI/scene brand-pink branch lists llm-chat as one of its conditions.
    expect(src).toMatch(/nodeType\s*===\s*'llm-chat'/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// (B.3) Source-text guards — three §6.2 sites that contain "llm-chat" today
// but were not yet protected by the parity net. All three live in heavy/ee
// modules (Zustand store, Tiptap suggestion list, an ee/ admin page) that are
// awkward to import for a membership check, so we use the same source-text
// pattern as (B.2). Each MUST fail if "llm-chat" is removed/renamed from the
// specific region that drives the merged Generate Text behaviour.
// ───────────────────────────────────────────────────────────────────────────

describe("frontend parity net (source) — llm-chat in remaining §6.2 sites", () => {
  it("use-workflow-store: text-output extractor reads 'generatedText' for 'llm-chat'", () => {
    const src = readSrc("hooks/use-workflow-store.ts")
    // The text-output conditional is one chain of `t === "<type>"` checks
    // (suno-lyrics / suno-style-boost / ai-writer / llm-chat / generate-script)
    // immediately followed by reading `d.generatedText`. Removing llm-chat from
    // that chain drops the Generate Text node's text from the value extractor.
    const match = src.match(
      /if\s*\(([\s\S]*?)\)\s*\{\s*const\s+v\s*=\s*\(d\.generatedText\s+as\s+string\)/,
    )
    expect(
      match,
      "use-workflow-store text-output `generatedText` conditional not found — has the extractor changed shape?",
    ).not.toBeNull()
    expect(
      match![1],
      'use-workflow-store text-output extractor no longer lists "llm-chat" in the `generatedText` conditional. The Generate Text node\'s output would not be classified as text.',
    ).toMatch(/===\s*"llm-chat"/)
  })

  it("variable-suggestion-list: TYPE_CATEGORY maps 'llm-chat' → 'Text'", () => {
    const src = readSrc("components/editor/config-panels/prompt-editor/variable-suggestion-list.tsx")
    // Match `"llm-chat": "Text"` tolerant of whitespace. Removing the row drops
    // the Generate Text node out of the Text group in the @-mention dropdown.
    expect(src).toMatch(/"llm-chat"\s*:\s*"Text"/)
  })

  it("admin/node-defaults: GROUPS nodeTypes array lists 'llm-chat' (LLM-driven group)", () => {
    const src = readSrc("ee/app/(admin)/admin/node-defaults/page.tsx")
    // The admin node-defaults page groups node types into `nodeTypes: [...]`
    // arrays; llm-chat belongs to the LLM-driven group. Assert at least one
    // `nodeTypes: [ ... "llm-chat" ... ]` array literal still contains it, so
    // the Generate Text node stays configurable in admin defaults.
    const match = src.match(/nodeTypes\s*:\s*\[[^\]]*?"llm-chat"[^\]]*?\]/)
    expect(
      match,
      'admin/node-defaults no longer lists "llm-chat" in any GROUPS `nodeTypes` array. The Generate Text node would disappear from the admin node-defaults page.',
    ).not.toBeNull()
  })
})
