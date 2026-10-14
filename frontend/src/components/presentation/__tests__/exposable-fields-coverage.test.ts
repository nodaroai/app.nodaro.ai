import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_QUICK_CONFIGS, getQuickConfigs } from "@/components/nodes/node-quick-configs"
import { VIDEO_GEN_MODELS, VIDEO_T2V_MODELS } from "@/components/editor/config-panels/model-options"
import { isNodeSetting } from "@nodaro/render-rules"
import { getExposableFields } from "../exposable-fields"

/**
 * What a published app can expose follows what the node offers, instead of a list someone must remember to
 * extend. A node's app fields are its hand-declared `exposableFields` plus its quick-strip controls
 * (exposable-fields.ts); these guards keep the two sources honest with each other.
 */

const controls = Object.entries(NODE_QUICK_CONFIGS())

/**
 * Strip controls that write a key their node's data type does not declare (and that a published app therefore
 * does not keep of the node). Either the data type is missing the field or the lever is dead — not checked per
 * node. They are not app fields (exposable-fields.ts skips any control whose field is not a node setting);
 * declare the field on the data type (then regenerate gen:skills) or drop the control. The list only shrinks.
 */
const UNDECLARED_STRIP_FIELDS: ReadonlyArray<string> = [
  "remove-background.motion",
  "suno-lyrics.model",
  "suno-separate.model",
  "suno-music-video.model",
  "suno-replace-section.model",
  "suno-style-boost.model",
  "suno-convert-wav.model",
  "audio-isolation.provider",
  "voice-changer.targetLanguage",
  "voice-remix.model",
]

describe("every quick-strip control is an app field, or says why not", () => {
  it("each control is exposable, opted out with `exposable: false`, or a listed undeclared field", () => {
    const missing: string[] = []
    for (const [type, list] of controls) {
      const keys = new Set(getExposableFields(type).map((f) => f.key))
      for (const c of list) {
        if (c.exposable === false || UNDECLARED_STRIP_FIELDS.includes(`${type}.${c.field}`)) continue
        if (!keys.has(c.field)) missing.push(`${type}.${c.field}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("the undeclared-field list only shrinks: each entry is still a strip control the node does not declare", () => {
    for (const entry of UNDECLARED_STRIP_FIELDS) {
      const [type, field] = entry.split(".") as [string, string]
      expect(getQuickConfigs(type).some((c) => c.field === field), `${entry} is no longer a strip control`).toBe(true)
      expect(isNodeSetting(field, type), `${entry} is a node setting now — drop it from the list`).toBe(false)
    }
  })

  it("a control that reads the graph is opted out (an app card has no graph)", () => {
    const offenders = controls.flatMap(([type, list]) =>
      list.filter((c) => c.needsGraph && c.exposable !== false).map((c) => `${type}.${c.field}`),
    )
    expect(offenders).toEqual([])
  })
})

/**
 * Creatable AI nodes that still offer an app NOTHING — no hand-declared field and no strip control. Each needs
 * a strip control (or a hand-declared field) to be configurable in an app; the list only shrinks: an entry
 * that gains a field fails until it is removed here.
 */
const NO_APP_FIELDS: Readonly<Record<string, string>> = {
  "video-retake": "bespoke toolbar, no quick-strip control; its levers (model, retake window, mode, resolution) are panel-only",
  "video-sfx": "bespoke toolbar, no quick-strip control",
  "pro-3d-render": "no quick-strip control",
  "reference-board": "no quick-strip control",
  "audio-separation": "no quick-strip control",
  "voice-changer-pro": "no quick-strip control",
  "forced-alignment": "a fixed-price feature with no lever",
  "content-recipe": "no quick-strip control",
  "content-ideas": "no quick-strip control",
  "ugc-creator": "has its own whole-node input card (source, gender, photo)",
  "ugc-clips": "no quick-strip control",
  "ugc-clip": "no quick-strip control",
  "ugc-cards": "no quick-strip control",
  "ugc-finish-clips": "no quick-strip control",
  // Their only strip control writes a field the node does not declare (UNDECLARED_STRIP_FIELDS above).
  ...Object.fromEntries(
    ["remove-background", "suno-lyrics", "suno-separate", "suno-music-video", "suno-replace-section", "suno-style-boost", "suno-convert-wav", "audio-isolation", "voice-changer", "voice-remix"].map(
      (type) => [type, "its only strip control writes an undeclared field"],
    ),
  ),
}

const creatable = new Set(NODE_OPTIONS.map((o) => o.type as string))
const aiNodes = NODE_DEFINITIONS.filter((d) => d.category === "ai" && creatable.has(d.type))

describe("creatable AI nodes offer an app something", () => {
  it("floor: the census still sees the AI nodes", () => {
    expect(aiNodes.length).toBeGreaterThanOrEqual(40)
  })

  it("every creatable AI node has an app field, or is listed with its reason", () => {
    const bare = aiNodes
      .filter((d) => getExposableFields(d.type).length === 0 && !Object.hasOwn(NO_APP_FIELDS, d.type))
      .map((d) => d.type)
    expect(bare, "give the node a quick-strip control (NODE_QUICK_CONFIGS) or list it in NO_APP_FIELDS").toEqual([])
  })

  it("the list only shrinks: each entry still has no field", () => {
    for (const type of Object.keys(NO_APP_FIELDS)) {
      expect(getExposableFields(type), `${type} has app fields now — drop it from NO_APP_FIELDS`).toEqual([])
    }
  })
})

/**
 * A hand-declared select wins its key over the strip, so its static list is what the publisher restricts and
 * what a fallback card offers. It must list the same values as the strip's static list (the registries in
 * model-options.ts) — Generate Video's once lacked its own default model and the whole Seedance 2 family.
 * Legacy types with no strip name their registry here.
 */
const LEGACY_PROVIDER_REGISTRY: Readonly<Record<string, ReadonlyArray<{ value: string | number }>>> = {
  // Both are rewritten to Generate Video in the editor; an app snapshot can still carry one.
  "image-to-video": VIDEO_GEN_MODELS,
  "text-to-video": VIDEO_T2V_MODELS,
}

const values = (list: ReadonlyArray<{ value: string | number }>) => [...list.map((o) => String(o.value))].sort()

describe("a hand-declared select lists what the strip lists", () => {
  it("each collision with a static strip list has the same values", () => {
    const drift: string[] = []
    for (const def of NODE_DEFINITIONS) {
      for (const f of def.exposableFields ?? []) {
        if (f.type !== "select" || !f.options) continue
        const c = getQuickConfigs(def.type).find((q) => q.field === f.key)
        if (!c || typeof c.options === "function") continue
        const a = values(f.options)
        const b = values(c.options)
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          drift.push(`${def.type}.${f.key}: missing [${b.filter((v) => !a.includes(v))}] extra [${a.filter((v) => !b.includes(v))}]`)
        }
      }
    }
    expect(drift).toEqual([])
  })

  it("every hand-declared model field has a registry to match: its strip's, or a named legacy one", () => {
    const unmatched: string[] = []
    for (const def of NODE_DEFINITIONS) {
      const f = def.exposableFields?.find((x) => x.key === "provider" && x.type === "select")
      if (!f?.options) continue
      const strip = getQuickConfigs(def.type).find((q) => q.field === "provider")
      const registry = strip && typeof strip.options !== "function" ? strip.options : LEGACY_PROVIDER_REGISTRY[def.type]
      if (!registry) {
        unmatched.push(def.type)
        continue
      }
      expect(values(f.options), def.type).toEqual(values(registry))
    }
    expect(unmatched).toEqual([])
  })
})
