// @test-watches frontend/src/nodes/**
// (It reads no file: G4 wants this declaration because it checks every real unit — UNIT_NODE_DEFINITIONS,
// NODE_DEFINITIONS, NODE_OPTIONS — so a change to any unit must select it.)
// The node-unit connection seam (unit-connections.ts): a unit's inputs are
// judged by what its manifest declares they accept, composed into the canvas
// validator (connection-validation.ts) as legacy rules ∪ units.
import { describe, expect, it, vi } from "vitest"
import type { UnitDefinition } from "@/nodes/kit"

// A unit the product does not have: one GIF-like `image` input, one JSON
// (`look`) input and a video out.
const FIXTURE = vi.hoisted(() => ({
  type: "fixture-image-in",
  label: "Fixture Image In",
  category: "processing",
  inputs: ["image", "plan"],
  outputs: ["video"],
  defaultData: { label: "Fixture Image In" },
  position: { after: "upload-image" },
  picker: null,
  handles: {
    inputs: [{ id: "image", label: "Image", accepts: ["image"] }, { id: "plan", label: "Plan", accepts: ["look"] }],
    outputs: [{ id: "video", label: "Video", kind: "video" }],
  },
  execution: { kind: "inline" },
  capabilities: [],
  docs: { awaiting: "fixture" },
  priceFallback: null,
}))

// Only the type lookup sees the fixture: the load-time folds over every unit
// (TARGET_HANDLE_ACCEPTS, FFMPEG_NODE_TYPES) keep reading the real collection.
vi.mock("../unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("../unit-definitions")>()
  return {
    ...real,
    unitDefinitionOf: (type: string | undefined) => (type === FIXTURE.type ? (FIXTURE as unknown as UnitDefinition) : real.unitDefinitionOf(type)),
  }
})

import { unitConnectionVerdict, unitInputConnectionAccepted } from "../unit-connections"
import { isValidWorkflowConnection } from "../connection-validation"
import { isValidFfmpegConnection, unitInputAccepts, ACCEPTS_VIDEO, ACCEPTS_AUDIO, ACCEPTS_MEDIA } from "../ffmpeg-handles"
import { ACCEPTS_JSON } from "../data-handles"
import { ACCEPTS_IMAGE_OR_DYN } from "../image-producer-handles"
import { UNIT_NODE_DEFINITIONS } from "../unit-definitions"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { getCompatibleNodes } from "../node-compatibility"
import { NODE_OPTIONS } from "../node-options"

const ALL_TYPES: readonly string[] = NODE_DEFINITIONS.map((d) => d.type as string)
const UNIT_TYPES = new Set(UNIT_NODE_DEFINITIONS.map((u) => u.type))

/** isValidWorkflowConnection for one wire `sourceType[sourceHandle] → fixture[targetHandle]`. */
const wire = (sourceType: string, targetHandle: string | null, sourceHandle: string | null = null): boolean =>
  isValidWorkflowConnection(
    { source: "s", target: "t", sourceHandle, targetHandle },
    (id) => (id === "s" ? sourceType : id === "t" ? FIXTURE.type : undefined),
  )

describe("a fixture unit's declared inputs, composed into the canvas validator", () => {
  it("takes an image producer, or a dynamic one, into its image input", () => {
    expect(wire("generate-image", "image")).toBe(true)
    expect(wire("upload-image", "image")).toBe(true)
    expect(wire("list", "image")).toBe(true)
  })

  it("refuses what its input does not accept, and any handle it does not declare", () => {
    // Without the composition both would fall to the validator's default-allow.
    expect(wire("generate-video", "image")).toBe(false)
    expect(wire("text-to-speech", "image")).toBe(false)
    expect(wire("generate-image", "video")).toBe(false)
    expect(wire("generate-image", "zz-undeclared")).toBe(false)
  })

  it("takes any JSON producer into its JSON (look) input, through the rules every node shares", () => {
    expect(wire("edit-plan", "plan", "edl")).toBe(true)
    expect(wire("transcribe", "plan", "json")).toBe(true)
    expect(wire("audio-sync", "plan")).toBe(true)
    expect(wire("generate-video", "plan")).toBe(false)
    expect(wire("generate-image", "plan")).toBe(false)
    expect(wire("text-to-speech", "plan")).toBe(false)
  })

  it("judges the effective source: an entity's plain image pip is an image", () => {
    expect(wire("character", "image", "image")).toBe(true)
  })

  it("the rules every node shares still apply; a wire with no target handle is judged as before", () => {
    expect(wire("generate-image", "image", "lottie")).toBe(false)
    expect(wire("generate-image", null)).toBe(true)
  })
})

describe("the seam changes no edge today", () => {
  it("is silent for every legacy node type", () => {
    for (const type of ALL_TYPES.filter((t) => !UNIT_TYPES.has(t))) {
      expect(unitConnectionVerdict(type, "in", "generate-video"), type).toBeUndefined()
    }
    expect(unitConnectionVerdict(FIXTURE.type, null, "generate-image")).toBeUndefined()
    expect(unitConnectionVerdict(undefined, "in", "generate-image")).toBeUndefined()
  })

  it("answers every real unit exactly as isValidFfmpegConnection, the path that judged it before", () => {
    const units = UNIT_NODE_DEFINITIONS.filter((u) => u.capabilities.includes("ffmpeg-media"))
    expect(units.length).toBeGreaterThan(0)
    for (const u of units) {
      for (const handle of [...u.handles.inputs.map((h) => h.id), "zz-undeclared"]) {
        for (const source of ALL_TYPES) {
          expect(unitConnectionVerdict(u.type, handle, source), `${source} → ${u.type}[${handle}]`).toBe(isValidFfmpegConnection(u.type, handle, source))
        }
      }
    }
  })

  it("the add-node popup offers a real unit's input exactly what its media's legacy predicate accepts", () => {
    // remove-audio's popup list before this seam: NODE_OPTIONS through
    // ACCEPTS_VIDEO (its one input accepts video). Now through unitConnectionVerdict.
    const legacy = (kinds: ReadonlyArray<string>): ((s: string) => boolean) =>
      kinds.includes("video") && kinds.includes("audio") ? ACCEPTS_MEDIA : kinds.includes("audio") ? ACCEPTS_AUDIO : ACCEPTS_VIDEO
    const units = UNIT_NODE_DEFINITIONS.filter((u) => u.capabilities.includes("ffmpeg-media"))
    for (const u of units) {
      const input = u.handles.inputs.find((h) => h.id === "in")
      if (!input) continue
      const offered = getCompatibleNodes("in", "target", NODE_OPTIONS, u.type).direct.map((o) => o.type)
      const expected = NODE_OPTIONS.filter((o) => legacy(input.accepts)(o.type)).map((o) => o.type)
      expect(offered, u.type).toEqual(expected)
      expect(offered.length, u.type).toBeGreaterThan(0)
    }
  })

  it("each accept kind is the legacy predicate of that media, over every node type", () => {
    const pairs: ReadonlyArray<readonly [ReadonlyArray<"video" | "audio" | "image" | "look">, (s: string) => boolean]> = [
      [["video"], ACCEPTS_VIDEO],
      [["audio"], ACCEPTS_AUDIO],
      [["video", "audio"], ACCEPTS_MEDIA],
      [["image"], ACCEPTS_IMAGE_OR_DYN],
      [["look"], ACCEPTS_JSON],
    ]
    for (const [kinds, legacy] of pairs) {
      const rule = unitInputAccepts(kinds)
      for (const source of ALL_TYPES) expect(rule(source), `${kinds.join("+")} ← ${source}`).toBe(legacy(source))
    }
    const any = unitInputAccepts(["video", "image"])
    for (const source of ALL_TYPES) expect(any(source)).toBe(ACCEPTS_VIDEO(source) || ACCEPTS_IMAGE_OR_DYN(source))
  })

  // The hand-written rule gif-to-video had before it became a unit
  // (video-producer-handles.ts isValidGifToVideoConnection, deleted by that
  // migration, decided 2026-10-18): its one "image" input took any image or
  // dynamic producer, and any other handle nothing.
  const legacyGifRule = (handle: string, source: string): boolean => handle === "image" && ACCEPTS_IMAGE_OR_DYN(source)

  it("an image input declared in a manifest reproduces the hand-written GIF-input rule, handle for handle", () => {
    const gif = UNIT_NODE_DEFINITIONS.find((u) => u.type === "gif-to-video")
    expect(gif, "gif-to-video is a unit").toBeDefined()
    for (const unit of [FIXTURE as unknown as UnitDefinition, gif!]) {
      for (const handle of ["image", "video", "zz-undeclared"]) {
        for (const source of ALL_TYPES) {
          expect(unitInputConnectionAccepted(unit, handle, source), `${source} → ${unit.type}[${handle}]`).toBe(legacyGifRule(handle, source))
        }
      }
    }
  })
})
