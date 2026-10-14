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

describe("every quick-strip control is an app field, or says why not", () => {
  it("each control writes one of its node's settings (a key the node's data type declares)", () => {
    // A control writing anything else moves nothing the node's run reads — a dead lever, in the editor too.
    // Declare the field on the node's *Data type (then regenerate gen:skills) or drop the control.
    const undeclared = controls.flatMap(([type, list]) =>
      list.filter((c) => c.exposable !== false && !c.needsGraph && !isNodeSetting(c.field, type)).map((c) => `${type}.${c.field}`),
    )
    expect(undeclared).toEqual([])
  })

  it("each control is exposable, or opted out with `exposable: false`", () => {
    const missing: string[] = []
    for (const [type, list] of controls) {
      const keys = new Set(getExposableFields(type).map((f) => f.key))
      for (const c of list) {
        if (c.exposable === false) continue
        if (!keys.has(c.field)) missing.push(`${type}.${c.field}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("a control that reads the graph is opted out (an app card has no graph)", () => {
    const offenders = controls.flatMap(([type, list]) =>
      list.filter((c) => c.needsGraph && c.exposable !== false).map((c) => `${type}.${c.field}`),
    )
    expect(offenders).toEqual([])
  })
})

/**
 * Creatable AI nodes that offer an app NOTHING, each with the reason it has no lever a person running the app
 * could meaningfully set. The list only shrinks: an entry that gains a field fails until it is removed here.
 */
const NO_APP_FIELDS: Readonly<Record<string, string>> = {
  "remove-background": "one fixed model and no setting: the image is its whole input",
  "audio-isolation": "one fixed model and no setting: the audio is its whole input",
  "suno-music-video": "no setting: it renders the wired Suno track as it is",
  "suno-convert-wav": "no setting: it converts the wired Suno track as it is",
  "forced-alignment": "no setting: its transcript is an input (expose the Text node that feeds it)",
  "pro-3d-render":
    "its quality, aspect and length are what the deployment's 3D engine serves (read at run time, not a static list), and a scene source carries its own timing",
  "ugc-creator": "has its own whole-node input card (source, gender, photo); the server accepts only those",
  "ugc-clips": "the server refuses any run-time setting on a UGC chain node (UGC_OVERRIDABLE_FIELDS is empty)",
  "ugc-clip": "the server refuses any run-time setting on a UGC chain node (UGC_OVERRIDABLE_FIELDS is empty)",
  "ugc-cards": "the server refuses any run-time setting on a UGC chain node (UGC_OVERRIDABLE_FIELDS is empty)",
  "ugc-finish-clips": "the server refuses any run-time setting on a UGC chain node (UGC_OVERRIDABLE_FIELDS is empty)",
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
      // A strip list can be a function of the node's data only to grey options
      // (the free-credit video locks), never to change which models it lists —
      // so it is read for a node with no settings.
      const stripList = strip && (typeof strip.options === "function" ? strip.options({}) : strip.options)
      const registry = stripList && stripList.length > 0 ? stripList : LEGACY_PROVIDER_REGISTRY[def.type]
      if (!registry) {
        unmatched.push(def.type)
        continue
      }
      expect(values(f.options), def.type).toEqual(values(registry))
    }
    expect(unmatched).toEqual([])
  })
})
