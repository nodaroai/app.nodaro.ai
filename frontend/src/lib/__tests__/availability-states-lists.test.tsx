// @test-units-by-name checks the picker against the deployment's lists and looks up only the node types it names
/**
 * A deployment that RESTRICTS what it offers with lists in its runtime
 * configuration (`nodes.allow`, `models.allow`, `worlds.allow`) is judged by
 * its own lists before the viewer's availability answer has arrived, by the
 * rule the server applies before any admin setting: while the answer is
 * awaited (also the whole visit of a page that never asks for it: a published
 * app, a signed-out visitor), after a read of it failed, and again after
 * sign-out. So nothing the lists withhold is drawn and then taken away, and
 * nothing they offer is hidden. Once the answer is in it decides, admin
 * switches included.
 *
 * What a deployment without lists shows is pinned, unchanged, in
 * `availability-states-hosted.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import { ALLOW_LIST_EXEMPT_NODE_TYPES } from "@nodaro/shared/runtime-config"
import { SCRAPER_ACTOR_LABELS, type ScraperActorId } from "@nodaro/shared/social"
import { CAMERA_SWITCH_SPEAKER_MAP_HANDLE } from "@nodaro/render-rules"
import {
  __failSurfaceAvailabilityForTests,
  __resetSurfaceAvailabilityForTests,
  isModelUnavailable,
  isNodeUnavailable,
  loadSurfaceAvailability,
  modelRestrictionActive,
  offeredWorlds,
  resetSurfaceAvailability,
  settledNodeJudge,
} from "@/lib/surface-availability"
import { getNodeOptions } from "@/lib/node-options"
import { canvasMacroOf } from "@/lib/canvas-macros"
import { isTargetHandleWithheld } from "@/lib/target-handle-availability"
import { usecaseFramesViewer } from "@/lib/use-case-frames-viewer"
import { usecaseMulticamViewer } from "@/lib/use-case-multicam-viewer"
import { useOneOffCloneWithheld } from "@/lib/voice-clone-availability"
import { offeredWebScrapeSources } from "@/components/editor/config-panels/web-scrape-source-options"
import { IMAGE_GEN_MODELS, withoutDeniedModels } from "@/components/editor/config-panels/model-options"
import { getQuickConfigs, resolveQuickConfigOptions } from "@/components/nodes/node-quick-configs"
import { whiteLabelWorldMenus } from "@/ee/shell/white-label"

const SCRAPER_ACTOR_IDS = Object.keys(SCRAPER_ACTOR_LABELS) as ScraperActorId[]
const HOUSE_MODELS = Object.entries(MODEL_CATALOG)
  .filter(([, entry]) => entry.ownLabel === true)
  .map(([id]) => id)

/** A whitelist deployment: it offers images, translation and the editor, two image models and one LLM. */
const ALLOWED_NODES = ["generate-image", "dubbing", "speaker-frames", "web-scrape", "text-to-speech"]
const ALLOWED_MODELS = ["nano-banana-2", "gpt-image", LLM_MODELS[0]!.id]
const WHITELIST = {
  nodes: { allow: ALLOWED_NODES, deny: [] },
  models: { allow: ALLOWED_MODELS, deny: [] },
  worlds: { allow: ["image", "video", "app"], order: ["app"] },
}
function configure(surface: Record<string, unknown>): void {
  window.__NODARO_RUNTIME__ = { surface } as unknown as typeof window.__NODARO_RUNTIME__
}

const pending = () => __resetSurfaceAvailabilityForTests(null)
const failed = () => __failSurfaceAvailabilityForTests()
const providerControl = (type: string) => {
  const control = getQuickConfigs(type).find((c) => c.field === "provider")
  if (!control) throw new Error(`${type} has no provider control`)
  return control
}
const offeredByLists = (type: string) => ALLOWED_NODES.includes(type) || ALLOW_LIST_EXEMPT_NODE_TYPES.includes(type)

beforeEach(() => {
  configure(WHITELIST)
  pending()
})
afterEach(() => {
  __resetSurfaceAvailabilityForTests(null)
  delete window.__NODARO_RUNTIME__
})

describe.each([
  ["while the answer is awaited (or never asked: a published app, a signed-out visitor)", pending],
  ["after a read of it failed", failed],
])("a whitelist deployment, %s", (_state, enter) => {
  beforeEach(enter)

  it("the node picker offers exactly what the lists offer, utility nodes included", () => {
    const types = getNodeOptions().map((o) => o.type)
    expect(types).toEqual(expect.arrayContaining(["generate-image", "dubbing", "sticky-note", "preview"]))
    expect(types).not.toContain("generate-video")
    expect(types).not.toContain("combine-text")
    for (const type of types) {
      const macro = canvasMacroOf(type)
      expect(macro ? macro.childTypes.every(offeredByLists) : offeredByLists(type), type).toBe(true)
    }
  })

  it("a model menu offers only the listed models (the editor's panel, and a published app's card)", () => {
    expect(withoutDeniedModels(IMAGE_GEN_MODELS, { nodeType: "generate-image" }).map((m) => m.value)).toEqual(
      IMAGE_GEN_MODELS.map((m) => m.value).filter((id) => ALLOWED_MODELS.includes(id)),
    )
    const card = resolveQuickConfigOptions(providerControl("generate-image"), {}).map((o) => o.value)
    expect(card.length).toBeGreaterThan(0)
    expect(card.every((id) => ALLOWED_MODELS.includes(id))).toBe(true)
    expect(modelRestrictionActive()).toBe(true)
  })

  it("an LLM menu offers only the listed LLM; a house model stays withheld", () => {
    expect(LLM_MODELS.filter((m) => !isModelUnavailable(m.id)).map((m) => m.id)).toEqual([LLM_MODELS[0]!.id])
    for (const id of HOUSE_MODELS) expect(isModelUnavailable(id), id).toBe(true)
  })

  it("the worlds are the profile's, less one whose node types the lists withhold", () => {
    // Video runs generate-video and text-to-video, which the whitelist leaves out.
    expect(offeredWorlds()).toEqual(["app", "image"])
  })

  it("the header's Translate follows the lists: offered with dubbing, withheld without it", () => {
    expect(whiteLabelWorldMenus(settledNodeJudge())).toEqual({ video: { pages: ["translate"] } })
    configure({ ...WHITELIST, nodes: { allow: ["generate-image"], deny: [] } })
    expect(whiteLabelWorldMenus(settledNodeJudge())).toEqual({ video: { pages: [] } })
  })

  it("an input that follows a node follows the lists", () => {
    expect(isTargetHandleWithheld("camera-switch", CAMERA_SWITCH_SPEAKER_MAP_HANDLE)).toBe(true)
    configure({ ...WHITELIST, nodes: { allow: [...ALLOWED_NODES, "speaker-map"], deny: [] } })
    expect(isTargetHandleWithheld("camera-switch", CAMERA_SWITCH_SPEAKER_MAP_HANDLE)).toBe(false)
  })

  it("the framing source follows the lists from the first paint", () => {
    expect(usecaseFramesViewer()).toBe("offered")
    configure({ ...WHITELIST, nodes: { allow: ["generate-image"], deny: [] } })
    expect(usecaseFramesViewer()).toBe("withheld")
  })

  it("a one-off voice clone: withheld unless listed, and by a deny of the Voice Clone node", () => {
    expect(renderHook(() => useOneOffCloneWithheld()).result.current).toBe(true)
    configure({ ...WHITELIST, nodes: { allow: [...ALLOWED_NODES, "voice-clone-one-off"], deny: [] } })
    expect(renderHook(() => useOneOffCloneWithheld()).result.current).toBe(false)
    configure({ ...WHITELIST, nodes: { allow: [], deny: ["voice-clone"] } })
    expect(renderHook(() => useOneOffCloneWithheld()).result.current).toBe(true)
  })

  it("Web Scrape offers only the node's current source: the lists cannot say which sources follow a withheld node", () => {
    expect(offeredWebScrapeSources(SCRAPER_ACTOR_IDS, "rss")).toEqual(["rss"])
  })
})

describe("a whitelist deployment once the answer is in: the answer decides, admin switches included", () => {
  it("a node or model an admin switched off is withheld, one released beyond the lists is offered", () => {
    __resetSurfaceAvailabilityForTests({
      nodes: ["dubbing"],
      models: ["gpt-image"],
      modelsRestricted: true,
      worlds: ["video", "app"],
    })
    expect(isNodeUnavailable("dubbing")).toBe(true)
    expect(isNodeUnavailable("generate-video")).toBe(false)
    expect(getNodeOptions().map((o) => o.type)).toEqual(expect.arrayContaining(["generate-video"]))
    expect(withoutDeniedModels(IMAGE_GEN_MODELS, { nodeType: "generate-image" }).map((m) => m.value)).toContain("flux")
    expect(isModelUnavailable("gpt-image")).toBe(true)
    expect(offeredWorlds()).toEqual(["video", "app"])
    expect(whiteLabelWorldMenus(settledNodeJudge())).toEqual({ video: { pages: [] } })
  })

  it("Web Scrape sources: what the answer withdraws", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [], webScrapeSources: { denied: ["instagram"] } })
    expect(offeredWebScrapeSources(SCRAPER_ACTOR_IDS, "rss")).toEqual(SCRAPER_ACTOR_IDS.filter((id) => id !== "instagram"))
  })

  it("the cameras settings wait for the answer: they follow the run, which reads one recording until then", () => {
    expect(usecaseMulticamViewer()).toBe("loading")
    failed()
    expect(usecaseMulticamViewer()).toBe("withheld")
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
    expect(usecaseMulticamViewer()).toBe("offered")
  })
})

describe("signing out of a whitelist deployment", () => {
  it("drops the viewer's answer, and the lists decide again (never everything)", async () => {
    const fetchOk = async () => ({ ok: true, json: async () => ({ nodes: { denied: [] }, models: { denied: [] }, worlds: [] }) })
    const realFetch = globalThis.fetch
    globalThis.fetch = fetchOk as unknown as typeof fetch
    try {
      await loadSurfaceAvailability(async () => ({}), "viewer-1")
      expect(isNodeUnavailable("generate-video")).toBe(false)
      resetSurfaceAvailability()
      expect(isNodeUnavailable("generate-video")).toBe(true)
      expect(getNodeOptions().map((o) => o.type)).not.toContain("generate-video")
      expect(offeredWorlds()).toEqual(["app", "image"])
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe("a deny-only deployment before the answer", () => {
  beforeEach(() => configure({ nodes: { allow: [], deny: ["dubbing"] }, models: { allow: [], deny: ["gpt-image"] } }))

  it("withholds what it denies and nothing else, and its lists decide from the first paint", () => {
    expect(isNodeUnavailable("dubbing")).toBe(true)
    expect(isNodeUnavailable("generate-video")).toBe(false)
    expect(isModelUnavailable("gpt-image")).toBe(true)
    expect(isModelUnavailable("nano-banana-2")).toBe(false)
    expect(whiteLabelWorldMenus(settledNodeJudge())).toEqual({ video: { pages: [] } })
    expect(offeredWorlds()).toContain("video")
  })
})
