/**
 * A published app's node keeps only its configuration (`nodeSettingKeys`, @nodaro/render-rules), so a
 * key the server's executor reads for a node type must be one: declared on the type's data, or named
 * in `EXTRA_NODE_SETTINGS` — else a published app's node runs without it. This reads every `case
 * "<type>"` block of payload-builder.ts for its `data.<key>` reads and fails on one that is neither a
 * setting nor held (a run's result, the node's own value, an input copy, a library pointer), unless
 * it is listed below with why it may go.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isHeldKey, nodeSettingKeys } from "@nodaro/render-rules"

/** Reads that go on a published node on purpose, by type, each with why. */
const GOES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "add-captions": {
    transcript: "the video's words: content, never configuration",
    text: "caption words a run may write: content",
    segments: "caption words and times a run may write: content",
  },
  "apply-edl": { transcript: "the episode's words: content" },
  "speaker-frames": { edl: "an edit list read inline only when no wire brings one: content", transcript: "the episode's words: content" },
  "image-collage": { imageLabels: "label text that may come from a run: content" },
  "text-to-dialogue": { script: "the words spoken, read only as an older spelling of the dialogue: content" },
  "edit-image": Object.fromEntries(["aspectRatio", "negativePrompt", "prompt", "seed", "style", "targetResolution", "upscaleFactor"].map((k) => [k, "a legacy type the editor rewrites on load (normalize-node-types)"])),
  "image-to-image": Object.fromEntries(["aspectRatio", "guidanceScale", "negativePrompt", "prompt", "quality", "referenceOrder", "renderingSpeed", "resolution", "seed", "strength", "style", "suppressedCanonicalCharacterIds", "suppressedCanonicalLocationIds"].map((k) => [k, "a legacy type the editor rewrites on load (normalize-node-types)"])),
  scene: Object.fromEntries(["aspectRatio", "characters", "locations", "objects", "prompt", "provider"].map((k) => [k, "the older Scene shape; the editor writes the pipeline shape"])),
  ...Object.fromEntries(["character", "face", "object", "creature", "location"].map((t) => [t, { name: "an older name field; the entity's name is its own declared field", prompt: "an older prompt field; a library entity in the strip set is stripped strictly" }])),
  "edit-3d-scene": { operations: "the edit plan the run builds" },
  "render-video": Object.fromEntries(["plan", "planType", "sceneGraph", "template"].map((k) => [k, "a composer document the run reads from its input"])),
}

/** Every `data.<key>` read in each `case "<type>"` block of the executor's source. */
function readsByType(source: string): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>()
  let types: string[] = []
  let lastWasCase = false
  for (const line of source.split("\n")) {
    const literal = /^\s*case "([a-z0-9-]+)":/.exec(line)
    if (literal) {
      if (!lastWasCase) types = []
      types.push(literal[1]!)
      lastWasCase = true
      continue
    }
    // A case on a constant, a default or a new switch: no type this guard can name.
    if (/^\s*(case\b|default:|switch \()/.test(line)) {
      types = []
      lastWasCase = false
      continue
    }
    lastWasCase = false
    if (types.length === 0 || /^\s*(\/\/|\*|\/\*)/.test(line)) continue
    for (const m of line.matchAll(/\bdata\??\.([A-Za-z_]\w*)|\bdata\[["']([\w-]+)["']\]/g)) {
      const key = m[1] ?? m[2]!
      for (const type of types) reads.set(type, new Set([...(reads.get(type) ?? []), key]))
    }
  }
  return reads
}

const SOURCE = readFileSync(join(__dirname, "..", "payload-builder.ts"), "utf8")

describe("every key the server's executor reads for a node type is kept by a published app, or goes with a reason", () => {
  it("finds the reads it is meant to police", () => {
    const reads = readsByType(SOURCE)
    expect(reads.get("generate-video")?.has("kling3Sound")).toBe(true)
    expect(reads.size).toBeGreaterThan(40)
  })

  it("each read is a setting, held, or listed with why it goes", () => {
    const unclassified: string[] = []
    for (const [type, keys] of readsByType(SOURCE)) {
      for (const key of keys) {
        if (nodeSettingKeys(type).has(key) || nodeSettingKeys(type, { addressSettings: true }).has(key) || isHeldKey(key, type)) continue
        if (GOES[type]?.[key]) continue
        unclassified.push(`${type}.${key}`)
      }
    }
    expect(unclassified).toEqual([])
  })

  it("a read listed as going is never configuration", () => {
    const kept = Object.entries(GOES).flatMap(([type, keys]) =>
      Object.keys(keys).filter((key) => nodeSettingKeys(type).has(key) || nodeSettingKeys(type, { addressSettings: true }).has(key)).map((key) => `${type}.${key}`),
    )
    expect(kept).toEqual([])
  })

  it("the list names no read that is gone", () => {
    const reads = readsByType(SOURCE)
    const stale = Object.entries(GOES).flatMap(([type, keys]) => Object.keys(keys).filter((key) => !reads.get(type)?.has(key)).map((key) => `${type}.${key}`))
    expect(stale).toEqual([])
  })
})
