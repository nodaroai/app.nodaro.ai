import { describe, expect, it } from "vitest"
import { getPickerOutputMeta, getPickerDefaultSourceHandle, getPickerDefaultSourceHandleTypes, getRegisteredPickerTypes, isPickerNodeType, isTileGridPickerType, PICKER_FAMILY_COLORS } from "../picker-handles"
import { PARAMETER_PICKER_NODE_TYPES } from "../parameter-picker-types"

describe("picker-handles", () => {
  it("families map to the canonical Generate Image colors", () => {
    expect(PICKER_FAMILY_COLORS.look).toBe("#818CF8")     // indigo (Generate Image `look`)
    expect(PICKER_FAMILY_COLORS.elements).toBe("#818CF8") // indigo (Generate Image `elements`)
    expect(PICKER_FAMILY_COLORS.asset).toBe("#F472B6")    // pink (Generate Image `assets`)
    expect(PICKER_FAMILY_COLORS.text).toBe("#22D3EE")     // cyan (Generate Image `prompt`)
    expect(PICKER_FAMILY_COLORS.audio).toBe("#F59E0B")    // amber (Generate Music/audio handles)
    expect(PICKER_FAMILY_COLORS.motion).toBe("#A78BFA")   // violet (camera-motion + transition)
  })

  it("look-family pickers all get indigo + 'look' family", () => {
    // Icon is now sourced from the node component (passed via the shell's
    // own `icon` prop) so the registry only tracks family + color + label.
    const lookFamily = ["lens", "lighting", "mood", "atmosphere", "styling", "pose", "framing", "aesthetic", "era", "photo-genre", "backdrop", "color-look", "photographer", "render-quality", "composition-effects", "post-process-effects", "exposure-settings", "temporal", "style", "camera-format"]
    for (const t of lookFamily) {
      const meta = getPickerOutputMeta(t)
      expect(meta?.family, `${t} should be look family`).toBe("look")
      expect(meta?.color).toBe("#818CF8")
    }
  })

  it("elements-family pickers get indigo with Sparkles", () => {
    const elementsFamily = ["setting", "action-fx", "loop-subject", "person", "animal", "vehicle", "weapon", "furniture", "held-prop", "material", "character-fx"]
    for (const t of elementsFamily) {
      const meta = getPickerOutputMeta(t)
      expect(meta?.family, `${t} should be elements family`).toBe("elements")
      expect(meta?.color).toBe("#818CF8")
    }
  })

  it("motion-family pickers (camera-motion, transition) get violet", () => {
    for (const t of ["camera-motion", "transition"]) {
      const meta = getPickerOutputMeta(t)
      expect(meta?.family).toBe("motion")
      expect(meta?.color).toBe("#A78BFA")
    }
  })

  it("audio-family pickers get amber", () => {
    for (const t of ["music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery"]) {
      const meta = getPickerOutputMeta(t)
      expect(meta?.family).toBe("audio")
      expect(meta?.color).toBe("#F59E0B")
    }
  })

  it("returns null for non-picker types", () => {
    expect(getPickerOutputMeta("generate-image")).toBeNull()
    expect(getPickerOutputMeta("upload-image")).toBeNull()
    expect(getPickerOutputMeta("nonexistent")).toBeNull()
  })

  // Explicit pin: text-prompt-node.tsx replaced its `!` force-unwrap with
  // a `?? defaults` fallback, but the defaults are a safety belt, not the
  // intended path. Pin the contract so a future REGISTRY refactor that
  // accidentally drops these entries fails CI with a clear message
  // instead of silently falling back to the defaults in production.
  it("text-prompt is in REGISTRY (load-bearing for text-prompt-node)", () => {
    expect(getPickerOutputMeta("text-prompt")).not.toBeNull()
  })

  it("tone is in REGISTRY (load-bearing for tone source pip)", () => {
    expect(getPickerOutputMeta("tone")).not.toBeNull()
  })
})

describe("picker-handles registry coverage", () => {
  it("every PARAMETER_PICKER_NODE_TYPES entry has a REGISTRY entry (drift catcher)", () => {
    const missing = [...PARAMETER_PICKER_NODE_TYPES].filter((t) => getPickerOutputMeta(t) === null)
    expect(missing, `Missing from picker-handles REGISTRY: ${missing.join(", ")}`).toEqual([])
  })

  // Reverse drift catcher: any new entry added to picker-handles REGISTRY
  // MUST also appear in PARAMETER_PICKER_NODE_TYPES — otherwise the
  // canvas validator and source-direction popover diverge and the new
  // type's pip lights up but the drop fails (the validator uses the
  // PARAMETER_PICKER_NODE_TYPES set, not the REGISTRY).
  //
  // EXCEPT for the explicit allowlist of non-tile-grid hint producers
  // below — `tone` and `text-prompt` are accepted by HINT_PRODUCER_TYPES
  // for camera-motion / transition wiring but are NOT tile-grid pickers
  // (they have no entry in `parameter-picker-registry.tsx`), so they
  // legitimately appear in REGISTRY without being in
  // PARAMETER_PICKER_NODE_TYPES.
  it("every REGISTRY entry has a PARAMETER_PICKER_NODE_TYPES entry (reverse drift catcher)", () => {
    const NON_TILE_GRID_HINT_PRODUCERS = new Set(["tone", "text-prompt"])
    const extra = getRegisteredPickerTypes()
      .filter((t) => !PARAMETER_PICKER_NODE_TYPES.has(t) && !NON_TILE_GRID_HINT_PRODUCERS.has(t))
    expect(extra, `Extra entries in picker-handles REGISTRY (missing from PARAMETER_PICKER_NODE_TYPES): ${extra.join(", ")}`).toEqual([])
  })

  // PICKER_DEFAULT_SOURCE_HANDLE feeds the legacy-null-sourceHandle
  // migration in loadWorkflow. Every REGISTRY entry must declare a
  // default source-handle id — otherwise a saved-before-typed-pips
  // edge from that picker stays invisible to the popover (handleId
  // lookup misses null) AND uncleanable.
  it("every REGISTRY entry has a PICKER_DEFAULT_SOURCE_HANDLE entry", () => {
    const missing = getRegisteredPickerTypes().filter((t) => getPickerDefaultSourceHandle(t) === null)
    expect(missing, `Missing from PICKER_DEFAULT_SOURCE_HANDLE: ${missing.join(", ")}`).toEqual([])
  })

  it("PICKER_DEFAULT_SOURCE_HANDLE returns null for unregistered types", () => {
    expect(getPickerDefaultSourceHandle("generate-image")).toBeNull()
    expect(getPickerDefaultSourceHandle("nonexistent")).toBeNull()
  })

  // Reverse drift catcher: every PICKER_DEFAULT_SOURCE_HANDLE entry MUST
  // also be in REGISTRY. Without this, a future refactor that removes a
  // picker from REGISTRY but forgets to clean up the default-handle table
  // leaves a phantom backfill rule that activates for orphaned node-type
  // strings (e.g., a removed-then-resurrected type). Pinning the keys
  // both ways forces deliberate co-deletion.
  it("PICKER_DEFAULT_SOURCE_HANDLE keys are a subset of REGISTRY keys (reverse drift catcher)", () => {
    const registryKeys = new Set(getRegisteredPickerTypes())
    const extra = getPickerDefaultSourceHandleTypes().filter((k) => !registryKeys.has(k))
    expect(extra, `Extra entries in PICKER_DEFAULT_SOURCE_HANDLE (missing from REGISTRY): ${extra.join(", ")}`).toEqual([])
  })

  it("text-prompt and tone use type-specific handle ids", () => {
    expect(getPickerDefaultSourceHandle("text-prompt")).toBe("prompt")
    expect(getPickerDefaultSourceHandle("tone")).toBe("tone")
  })
})

describe("isTileGridPickerType", () => {
  // Tile-grid pickers ARE pickers AND have a tile-grid value glyph.
  // The handle-popover uses this to decide between a candidate's
  // value-glyph (misleading on a source-direction row) and a generic
  // Workflow icon.
  it("returns true for tile-grid pickers (mood, lens, camera-motion, etc.)", () => {
    expect(isTileGridPickerType("mood")).toBe(true)
    expect(isTileGridPickerType("lens")).toBe(true)
    expect(isTileGridPickerType("camera-motion")).toBe(true)
    expect(isTileGridPickerType("person")).toBe(true)
  })

  it("returns false for non-tile-grid hint producers (tone, text-prompt)", () => {
    // These are registered as pickers (for typed-pip coloring) but have
    // content-driven visuals, not tile-grid value glyphs. They SHOULD
    // show their actual content thumbnail when they appear as candidates.
    expect(isPickerNodeType("tone")).toBe(true)
    expect(isPickerNodeType("text-prompt")).toBe(true)
    expect(isTileGridPickerType("tone")).toBe(false)
    expect(isTileGridPickerType("text-prompt")).toBe(false)
  })

  it("returns false for non-picker types", () => {
    expect(isTileGridPickerType("generate-image")).toBe(false)
    expect(isTileGridPickerType("upload-image")).toBe(false)
    expect(isTileGridPickerType("nonexistent")).toBe(false)
  })
})
