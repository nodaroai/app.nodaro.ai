/**
 * The five UGC video nodes on every editor surface (root CLAUDE.md "New Node
 * Registration" and the handle registries): a definition, a component, a
 * picker entry in the UGC Video family, Cloud only, typed input pips that take
 * exactly the UGC output each one reads, and every label in every locale.
 */
import { describe, expect, it } from "vitest"
import { OUTPUT_PIP_EFFECTIVE_TYPES, UGC_NODE_TYPES, UGC_SCRIPT_DEFAULT_TARGET_SEC, declaredJsonOutput, declaredJsonOutputRows, getInputFieldExtraKeys, getInputFieldSchema, jsonKindMismatch, resolveEffectiveSourceType } from "@nodaro/shared"
import { NODE_DEF_MAP, type UgcCreatorData } from "@/types/nodes"
import { nodeTypes } from "@/components/nodes"
import { NODE_OPTIONS } from "../node-options"
import { CLOUD_ONLY_NODE_TYPES } from "../cloud-only-nodes"
import { NODE_FAMILIES } from "../node-families"
import { TARGET_HANDLE_ACCEPTS, getTargetHandlesAccepting } from "../target-handle-registry"
import { isValidWorkflowConnection, ugcWireAllowed } from "../connection-validation"
import { UGC_PRIVATE_OUTPUTS, ugcPrivateOutputVerdict } from "../ugc-plan-inputs"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"
import { ACCEPTS_JSON, JSON_PRODUCER_TYPES } from "../data-handles"
import { LABEL_TABLES, localizeHandleLabel, localizeNodeGroup, localizeNodeLabel } from "../i18n/labels"
import { UGC_TARGET_HANDLES, isValidUgcConnection } from "../ugc-handles"
import { scriptLines } from "../ugc-script-edit"
import { ugcCardsCounts, ugcClipLengths, ugcClipRuns, ugcClipWarningCount, ugcSeconds } from "../ugc-node-cards"

const TYPES = ["ugc-creator", "ugc-script", "ugc-clips", "ugc-clip", "ugc-cards"] as const

describe("the five UGC nodes are registered", () => {
  it("are exactly the shared UGC node set", () => {
    expect([...UGC_NODE_TYPES].sort()).toEqual([...TYPES].sort())
  })

  it.each(TYPES)("%s: a definition, a component, a UGC Video picker entry, Cloud only", (type) => {
    expect(NODE_DEF_MAP.has(type)).toBe(true)
    expect(nodeTypes[type]).toBeDefined()
    expect(NODE_OPTIONS.find((o) => o.type === type)?.group).toBe("video-ugc")
    expect(CLOUD_ONLY_NODE_TYPES.has(type)).toBe(true)
  })

  it("owns the five in one family on the video tab, right after Analyze (Creator, Script, Clips, Clip, Cards)", () => {
    const at = NODE_FAMILIES.findIndex((f) => f.id === "video-ugc")
    expect(NODE_FAMILIES[at]).toEqual({ id: "video-ugc", label: "UGC Video", tab: "video", types: [...TYPES] })
    expect(NODE_FAMILIES[at - 1]?.id).toBe("video-analyze")
    expect(NODE_OPTIONS.filter((o) => o.group === "video-ugc").map((o) => o.type)).toEqual([...TYPES])
  })

  it("a new UGC Script's length is the wires' default (the definition's data is a literal the docs generator reads)", () => {
    expect((NODE_DEF_MAP.get("ugc-script")!.defaultData as { targetDurationSec?: unknown }).targetDurationSec).toBe(UGC_SCRIPT_DEFAULT_TARGET_SEC)
  })

  it.each(TYPES)("%s: every input of the definition has a pip row, and every row is an input", (type) => {
    const rows = UGC_TARGET_HANDLES[type] ?? []
    expect(rows.map((r) => r.handleId).sort()).toEqual([...NODE_DEF_MAP.get(type)!.inputs].sort())
    // The popover registry carries the same rows.
    expect(TARGET_HANDLE_ACCEPTS[type]?.map((r) => r.handleId)).toEqual(rows.map((r) => r.handleId))
  })

  it("declares the outputs the components draw, with their colours", () => {
    expect({
      "ugc-creator": HANDLE_OUTPUT_TYPES["ugc-creator"],
      "ugc-script": HANDLE_OUTPUT_TYPES["ugc-script"],
      "ugc-clips": HANDLE_OUTPUT_TYPES["ugc-clips"],
      "ugc-clip": HANDLE_OUTPUT_TYPES["ugc-clip"],
      "ugc-cards": HANDLE_OUTPUT_TYPES["ugc-cards"],
    }).toEqual({
      "ugc-creator": { creator: "look", image: "image" },
      "ugc-script": { plan: "look", category: "text" },
      "ugc-clips": { clips: "look", "plan-out": "look", transcript: "text" },
      "ugc-clip": { "video-out": "video" },
      "ugc-cards": { layerPlan: "look", captionPlan: "look", report: "text" },
    })
  })

  it("the four JSON producers are JSON producers, and each JSON pip is classified as neither a Transcript nor an EDL", () => {
    for (const type of ["ugc-creator", "ugc-script", "ugc-clips", "ugc-cards"]) expect(JSON_PRODUCER_TYPES.has(type), type).toBe(true)
    expect(JSON_PRODUCER_TYPES.has("ugc-clip")).toBe(false)
    // So Video Overlay's layer plan and Add Captions' caption plan take UGC Cards.
    expect(ACCEPTS_JSON("ugc-cards")).toBe(true)
    for (const [type, pip] of [["ugc-creator", "creator"], ["ugc-script", "plan"], ["ugc-clips", "clips"], ["ugc-clips", "plan-out"], ["ugc-cards", "layerPlan"], ["ugc-cards", "captionPlan"]]) {
      expect(declaredJsonOutput(type, pip), `${type}.${pip}`).toBe("other")
    }
  })
})

describe("each UGC input takes exactly the output that makes it", () => {
  it("a script into the clips, a creator look from the four pickers, a clip's notes into the cards", () => {
    expect(isValidUgcConnection("ugc-clips", "plan", "ugc-script")).toBe(true)
    expect(isValidUgcConnection("ugc-clips", "plan", "llm-chat")).toBe(false)
    expect(isValidUgcConnection("ugc-creator", "pickers", "person")).toBe(true)
    expect(isValidUgcConnection("ugc-creator", "pickers", "camera-motion")).toBe(false)
    expect(isValidUgcConnection("ugc-cards", "notes", "ugc-clip")).toBe(true)
  })

  it("a UGC wire reads one output of one node; no source handle means the source's primary output", () => {
    expect(isValidUgcConnection("ugc-creator", "category", "ugc-script", "category")).toBe(true)
    expect(isValidUgcConnection("ugc-creator", "category", "ugc-script", "plan")).toBe(false)
    expect(isValidUgcConnection("ugc-creator", "category", "ugc-script", null)).toBe(false)
    expect(isValidUgcConnection("ugc-clips", "plan", "ugc-script", "plan")).toBe(true)
    expect(isValidUgcConnection("ugc-clips", "plan", "ugc-script", "category")).toBe(false)
    expect(isValidUgcConnection("ugc-clips", "creator", "ugc-creator", "creator")).toBe(true)
    expect(isValidUgcConnection("ugc-clips", "creator", "ugc-creator", "image")).toBe(false)
    expect(isValidUgcConnection("ugc-clip", "clip", "ugc-clips", "clips")).toBe(true)
    expect(isValidUgcConnection("ugc-clip", "clip", "ugc-clips", null)).toBe(true)
    expect(isValidUgcConnection("ugc-clip", "clip", "ugc-clips", "plan-out")).toBe(false)
    expect(isValidUgcConnection("ugc-cards", "plan", "ugc-clips", "plan-out")).toBe(true)
    expect(isValidUgcConnection("ugc-cards", "plan", "ugc-clips", "clips")).toBe(false)
    expect(isValidUgcConnection("ugc-cards", "plan", "ugc-script", "plan")).toBe(false)
    expect(isValidUgcConnection("ugc-cards", "transcript", "ugc-clips", "transcript")).toBe(true)
    expect(isValidUgcConnection("ugc-cards", "transcript", "transcribe", "text")).toBe(false)
    expect(isValidUgcConnection("ugc-cards", "notes", "ugc-clip", "video-out")).toBe(true)
  })

  it("the creator look takes exactly the four creator pickers", () => {
    for (const picker of ["person", "styling", "setting", "lighting"]) expect(isValidUgcConnection("ugc-creator", "pickers", picker), picker).toBe(true)
    for (const other of ["mood", "lens", "text-prompt", "generate-image"]) expect(isValidUgcConnection("ugc-creator", "pickers", other), other).toBe(false)
  })

  it("media and text inputs take the ordinary producers", () => {
    expect(isValidUgcConnection("ugc-creator", "photo", "upload-image")).toBe(true)
    expect(isValidUgcConnection("ugc-creator", "photo", "text-prompt")).toBe(false)
    expect(isValidUgcConnection("ugc-script", "site", "text-prompt")).toBe(true)
    expect(isValidUgcConnection("ugc-script", "site", "upload-image")).toBe(false)
    for (const slot of ["screenshot", "screenshot2", "screenshot8", "product"]) expect(isValidUgcConnection("ugc-script", slot, "upload-image"), slot).toBe(true)
    expect(isValidUgcConnection("ugc-script", "screenshot", "upload-video")).toBe(false)
    expect(isValidUgcConnection("ugc-cards", "video", "combine-videos")).toBe(true)
    expect(isValidUgcConnection("ugc-cards", "video", "upload-image")).toBe(false)
  })

  it("refuses a handle the node does not have, and a type that is not a UGC node", () => {
    expect(isValidUgcConnection("ugc-clips", "in", "ugc-script")).toBe(false)
    expect(isValidUgcConnection("ugc-clips", "constructor", "ugc-script")).toBe(false)
    expect(isValidUgcConnection("constructor", "plan", "ugc-script")).toBe(false)
  })

  it("the canvas validator agrees, through every rule that runs before the UGC branch", () => {
    const types: Record<string, string> = {
      site: "text-prompt", shot: "upload-image", person: "person", lens: "lens", writer: "llm-chat",
      script: "ugc-script", creator: "ugc-creator", clips: "ugc-clips", clip: "ugc-clip", cards: "ugc-cards",
      join: "combine-videos", overlay: "video-overlay", captions: "add-captions",
    }
    const ok = (source: string, sourceHandle: string | null, target: string, targetHandle: string) =>
      isValidWorkflowConnection({ source, sourceHandle, target, targetHandle }, (id) => types[id])
    // The edges of a UGC video workflow.
    expect(ok("site", "prompt", "script", "site")).toBe(true)
    expect(ok("shot", "image", "script", "screenshot2")).toBe(true)
    expect(ok("script", "category", "creator", "category")).toBe(true)
    expect(ok("person", "out", "creator", "pickers")).toBe(true)
    expect(ok("script", "plan", "clips", "plan")).toBe(true)
    expect(ok("creator", "creator", "clips", "creator")).toBe(true)
    expect(ok("clips", "clips", "clip", "clip")).toBe(true)
    expect(ok("clips", "plan-out", "cards", "plan")).toBe(true)
    expect(ok("clips", "transcript", "cards", "transcript")).toBe(true)
    expect(ok("clip", "video-out", "cards", "notes")).toBe(true)
    expect(ok("clip", "video-out", "join", "in")).toBe(true)
    expect(ok("join", "video", "cards", "video")).toBe(true)
    expect(ok("cards", "layerPlan", "overlay", "layerPlan")).toBe(true)
    expect(ok("cards", "captionPlan", "captions", "captionPlan")).toBe(true)
    // And what they refuse.
    expect(ok("writer", "text", "clips", "plan")).toBe(false)
    expect(ok("lens", "out", "creator", "pickers")).toBe(false)
    expect(ok("script", "plan", "creator", "category")).toBe(false)
    expect(ok("clips", "clips", "cards", "plan")).toBe(false)
  })
})

describe("UGC Cards' plans are the only UGC outputs the public plan inputs take", () => {
  const types: Record<string, string> = { overlay: "video-overlay", captions: "add-captions", writer: "llm-chat", recipe: "content-recipe" }
  for (const t of TYPES) types[t] = t
  const ok = (source: string, sourceHandle: string | null, target: string, targetHandle: string) =>
    isValidWorkflowConnection({ source, sourceHandle, target, targetHandle }, (id) => types[id])
  const pips = TYPES.flatMap((type) => NODE_DEF_MAP.get(type)!.outputs.map((pip) => [type, pip] as const))

  it("sees every UGC output pip", () => {
    expect(pips).toHaveLength(11)
  })

  it.each(pips)("%s.%s into Video Overlay's layer plan and Add Captions' caption plan", (type, pip) => {
    expect(ok(type, pip, "overlay", "layerPlan")).toBe(type === "ugc-cards" && pip === "layerPlan")
    expect(ok(type, pip, "captions", "captionPlan")).toBe(type === "ugc-cards" && pip === "captionPlan")
  })

  it("an edge with no source pip reads UGC Cards' primary output: the layer plan", () => {
    expect(ok("ugc-cards", null, "overlay", "layerPlan")).toBe(true)
    expect(ok("ugc-cards", null, "captions", "captionPlan")).toBe(false)
  })

  it("the pips and the popover agree: of the UGC nodes, only UGC Cards lights up either input", () => {
    for (const type of TYPES) {
      const pairs = getTargetHandlesAccepting(type).map((m) => `${m.nodeType}:${m.handleId}`)
      const expected = type === "ugc-cards"
      expect(pairs.includes("video-overlay:layerPlan"), type).toBe(expected)
      expect(pairs.includes("add-captions:captionPlan"), type).toBe(expected)
    }
  })

  it("every other JSON producer keeps the inputs' own rule", () => {
    expect(ok("writer", "text", "overlay", "layerPlan")).toBe(true)
    expect(ok("recipe", "json", "captions", "captionPlan")).toBe(true)
  })
})

describe("UGC private outputs go only to UGC inputs, the public input made for them, and the sinks", () => {
  const PRIVATE: ReadonlyArray<readonly [string, string]> = [
    ["ugc-creator", "creator"], ["ugc-script", "plan"], ["ugc-clips", "clips"], ["ugc-clips", "plan-out"],
    ["ugc-cards", "layerPlan"], ["ugc-cards", "captionPlan"],
  ]
  const REFUSING: ReadonlyArray<readonly [string, string]> = [
    ["add-captions", "transcript"], ["apply-edl", "edl"], ["apply-edl", "transcript"], ["content-recipe", "in"],
    ["list", "in"], ["filter-list", "in"], ["deduplicate", "in"], ["merge-lists", "in"], ["sort-list", "in"],
    ["selector", "in"], ["extract-field", "in"],
  ]
  const SINKS: ReadonlyArray<readonly [string, string]> = [["preview", "in"], ["collection-write", "in"]]
  const ok = (sourceType: string, sourceHandle: string | null, targetType: string, targetHandle: string) =>
    isValidWorkflowConnection({ source: "s", sourceHandle, target: "t", targetHandle }, (id) => (id === "s" ? sourceType : id === "t" ? targetType : undefined))
  const label = ([type, pip]: readonly [string, string]) => `${type}.${pip}`

  it("names exactly the UGC outputs that carry the nodes' own data", () => {
    expect(Object.entries(UGC_PRIVATE_OUTPUTS).flatMap(([type, pips]) => pips.map((pip) => `${type}.${pip}`)).sort()).toEqual(PRIVATE.map(label).sort())
  })

  it("is every JSON pip a UGC node declares, so a UGC JSON pip added later is private the day it is declared", () => {
    const declared = declaredJsonOutputRows().filter(([type]) => UGC_NODE_TYPES.has(type)).map(([type, pip]) => `${type}.${pip}`)
    expect(Object.entries(UGC_PRIVATE_OUTPUTS).flatMap(([type, pips]) => pips.map((pip) => `${type}.${pip}`)).sort()).toEqual(declared.sort())
    // The plain-text pips declare no JSON, so they are not private.
    for (const pip of ["ugc-script.category", "ugc-clips.transcript", "ugc-cards.report"]) expect(declared).not.toContain(pip)
  })

  it.each(PRIVATE)("%s.%s: refused by Add Captions' transcript, Apply EDL, Content Recipe and the list nodes", (type, pip) => {
    for (const consumer of REFUSING) expect(ok(type, pip, consumer[0], consumer[1]), `→ ${label(consumer)}`).toBe(false)
  })

  it.each(PRIVATE)("%s.%s: taken by the permissive sinks (Preview, Save to Collection)", (type, pip) => {
    for (const sink of SINKS) expect(ok(type, pip, sink[0], sink[1]), `→ ${label(sink)}`).toBe(true)
  })

  it("each still reaches the UGC input that reads it, and UGC Cards' plans their own public input", () => {
    expect(ok("ugc-creator", "creator", "ugc-clips", "creator")).toBe(true)
    expect(ok("ugc-script", "plan", "ugc-clips", "plan")).toBe(true)
    expect(ok("ugc-clips", "clips", "ugc-clip", "clip")).toBe(true)
    expect(ok("ugc-clips", "plan-out", "ugc-cards", "plan")).toBe(true)
    expect(ok("ugc-cards", "layerPlan", "video-overlay", "layerPlan")).toBe(true)
    expect(ok("ugc-cards", "captionPlan", "add-captions", "captionPlan")).toBe(true)
  })

  it("an edge with no source pip reads the primary output, so it is judged as that private output", () => {
    expect(ok("ugc-script", null, "apply-edl", "edl")).toBe(false)
    expect(ok("ugc-clips", null, "list", "in")).toBe(false)
    expect(ok("ugc-script", null, "preview", "in")).toBe(true)
  })

  it("the plain-text pips are not private: the rule leaves them to each input's own rule", () => {
    for (const [type, pip] of [["ugc-script", "category"], ["ugc-clips", "transcript"], ["ugc-cards", "report"]] as const) {
      expect(ugcPrivateOutputVerdict(type, pip, "list", "in"), `${type}.${pip}`).toBeUndefined()
      expect(ok(type, pip, "list", "in"), `${type}.${pip} → list.in`).toBe(true)
      expect(ok(type, pip, "preview", "in"), `${type}.${pip} → preview.in`).toBe(true)
    }
  })

  it("the drag glow applies the same UGC rules as the drop", () => {
    for (const [type, pip] of PRIVATE) {
      for (const consumer of REFUSING) expect(ugcWireAllowed(type, pip, consumer[0], consumer[1]), `${type}.${pip} → ${label(consumer)}`).toBe(false)
      for (const sink of SINKS) expect(ugcWireAllowed(type, pip, sink[0], sink[1])).toBe(true)
    }
    // A UGC wire reads one output of one node; the glow knows the pip, so it says so too.
    expect(ugcWireAllowed("ugc-clips", "clips", "ugc-cards", "plan")).toBe(false)
    expect(ugcWireAllowed("ugc-clips", "plan-out", "ugc-cards", "plan")).toBe(true)
    // Not a UGC wire at all: no say.
    expect(ugcWireAllowed("upload-image", "image", "generate-image", "references")).toBe(true)
  })
})

describe("UGC Creator's image reaches image inputs; its creator record does not", () => {
  const types: Record<string, string> = {
    creator: "ugc-creator", gen: "generate-image", modify: "modify-image", lip: "lip-sync", up: "upscale-image",
    still: "still-to-video", video: "generate-video", overlay: "video-overlay", script: "ugc-script", clips: "ugc-clips",
  }
  const ok = (sourceHandle: string, target: string, targetHandle: string) =>
    isValidWorkflowConnection({ source: "creator", sourceHandle, target, targetHandle }, (id) => types[id])
  const IMAGE_INPUTS: ReadonlyArray<readonly [string, string]> = [
    ["gen", "references"], ["modify", "image"], ["lip", "image"], ["up", "image"], ["still", "image"],
    ["video", "startFrame"], ["overlay", "overlay"], ["script", "screenshot2"], ["script", "product"],
  ]

  it.each(IMAGE_INPUTS)("the image pip into %s.%s connects; the creator record does not", (target, handle) => {
    expect(ok("image", target, handle)).toBe(true)
    expect(ok("creator", target, handle)).toBe(false)
  })

  it("the creator record still feeds UGC Clips, and the image pip does not", () => {
    expect(ok("creator", "clips", "creator")).toBe(true)
    expect(ok("image", "clips", "creator")).toBe(false)
  })

  it("every per-pip remap names a declared output drawn in the colour of the producer it becomes", () => {
    const rows = Object.entries(OUTPUT_PIP_EFFECTIVE_TYPES).flatMap(([type, map]) => Object.entries(map).map(([pip, effective]) => [type, pip, effective] as const))
    expect(rows.length).toBeGreaterThan(0)
    for (const [type, pip, effective] of rows) {
      expect(NODE_DEF_MAP.get(type)?.outputs, `${type} declares ${pip}`).toContain(pip)
      const producerColours = Object.values(HANDLE_OUTPUT_TYPES[effective] ?? {})
      expect(producerColours, `${effective} draws one output colour`).toHaveLength(1)
      expect(HANDLE_OUTPUT_TYPES[type]?.[pip], `${type}.${pip}`).toBe(producerColours[0])
    }
  })
})

describe("UGC's plain-text pips are text: the script's category, the clips' transcript, the cards' Notes", () => {
  const TEXT_PIPS = [["ugc-script", "category"], ["ugc-clips", "transcript"], ["ugc-cards", "report"]] as const
  const TEXT_INPUTS: ReadonlyArray<readonly [string, string]> = [
    ["llm-chat", "prompt"], ["generate-image", "prompt"], ["text-to-speech", "prompt"], ["combine-text", "text"], ["ugc-script", "site"], ["list", "in"],
  ]
  const JSON_INPUTS: ReadonlyArray<readonly [string, string]> = [
    ["add-captions", "transcript"], ["apply-edl", "edl"], ["apply-edl", "transcript"], ["camera-switch", "edl"], ["camera-switch", "transcript"],
    ["extract-field", "in"], ["add-captions", "captionPlan"], ["video-overlay", "layerPlan"],
  ]
  // The UGC inputs a text pip could be dragged to: each takes exactly one UGC output.
  const UGC_TEXT_INPUTS: ReadonlyArray<readonly [string, string]> = [["ugc-creator", "category"], ["ugc-cards", "transcript"]]
  const ok = (sourceType: string, sourceHandle: string | null, targetType: string, targetHandle: string) =>
    isValidWorkflowConnection({ source: "s", sourceHandle, target: "t", targetHandle }, (id) => (id === "s" ? sourceType : id === "t" ? targetType : undefined))
  const label = (type: string, pip: string) => `${type}.${pip}`

  it.each(TEXT_PIPS)("%s.%s reaches the text and prompt inputs", (type, pip) => {
    for (const [t, h] of TEXT_INPUTS) expect(ok(type, pip, t, h), `→ ${label(t, h)}`).toBe(true)
  })

  it.each(TEXT_PIPS)("%s.%s is refused by the JSON inputs, where it would fail at run time", (type, pip) => {
    for (const [t, h] of JSON_INPUTS) expect(ok(type, pip, t, h), `→ ${label(t, h)}`).toBe(false)
  })

  it("each still feeds the UGC input made for it, and no other", () => {
    expect(ok("ugc-script", "category", "ugc-creator", "category")).toBe(true)
    expect(ok("ugc-clips", "transcript", "ugc-cards", "transcript")).toBe(true)
    expect(ok("ugc-script", "category", "ugc-cards", "transcript")).toBe(false)
    expect(ok("ugc-clips", "transcript", "ugc-creator", "category")).toBe(false)
    expect(ok("ugc-cards", "report", "ugc-cards", "transcript")).toBe(false)
    expect(ok("ugc-cards", "report", "ugc-creator", "category")).toBe(false)
    expect(ok("ugc-script", "plan", "ugc-creator", "category")).toBe(false)
  })

  it("a text that is not the UGC output never feeds a UGC wire input: the wire is judged on the node and its pip", () => {
    for (const [t, h] of UGC_TEXT_INPUTS) {
      expect(ok("combine-text", "text", t, h), `combine-text → ${label(t, h)}`).toBe(false)
      expect(ok("text-prompt", "prompt", t, h), `text-prompt → ${label(t, h)}`).toBe(false)
      expect(ok("transcribe", "text", t, h), `transcribe → ${label(t, h)}`).toBe(false)
    }
    expect(isValidUgcConnection("ugc-creator", "category", "ugc-script", "category")).toBe(true)
    expect(isValidUgcConnection("ugc-cards", "transcript", "ugc-clips", "transcript")).toBe(true)
    // A source only passing for the pip's medium is not the pip.
    expect(isValidUgcConnection("ugc-creator", "category", "combine-text", "category")).toBe(false)
    expect(isValidUgcConnection("ugc-cards", "transcript", "combine-text", "transcript")).toBe(false)
  })

  it("the drag glow, the pip popovers and the drop agree on every pair", () => {
    const targets = [...TEXT_INPUTS, ...JSON_INPUTS, ...UGC_TEXT_INPUTS]
    const sources = [...TEXT_PIPS, ["combine-text", "text"], ["ugc-script", "plan"]] as const
    for (const [type, pip] of sources) {
      const emits = resolveEffectiveSourceType(type, pip)
      const listed = getTargetHandlesAccepting(emits).map((m) => `${m.nodeType}:${m.handleId}`)
      for (const [t, h] of targets) {
        const drop = ok(type, pip, t, h)
        const entry = TARGET_HANDLE_ACCEPTS[t]?.find((e) => e.handleId === h)
        // The target pip's glow during a drag from this pip (handle-with-popover's target direction).
        const glow = !!entry?.accepts(emits) && !jsonKindMismatch(type, pip, t, h) && ugcWireAllowed(type, pip, t, h)
        expect(glow, `glow ${label(type, pip)} → ${label(t, h)}`).toBe(drop)
        // The source pip's popover lists every input the drop accepts (it re-checks each with the drop rule).
        if (drop) expect(listed, `popover ${label(type, pip)} → ${label(t, h)}`).toContain(`${t}:${h}`)
      }
    }
  })
})

/** The declared keys of a node-data type, without its `[key: string]` index signature. */
type DeclaredKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] }

describe("UGC Creator's API-settable fields are fields the node reads", () => {
  // Every declared key of UgcCreatorData: a renamed or removed field fails tsc here.
  const DECLARED = {
    label: true, source: true, gender: true, photoUrl: true, categoryOverride: true, seed: true, keepResult: true,
    result: true, ugcOutputs: true, candidates: true, optionFailed: true, generatedImageUrl: true, fieldMappings: true,
    executionStatus: true, errorMessage: true, currentJobId: true, currentJobProgress: true,
  } satisfies Record<DeclaredKeys<UgcCreatorData>, true>

  it("covers the INPUT_FIELD_MAP key and every INPUT_FIELD_EXTRA_KEYS key", () => {
    const fields = new Set([...Object.keys(NODE_DEF_MAP.get("ugc-creator")!.defaultData), ...Object.keys(DECLARED)])
    const settable = [getInputFieldSchema("ugc-creator")!.key, ...getInputFieldExtraKeys("ugc-creator").map((f) => f.key)]
    expect(settable.length).toBeGreaterThan(1)
    for (const key of settable) expect(fields.has(key), key).toBe(true)
  })
})

describe("UGC Script's card reads only the opening line, the beats' lines and the closing line", () => {
  it("reads the opening line, each beat's line and the closing line, and nothing else", () => {
    const plan = { v: 1, hook: "Open", beats: [{ line: "One", other: "x" }, { line: "Two" }], closer: { line: "Close", z: 1 }, extra: "y" }
    expect(scriptLines(plan)).toEqual({ hook: "Open", beats: ["One", "Two"], closer: "Close" })
  })

  it("reads a missing or malformed line as empty", () => {
    expect(scriptLines({})).toEqual({ hook: "", beats: [], closer: "" })
    expect(scriptLines({ hook: 1, beats: [null, { line: 2 }, "x"], closer: "no" })).toEqual({ hook: "", beats: ["", "", ""], closer: "" })
  })
})

describe("the other cards read only what they show", () => {
  it("UGC Clips: each ticket's number and length, from its v, index and durationSec only", () => {
    const ticket = (index: number, durationSec: number, v = 1) => JSON.stringify({ v, index, durationSec, video: { tool: "t", args: { prompt: "p" } } })
    expect(ugcClipLengths([ticket(0, 12), ticket(1, 7.25)])).toEqual([{ clip: 1, durationSec: 12 }, { clip: 2, durationSec: 7.25 }])
    // Unreadable, another version, a bad index or length: skipped, never guessed.
    expect(ugcClipLengths(["{", ticket(0, 5, 2), ticket(-1, 5), ticket(0, 0), JSON.stringify([1])])).toEqual([])
    expect(ugcClipLengths(undefined)).toEqual([])
    expect(ugcSeconds(12)).toBe("12")
    expect(ugcSeconds(7.25)).toBe("7.3")
  })

  it("UGC Clip: every clip's warnings when it ran once per clip, else the single run's", () => {
    expect(ugcClipWarningCount({ __listResultMeta: [{ warnings: ["a"], durationSec: 3 }, { warnings: ["b", "c"], durationSec: null }] })).toBe(3)
    expect(ugcClipWarningCount({ clipWarnings: ["a", 1, "b"] })).toBe(2)
    expect(ugcClipWarningCount({ __listResultMeta: [], clipWarnings: ["a"] })).toBe(1)
    expect(ugcClipWarningCount({})).toBe(0)
  })

  it("UGC Clip's panel: each clip that ran, by number, with its length and how many warnings, as UGC Cards' notes number them", () => {
    // Row i of a fan-out is clip i + 1; a row the run never wrote is not a clip that ran.
    const meta = [{ warnings: ["a"], durationSec: 3 }, null, { warnings: ["b", 1, "c"], durationSec: null }]
    expect(ugcClipRuns({ __listResultMeta: meta, generatedVideoUrl: "https://cdn.example/3.mp4" })).toEqual([
      { clip: 1, durationSec: 3, warnings: 1 },
      { clip: 3, warnings: 2 },
    ])
    // A single run (one ticket): clip 1, from the node's own fields.
    expect(ugcClipRuns({ generatedVideoUrl: "https://cdn.example/1.mp4", clipWarnings: ["w"], durationSec: 9 })).toEqual([{ clip: 1, durationSec: 9, warnings: 1 }])
    expect(ugcClipRuns({ __listResultMeta: [], durationSec: 5 })).toEqual([{ clip: 1, durationSec: 5, warnings: 0 }])
    expect(ugcClipRuns({})).toEqual([])
  })

  it("UGC Cards: how many cards its layer plan holds and how many words its caption plan times", () => {
    const captionPlan = JSON.stringify({ v: 1, hookText: "", hookEndMs: 0, bodyEndMs: 900, captions: [{ text: "a", startMs: 0, endMs: 300 }, { text: "b", startMs: 300, endMs: 900 }] })
    expect(ugcCardsCounts({ layerPlan: JSON.stringify([{ kind: "image" }]), captionPlan })).toEqual({ cards: 1, captionWords: 2 })
    expect(ugcCardsCounts({ layerPlan: "[]", captionPlan: "not json" })).toEqual({ cards: 0, captionWords: 0 })
    expect(ugcCardsCounts(undefined)).toEqual({ cards: 0, captionWords: 0 })
  })
})

describe("every UGC label is in every locale", () => {
  const locales = Object.keys(LABEL_TABLES) as Array<keyof typeof LABEL_TABLES>

  it("covers the four locales with label tables", () => {
    expect([...locales].sort()).toEqual(["he", "ja", "ko", "pt-BR"])
  })

  it.each(locales)("%s: the node labels and the family label", (locale) => {
    for (const type of TYPES) {
      const label = NODE_DEF_MAP.get(type)!.label
      expect(localizeNodeLabel(label, locale!), label).not.toBe(label)
      expect(localizeNodeLabel(NODE_OPTIONS.find((o) => o.type === type)!.label, locale!)).not.toBe(label)
    }
    expect(localizeNodeGroup("UGC Video", locale!)).not.toBe("UGC Video")
  })

  it.each(locales)("%s: every input pip label, the numbered screenshot slots included", (locale) => {
    const labels = Object.values(UGC_TARGET_HANDLES).flatMap((rows) => rows.map((r) => r.label))
    expect(labels).toContain("Screenshot 8")
    const untranslated = labels.filter((l) => localizeHandleLabel(l, locale!) === l)
    expect(untranslated).toEqual([])
  })
})
