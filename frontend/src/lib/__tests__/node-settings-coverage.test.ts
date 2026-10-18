// @test-watches frontend/src/nodes/**
/**
 * Publishing empties a node in a UGC strip set to its configuration, read as an allowlist from the
 * table `gen:skills` generates out of this app's node declarations (`NODE_DATA_FIELDS`,
 * @nodaro/render-rules). So every node type must have a declared data type there, its default data
 * must be in the table, and the table must name no type that no longer exists — or a published app
 * would lose the node's settings, or the table would describe nodes nobody can add.
 */
import { describe, expect, it } from "vitest"
import { COMPOSER_PLAN_FIELDS } from "@nodaro/shared/models"
import type { CameraSwitchNodeSettings } from "@nodaro/shared/edl"
import { NODE_DATA_FIELDS, RUN_INPUT_COPY_KEYS, nodeSettingKeys } from "@nodaro/render-rules"
import { NODE_DEFINITIONS } from "@/types/nodes"

/**
 * The composer plans a publish keeps on a node it empties, each with why: a document the person
 * authors and revises on the canvas, not one the node's run rebuilds from its input. Every other plan
 * is rebuilt from the input when the node runs and holds a copy of it (`RUN_INPUT_COPY_KEYS`): it
 * goes. A file address inside a kept plan is cleared like any setting's.
 */
const KEPT_PLANS: Readonly<Record<string, string>> = {
  sceneGraph: "Video Composer's scene: the person's composition, not rebuilt from its input",
  overlayPlan: "Lottie Overlay's plan: not rebuilt from its input when the node runs",
  motionPlan: "Motion Graphics' plan: the document an app's runners edit",
  scenePlan: "a 3D scene's plan: the scene document the person revises on the canvas",
}

describe("every node type's settings are declared", () => {
  it("each node type has a declared data type in the generated table (run `npm run gen:skills` in backend/ after changing one)", () => {
    const undeclared = NODE_DEFINITIONS.filter((d) => !Object.hasOwn(NODE_DATA_FIELDS, d.type) || !NODE_DATA_FIELDS[d.type]!.declared).map((d) => d.type)
    expect(undeclared).toEqual([])
  })

  it("each node type's default data is in the table", () => {
    const missing = NODE_DEFINITIONS.flatMap((d) =>
      Object.keys(d.defaultData ?? {}).filter((key) => !NODE_DATA_FIELDS[d.type]?.fields.includes(key)).map((key) => `${d.type}.${key}`),
    )
    expect(missing).toEqual([])
  })

  it("the table names no node type that does not exist", () => {
    const types = new Set<string>(NODE_DEFINITIONS.map((d) => d.type))
    expect(Object.keys(NODE_DATA_FIELDS).filter((type) => !types.has(type))).toEqual([])
  })

  it("each node type keeps its name and its field mappings as settings", () => {
    for (const d of NODE_DEFINITIONS) {
      expect(nodeSettingKeys(d.type).has("label"), d.type).toBe(true)
      expect(nodeSettingKeys(d.type).has("fieldMappings"), d.type).toBe(true)
    }
  })

  it("every key Camera Switch's shared payload funnel reads is a setting (the server reads them through `cameraSwitchSettingsPayload`, which the executor-reads guard cannot see)", () => {
    // `satisfies` makes a key added to CameraSwitchNodeSettings fail to compile until it is listed here.
    const funnelKeys = { speakerMap: true, speakerMapByOrder: true, speakerNames: true, minShotMs: true, leadMs: true, maxShotMs: true, wideEvery: true, layoutHints: true } satisfies Record<keyof CameraSwitchNodeSettings, true>
    expect(Object.keys(funnelKeys).filter((key) => !nodeSettingKeys("camera-switch").has(key))).toEqual([])
    expect(nodeSettingKeys("camera-switch").has("speakerMapByOrder")).toBe(true)
  })

  it("every composer plan is rebuilt from the node's input and goes, or is a document the person authors, kept with its reason", () => {
    expect(COMPOSER_PLAN_FIELDS.filter((field) => !RUN_INPUT_COPY_KEYS.includes(field) && !Object.hasOwn(KEPT_PLANS, field))).toEqual([])
    expect(Object.keys(KEPT_PLANS).filter((field) => RUN_INPUT_COPY_KEYS.includes(field) || !COMPOSER_PLAN_FIELDS.includes(field))).toEqual([])
  })
})
