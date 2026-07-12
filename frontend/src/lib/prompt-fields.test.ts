import { describe, it, expect } from "vitest"
import { NODE_PROMPT_FIELDS, getPromptFields, nodeHasPromptField, getSnippetMedia, nodeHasInlinePrompt } from "./prompt-fields"
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

describe("inline-prompt capability (media-preview nodes)", () => {
  // The EXACT set of node types that render the inline on-node prompt editor —
  // the media-preview nodes (image/video/audio result body). BaseNode renders
  // InlineNodePrompt centrally for these via `nodeHasInlinePrompt`. Listed
  // explicitly so any change to which nodes get the inline editor is a conscious,
  // reviewed edit — not silent drift. (Text/utility nodes keep the bottom-button
  // + quick-edit modal only.)
  const EXPECTED_INLINE = new Set([
    // image
    "generate-image", "modify-image", "generate-mask",
    // video
    "generate-video", "generate-video-pro", "text-to-video", "image-to-video", "video-to-video",
    "switchx", "extend-video", "speech-to-video", "motion-transfer",
    "cinematic-avatar", "video-retake", "video-sfx",
    // audio / music / speech / voice
    "generate-music", "suno-generate", "suno-cover", "suno-extend",
    "suno-replace-section", "suno-upload-extend", "text-to-audio",
    "text-to-speech", "voice-design", "voice-remix", "lip-sync",
  ])

  it("every prompt-field entry declares inline as a boolean (required)", () => {
    for (const [nodeType, spec] of Object.entries(NODE_PROMPT_FIELDS)) {
      expect(typeof spec.inline, `inline for ${nodeType}`).toBe("boolean")
    }
  })

  it("the inline:true set matches the documented media-preview node set", () => {
    const actual = new Set(
      Object.entries(NODE_PROMPT_FIELDS).filter(([, s]) => s.inline).map(([t]) => t),
    )
    const missing = [...EXPECTED_INLINE].filter((t) => !actual.has(t))
    const extra = [...actual].filter((t) => !EXPECTED_INLINE.has(t))
    expect(missing, `expected inline:true but isn't: ${missing.join(", ")}`).toEqual([])
    expect(extra, `inline:true but not in the expected set: ${extra.join(", ")}`).toEqual([])
  })

  it("nodeHasInlinePrompt resolves per node type", () => {
    expect(nodeHasInlinePrompt("generate-image")).toBe(true)
    expect(nodeHasInlinePrompt("voice-design")).toBe(true)
    expect(nodeHasInlinePrompt("llm-chat")).toBe(false)
    expect(nodeHasInlinePrompt("image-critic")).toBe(false)
    expect(nodeHasInlinePrompt("unknown-node")).toBe(false)
  })
})
