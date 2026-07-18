import { describe, it, expect } from "vitest"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared"
import { MAIN_TEXT_HANDLE, TEXT_PRODUCING_SOURCE_TYPES } from "../main-text-handle"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"

/**
 * Types that intentionally produce NO prompt hint (pure runtime parameters —
 * counts, durations, aspect ratios, legacy motion intensity). Spelled out as
 * literals here — not imported from the implementation — so this test pins
 * the contract instead of echoing whatever the source derives.
 *
 * Keep in lockstep with HINT_EXEMPT_PARAMETER_TYPES in
 * packages/prompts/src/parameter-prompt-hint.ts and the HINT_EXEMPT set in
 * packages/prompts/src/__tests__/parameter-registry-sync.test.ts.
 */
const HINT_EXEMPT = ["motion", "scene-count", "duration", "aspect-ratio"] as const

describe("TEXT_PRODUCING_SOURCE_TYPES ↔ PARAMETER_NODE_TYPES", () => {
  // Every hint-capable parameter type must be text-producing, or wiring it
  // into a main text handle is canvas-legal but silently dead: no {Label}
  // auto-fill fires, the parameter branch in node-input-resolver deliberately
  // skips inputs.prompt, and collectCinematographyHints only walks the
  // look-family handles. This exact gap shipped for the whole Object picker
  // family (animal / vehicle / weapon / furniture / material) plus
  // transition, character-fx, loop-subject, and the five sound pickers.
  for (const type of PARAMETER_NODE_TYPES) {
    if ((HINT_EXEMPT as readonly string[]).includes(type)) continue
    it(`hint-capable parameter type "${type}" is in TEXT_PRODUCING_SOURCE_TYPES`, () => {
      expect(
        TEXT_PRODUCING_SOURCE_TYPES.has(type),
        `"${type}" produces a prompt hint but is missing from TEXT_PRODUCING_SOURCE_TYPES — ` +
          `wiring it into a prompt handle will silently inject nothing.`,
      ).toBe(true)
    })
  }

  // Hint-exempt types must NOT be text-producing: their extracted output is
  // undefined, so the auto-filled {Label} would stay in the outgoing prompt
  // as literal brace text (the style-guide bug, pre-fix).
  for (const type of HINT_EXEMPT) {
    it(`hint-exempt type "${type}" is NOT in TEXT_PRODUCING_SOURCE_TYPES`, () => {
      expect(
        TEXT_PRODUCING_SOURCE_TYPES.has(type),
        `"${type}" produces no prompt hint — auto-filling {Label} for it creates a ref that never resolves.`,
      ).toBe(false)
    })
  }
})

describe("MAIN_TEXT_HANDLE ids match rendered typed handles", () => {
  // The {Label} auto-fill matches on the exact connection targetHandle id. A
  // stale id (the old "in" era) means the auto-fill never fires for that node
  // even though the mapping exists. Validate every entry against the typed
  // target-handle registry — the single source of truth for rendered handles.
  // text-to-video renders GenerateVideoNode, so it shares generate-video's
  // handle set.
  const REGISTRY_ALIAS: Record<string, string> = { "text-to-video": "generate-video" }

  for (const [nodeType, mappings] of Object.entries(MAIN_TEXT_HANDLE)) {
    const registryKey = REGISTRY_ALIAS[nodeType] ?? nodeType
    const entries = TARGET_HANDLE_ACCEPTS[registryKey]
    if (!entries) continue // legacy node without typed handles — nothing to check against
    const rendered = new Set(entries.map((e) => e.handleId))
    for (const m of mappings) {
      it(`"${nodeType}" main text handle "${m.handle}" is a rendered handle`, () => {
        expect(
          rendered.has(m.handle),
          `MAIN_TEXT_HANDLE["${nodeType}"] maps handle "${m.handle}" but the node renders ` +
            `[${[...rendered].join(", ")}] — the {Label} auto-fill can never fire on a stale id.`,
        ).toBe(true)
      })
    }
  }
})
