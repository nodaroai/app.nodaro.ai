import { describe, it, expect } from "vitest"
import { NODE_PROMPT_FIELDS, getPromptFields, nodeHasPromptField } from "./prompt-fields"
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
