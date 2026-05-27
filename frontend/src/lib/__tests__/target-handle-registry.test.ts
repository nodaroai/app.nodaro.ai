import { describe, expect, it } from "vitest"
import { TARGET_HANDLE_ACCEPTS, getTargetHandlesAccepting, ACCEPTS_PARAMETER_PICKER } from "../target-handle-registry"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES, AUDIO_PARAMETER_PICKER_NODE_TYPES } from "../parameter-picker-types"

describe("target-handle-registry", () => {
  it("generate-image declares all 6 input handles", () => {
    const handles = TARGET_HANDLE_ACCEPTS["generate-image"]
    expect(handles).toBeDefined()
    const ids = handles!.map(h => h.handleId).sort()
    expect(ids).toEqual(["assets", "elements", "look", "negative", "prompt", "references"])
  })

  it("getTargetHandlesAccepting('mood') returns generate-image.look (mood is a look-family picker)", () => {
    const matches = getTargetHandlesAccepting("mood")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`)
    expect(pairs).toContain("generate-image:look")
  })

  it("getTargetHandlesAccepting('person') returns generate-image.elements (person is an elements-family picker)", () => {
    const matches = getTargetHandlesAccepting("person")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`)
    expect(pairs).toContain("generate-image:elements")
  })

  it("getTargetHandlesAccepting('character') returns generate-image.assets", () => {
    const matches = getTargetHandlesAccepting("character")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`)
    expect(pairs).toContain("generate-image:assets")
  })

  it("getTargetHandlesAccepting('generate-image') returns generate-image.references", () => {
    const matches = getTargetHandlesAccepting("generate-image")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`)
    expect(pairs).toContain("generate-image:references")
  })

  it("getTargetHandlesAccepting('nonexistent') returns []", () => {
    expect(getTargetHandlesAccepting("nonexistent")).toEqual([])
  })

  // Regression: audio pickers must NOT match the visual generate-image
  // handles. The registry's accepts() used to call `isPickerNodeType` (the
  // broad set) while the canvas validator used `VISUAL_PARAMETER_PICKER_*`
  // (audio-excluded) — so audio picker pips lit up as "valid candidate"
  // during drag-to-connect, then the drop failed silently.
  it("audio pickers ('music-genre') do NOT match any visual generate-image handle", () => {
    const matches = getTargetHandlesAccepting("music-genre")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`)
    // Both `elements` (accepts non-LOOK pickers) and `prompt` (accepts any
    // picker for variable-mode) used to wrongly include audio pickers.
    expect(pairs).not.toContain("generate-image:elements")
    expect(pairs).not.toContain("generate-image:prompt")
    expect(pairs).not.toContain("generate-image:look")
  })

  it("audio pickers ('voice-character') return empty for generate-image", () => {
    const matches = getTargetHandlesAccepting("voice-character")
    const generateImageMatches = matches.filter(m => m.nodeType === "generate-image")
    expect(generateImageMatches).toEqual([])
  })

  // tone and text-prompt feed camera-motion / transition via the
  // hint-producer predicate even though they aren't in the picker
  // registry. See parameter-prompt-hint.ts L301-304.
  it("'tone' matches camera-motion + transition (hint-producer, not a picker)", () => {
    const matches = getTargetHandlesAccepting("tone")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`).sort()
    expect(pairs).toContain("camera-motion:startState")
    expect(pairs).toContain("camera-motion:endState")
    expect(pairs).toContain("transition:startState")
    expect(pairs).toContain("transition:endState")
  })

  it("'text-prompt' matches camera-motion + transition (hint-producer)", () => {
    const matches = getTargetHandlesAccepting("text-prompt")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`)
    expect(pairs).toContain("camera-motion:startState")
    expect(pairs).toContain("transition:endState")
  })

  // Audio pickers don't contribute usable motion/visual hints — exclude
  // them from camera-motion + transition.
  it("audio pickers do NOT match camera-motion or transition state handles", () => {
    const matches = getTargetHandlesAccepting("music-genre")
    const pairs = matches.map(m => `${m.nodeType}:${m.handleId}`)
    expect(pairs).not.toContain("camera-motion:startState")
    expect(pairs).not.toContain("camera-motion:endState")
    expect(pairs).not.toContain("transition:startState")
    expect(pairs).not.toContain("transition:endState")
  })
})

// ─── HINT_PRODUCER_TYPES contract — drift catcher ──
//
// The predicate `ACCEPTS_PARAMETER_PICKER` is the SINGLE source of truth
// for which sources can wire to camera-motion / transition state handles
// AND light up as valid drag candidates. Its backing set is built by
// spreading `VISUAL_PARAMETER_PICKER_NODE_TYPES` and adding `tone` +
// `text-prompt`. These tests pin that contract so a future PR that
// extends one piece without the other can't silently diverge.
describe("ACCEPTS_PARAMETER_PICKER — HINT_PRODUCER_TYPES contract", () => {
  it("accepts every visual parameter picker", () => {
    const rejected: string[] = []
    for (const t of VISUAL_PARAMETER_PICKER_NODE_TYPES) {
      if (!ACCEPTS_PARAMETER_PICKER(t)) rejected.push(t)
    }
    expect(rejected, `Visual pickers rejected by ACCEPTS_PARAMETER_PICKER: ${rejected.join(", ")}`).toEqual([])
  })

  it("accepts tone and text-prompt (non-tile-grid hint producers)", () => {
    expect(ACCEPTS_PARAMETER_PICKER("tone")).toBe(true)
    expect(ACCEPTS_PARAMETER_PICKER("text-prompt")).toBe(true)
  })

  it("rejects every audio parameter picker", () => {
    const accepted: string[] = []
    for (const t of AUDIO_PARAMETER_PICKER_NODE_TYPES) {
      if (ACCEPTS_PARAMETER_PICKER(t)) accepted.push(t)
    }
    expect(accepted, `Audio pickers wrongly accepted by ACCEPTS_PARAMETER_PICKER: ${accepted.join(", ")}`).toEqual([])
  })

  it("rejects non-hint sources (image producers, identity refs, control nodes)", () => {
    for (const t of ["generate-image", "upload-image", "character", "face", "object", "location", "loop", "list"]) {
      expect(ACCEPTS_PARAMETER_PICKER(t)).toBe(false)
    }
  })

  // Pinned size: VISUAL_PARAMETER_PICKER_NODE_TYPES + 2 (tone, text-prompt).
  // If this fails, a new visual picker was added or removed without
  // updating the audio-vs-visual partition. Update both sides
  // intentionally.
  it("size = |VISUAL_PARAMETER_PICKER_NODE_TYPES| + 2 (tone + text-prompt)", () => {
    // Enumerate the set indirectly via the predicate over a known universe.
    const universe = new Set<string>([
      ...VISUAL_PARAMETER_PICKER_NODE_TYPES,
      ...AUDIO_PARAMETER_PICKER_NODE_TYPES,
      "tone", "text-prompt",
      // Sanity-check non-hint types are excluded.
      "generate-image", "upload-image", "character",
    ])
    let accepted = 0
    for (const t of universe) {
      if (ACCEPTS_PARAMETER_PICKER(t)) accepted++
    }
    expect(accepted).toBe(VISUAL_PARAMETER_PICKER_NODE_TYPES.size + 2)
  })
})
