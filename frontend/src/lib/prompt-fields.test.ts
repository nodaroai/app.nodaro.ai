import { describe, it, expect } from "vitest"
import { NODE_PROMPT_FIELDS, getPromptFields, nodeHasPromptField, getSnippetMedia } from "./prompt-fields"
import { NODE_QUICK_CONFIGS } from "@/components/nodes/node-quick-configs"
import { NODE_DEF_MAP } from "@/types/nodes"

/**
 * Guard for the two bottom-strip registries (the canonical "Prompt → configs →
 * Run" layout): {@link NODE_PROMPT_FIELDS} and {@link NODE_QUICK_CONFIGS}.
 *
 * Both key on node-type strings. A typo'd key, or a stale entry left behind when
 * a node type is renamed/removed from {@link NODE_DEF_MAP}, silently does
 * nothing at runtime — the strip just falls back. This test makes that drift a
 * red build instead: every registry key MUST be a real, registered node type.
 *
 * Caught a real bug: `edit-image` / `image-to-image` were legacy types folded
 * into `modify-image` and dropped from the creatable set, but lingered in both
 * registries as unreachable config.
 */
describe("prompt-fields / quick-config registries stay in sync with node types", () => {
  it("every NODE_PROMPT_FIELDS key is a registered node type", () => {
    const unregistered = Object.keys(NODE_PROMPT_FIELDS).filter((t) => !NODE_DEF_MAP.has(t))
    expect(unregistered, `NODE_PROMPT_FIELDS has keys not in NODE_DEFINITIONS: ${unregistered.join(", ")}`).toEqual([])
  })

  it("every NODE_QUICK_CONFIGS key is a registered node type", () => {
    const unregistered = Object.keys(NODE_QUICK_CONFIGS).filter((t) => !NODE_DEF_MAP.has(t))
    expect(unregistered, `NODE_QUICK_CONFIGS has keys not in NODE_DEFINITIONS: ${unregistered.join(", ")}`).toEqual([])
  })

  it("every prompt spec names a non-empty primary field", () => {
    for (const [type, spec] of Object.entries(NODE_PROMPT_FIELDS)) {
      expect(spec.prompt, `${type} has an empty prompt field`).toBeTruthy()
      if (spec.negative !== undefined) expect(spec.negative, `${type} has an empty negative field`).toBeTruthy()
      if (spec.icon !== undefined) expect(["pencil", "paintbrush"]).toContain(spec.icon)
    }
  })

  // Deeper guard than "prompt field is non-empty string": assert the field a
  // spec names actually EXISTS on the node's defaultData. A registry entry that
  // points at a renamed/nonexistent data field stays green under the shallow
  // check above (it's a truthy string) but is silently dead at runtime — the
  // quick-edit modal reads/writes a key the UI never persists. That's exactly
  // the forced-alignment dead-field class fixed in f45d9118.
  it("every declared prompt/negative field exists on the node's defaultData", () => {
    for (const [nodeType, spec] of Object.entries(NODE_PROMPT_FIELDS)) {
      const def = NODE_DEF_MAP.get(nodeType)
      expect(def, `NODE_DEFINITIONS entry for ${nodeType}`).toBeDefined()
      const defaultData = def!.defaultData as Record<string, unknown>
      expect(
        Object.prototype.hasOwnProperty.call(defaultData, spec.prompt),
        `${nodeType}.${spec.prompt} missing from defaultData`,
      ).toBe(true)
      if (spec.negative) {
        expect(
          Object.prototype.hasOwnProperty.call(defaultData, spec.negative),
          `${nodeType}.${spec.negative} missing from defaultData`,
        ).toBe(true)
      }
    }
  })

  it("every quick-config control names a field and at least one option", () => {
    for (const [type, controls] of Object.entries(NODE_QUICK_CONFIGS)) {
      expect(controls.length, `${type} has no quick-config controls`).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control.field, `${type} control missing field`).toBeTruthy()
        expect(control.options.length, `${type}.${control.field} has no options`).toBeGreaterThan(0)
      }
    }
  })

  it("accessor helpers resolve known and unknown types", () => {
    expect(nodeHasPromptField("generate-image")).toBe(true)
    expect(getPromptFields("generate-image")?.prompt).toBe("prompt")
    expect(nodeHasPromptField("not-a-real-node")).toBe(false)
    expect(getPromptFields(undefined)).toBeUndefined()
  })
})

describe("snippet media declarations", () => {
  it("every prompt-field entry declares a valid snippet media", () => {
    for (const [nodeType, spec] of Object.entries(NODE_PROMPT_FIELDS)) {
      expect(["image", "video", "audio", "text"], `media for ${nodeType}`).toContain(spec.media)
    }
  })
  it("getSnippetMedia resolves per node type", () => {
    expect(getSnippetMedia("generate-image")).toBe("image")
    expect(getSnippetMedia("image-to-video")).toBe("video")
    expect(getSnippetMedia("text-to-speech")).toBe("audio")
    expect(getSnippetMedia("llm-chat")).toBe("text")
    expect(getSnippetMedia("unknown-node")).toBeUndefined()
  })
})
