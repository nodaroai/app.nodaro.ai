// @test-units-by-name looks up only the node types it names (modify-image, generate-video, extend-video)
/**
 * The new-node rule (`new-node-models.ts`, decided 2026-11-10), two more ways:
 *  - Reset to default applies it: a node reset to its defaults starts where a
 *    new node starts — the first model its menu offers when the default is
 *    withheld (the patch the preset menu writes).
 *  - The model chosen is the first offered one the USER can run: a row the
 *    account's free-credit video limits lock (its menu marks it) is skipped,
 *    and when every offered row is locked, the first offered row is taken, as
 *    before.
 */
import { describe, it, expect, afterEach, vi } from "vitest"

const limits = vi.hoisted(() => ({ current: null as { enabled: boolean; maxSeconds: number } | null }))
vi.mock("@/lib/free-video-locks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/free-video-locks")>()),
  cachedFreeVideoLimits: () => limits.current,
}))

import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { lockedVideoModel } from "@/lib/free-video-locks"
import { planNewNodeModels, withOfferedResetModels } from "@/components/editor/config-panels/new-node-models"
import { EXTEND_VIDEO_MODELS, MODIFY_IMAGE_MODELS, VIDEO_GEN_MODELS } from "@/components/editor/config-panels/model-options"
import { buildResetToDefaultData } from "@/lib/preset-tree"
import { curatedNodeDefaults } from "@/lib/curated-node-defaults"
import { NODE_DEFINITIONS } from "@/types/nodes"

afterEach(() => {
  __resetSurfaceAvailabilityForTests(null)
  limits.current = null
})

const defaultsOf = (type: string): Record<string, unknown> => ({ ...(NODE_DEFINITIONS.find((d) => d.type === type)!.defaultData as Record<string, unknown>) })
const withholding = (models: readonly string[], restricted = true) =>
  __resetSurfaceAvailabilityForTests({ nodes: [], models: [...models], modelsRestricted: restricted })

/** The patch the preset menu's Reset writes for a node holding `current`. */
const resetPatch = (type: string, current: Record<string, unknown>) =>
  withOfferedResetModels(type, current, curatedNodeDefaults(type, buildResetToDefaultData(current, NODE_DEFINITIONS.find((d) => d.type === type)!.defaultData as Record<string, unknown>, type)))

describe("Reset to default starts the node where a new node starts", () => {
  it("a withheld default moves to the first row the menu offers", () => {
    const def = defaultsOf("modify-image").provider as string
    const other = MODIFY_IMAGE_MODELS.find((m) => m.value !== def)!.value
    withholding([def])
    const patch = resetPatch("modify-image", { ...defaultsOf("modify-image"), provider: other, prompt: "kept" })
    expect(patch.provider).toBe(MODIFY_IMAGE_MODELS.find((m) => m.value !== def)!.value)
    // The rest is the reset as it was.
    expect(patch.__activePresetId).toBeUndefined()
  })

  it("an offered default resets as before — the very same patch", () => {
    withholding(["some-other-model"])
    const current = { ...defaultsOf("modify-image"), provider: MODIFY_IMAGE_MODELS[3]!.value }
    const reset = curatedNodeDefaults("modify-image", buildResetToDefaultData(current, NODE_DEFINITIONS.find((d) => d.type === "modify-image")!.defaultData as Record<string, unknown>, "modify-image"))
    expect(withOfferedResetModels("modify-image", current, reset)).toBe(reset)
  })

  it("a deployment that restricts nothing resets to the default even when an admin switched it off", () => {
    const def = defaultsOf("modify-image").provider as string
    withholding([def], false)
    expect(resetPatch("modify-image", { ...defaultsOf("modify-image"), provider: MODIFY_IMAGE_MODELS[3]!.value }).provider).toBe(def)
  })
})

describe("the model chosen is the first offered one the user can run", () => {
  const FREE = { enabled: true, maxSeconds: 4 }

  it("a row the free-credit video limits lock is skipped", () => {
    limits.current = FREE
    const def = defaultsOf("generate-video").provider as string
    const offered = VIDEO_GEN_MODELS.map((m) => m.value).filter((v) => v !== def)
    const firstOpen = offered.find((v) => lockedVideoModel(FREE, v) === null)
    const firstLocked = offered.find((v) => lockedVideoModel(FREE, v) !== null)
    expect(firstOpen, "some row is open on free credits").toBeDefined()
    expect(firstLocked, "some row is locked on free credits").toBeDefined()
    // Withhold the default and every open row before the first locked one, so the first offered row is locked.
    const before = offered.slice(0, offered.indexOf(firstLocked!)).filter((v) => lockedVideoModel(FREE, v) === null)
    withholding([def, ...before])
    const plan = planNewNodeModels("generate-video", defaultsOf("generate-video"))
    const nowOffered = offered.filter((v) => !before.includes(v))
    expect(nowOffered[0]).toBe(firstLocked)
    expect(plan.moved[0]!.to).toBe(nowOffered.find((v) => lockedVideoModel(FREE, v) === null))
  })

  it("when every offered row is locked, the first offered row is taken, as before", () => {
    limits.current = FREE
    const def = defaultsOf("generate-video").provider as string
    const open = VIDEO_GEN_MODELS.map((m) => m.value).filter((v) => v !== def && lockedVideoModel(FREE, v) === null)
    withholding([def, ...open])
    const offered = VIDEO_GEN_MODELS.map((m) => m.value).filter((v) => v !== def && !open.includes(v))
    expect(planNewNodeModels("generate-video", defaultsOf("generate-video")).moved[0]!.to).toBe(offered[0])
  })

  it("an account the limits do not apply to takes the first offered row", () => {
    limits.current = null
    const def = defaultsOf("generate-video").provider as string
    withholding([def])
    expect(planNewNodeModels("generate-video", defaultsOf("generate-video")).moved[0]!.to).toBe(VIDEO_GEN_MODELS.find((m) => m.value !== def)!.value)
  })

  it("an Extend Video row is judged as an extension: none is runnable on free credits, LTX 2.3 Pro included", () => {
    // A free clip may be 10 s here, so LTX's generation model (shortest clip 6 s) is open on its own.
    const ROOMY = { enabled: true, maxSeconds: 10 }
    limits.current = ROOMY
    const def = defaultsOf("extend-video").provider as string
    const offered = EXTEND_VIDEO_MODELS.map((m) => m.value).filter((v) => v !== def)
    // LTX 2.3 Pro extends under its generation id: judged as that model alone, it would look open.
    expect(offered).toContain("ltx-2.3-pro")
    expect(lockedVideoModel(ROOMY, "ltx-2.3-pro")).toBeNull()
    withholding([def])
    // Every offered row is locked, so the first offered row is taken — never LTX as the "runnable" one.
    expect(planNewNodeModels("extend-video", defaultsOf("extend-video")).moved[0]!.to).toBe(offered[0])
  })
})
