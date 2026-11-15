// @test-units-by-name compares the picker with itself across availability states and looks up only the node types it names
/**
 * What a deployment that sets no lists (the hosted product, a community install)
 * shows in each state of the viewer's availability answer
 * (`GET /v1/surface/availability`): while it is awaited (also the whole visit of
 * a page that never asks: a published app, a signed-out visitor), after a read
 * of it that failed, and once it has answered. Nothing is withheld before an
 * answer but a house model, and the readers that wait for the answer keep
 * waiting; once it answers, it decides.
 *
 * These pin the behaviour as it was before the lists rule for a deployment
 * that sets lists (`availability-states-lists.test.tsx`), and must keep passing
 * unchanged after it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import { SCRAPER_ACTOR_LABELS, type ScraperActorId } from "@nodaro/shared/social"
import { CAMERA_SWITCH_SPEAKER_MAP_HANDLE } from "@nodaro/render-rules"
import {
  __failSurfaceAvailabilityForTests,
  __resetSurfaceAvailabilityForTests,
  isModelUnavailable,
  isNodeUnavailable,
  modelRestrictionActive,
} from "@/lib/surface-availability"
import { getNodeOptions } from "@/lib/node-options"
import { isTargetHandleWithheld } from "@/lib/target-handle-availability"
import { usecaseFramesViewer } from "@/lib/use-case-frames-viewer"
import { usecaseMulticamViewer } from "@/lib/use-case-multicam-viewer"
import { useOneOffCloneWithheld } from "@/lib/voice-clone-availability"
import { offeredWebScrapeSources } from "@/components/editor/config-panels/web-scrape-source-options"
import { IMAGE_GEN_MODELS, withoutDeniedModels } from "@/components/editor/config-panels/model-options"

const SCRAPER_ACTOR_IDS = Object.keys(SCRAPER_ACTOR_LABELS) as ScraperActorId[]
const HOUSE_MODELS = Object.entries(MODEL_CATALOG)
  .filter(([, entry]) => entry.ownLabel === true)
  .map(([id]) => id)
const MODEL_IDS = [...Object.keys(MODEL_CATALOG), ...LLM_MODELS.map((m) => m.id)]
/** Node types the readers below ask about, among them a utility node, the worlds' nodes and the features with no canvas node. */
const NODE_TYPES = [
  "dubbing",
  "generate-image",
  "generate-video",
  "text-to-video",
  "suno-generate",
  "voice-changer-pro",
  "cast-swap",
  "voice-clone",
  "voice-clone-one-off",
  "speaker-map",
  "speaker-frames",
  "sticky-note",
  "site-capture",
]

const pending = () => __resetSurfaceAvailabilityForTests(null)
const failed = () => __failSurfaceAvailabilityForTests()

beforeEach(() => {
  delete window.__NODARO_RUNTIME__
  pending()
})
afterEach(() => {
  __resetSurfaceAvailabilityForTests(null)
  delete window.__NODARO_RUNTIME__
})

describe.each([
  ["with no surface profile", () => delete window.__NODARO_RUNTIME__],
  ["with a surface profile that sets no lists", () => {
    window.__NODARO_RUNTIME__ = { surface: { nodes: { allow: [], deny: [] }, models: { allow: [], deny: [] } } } as unknown as typeof window.__NODARO_RUNTIME__
  }],
])("a deployment that sets no lists (%s)", (_name, configure) => {
  beforeEach(configure)

  describe.each([
    ["while the answer is awaited", pending],
    ["after a read of it failed", failed],
  ])("%s", (_state, enter) => {
    beforeEach(enter)

    it("withholds no node type", () => {
      for (const type of NODE_TYPES) expect(isNodeUnavailable(type), type).toBe(false)
    })

    it("the node picker offers what it offers with an answer that withholds nothing", () => {
      const before = getNodeOptions().map((o) => o.type)
      __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
      expect(before).toEqual(getNodeOptions().map((o) => o.type))
      expect(before).toEqual(expect.arrayContaining(["dubbing", "generate-video", "sticky-note"]))
    })

    it("withholds exactly the house models, and does not restrict models", () => {
      expect(HOUSE_MODELS.length).toBeGreaterThan(0)
      expect(MODEL_IDS.filter(isModelUnavailable).sort()).toEqual([...HOUSE_MODELS].sort())
      expect(modelRestrictionActive()).toBe(false)
    })

    it("a model menu offers every row but a house model's", () => {
      const rows = withoutDeniedModels(IMAGE_GEN_MODELS, { nodeType: "generate-image" }).map((m) => m.value)
      expect(rows).toEqual(IMAGE_GEN_MODELS.map((m) => m.value).filter((id) => !HOUSE_MODELS.includes(id)))
    })

    it("offers every Web Scrape source", () => {
      expect(offeredWebScrapeSources(SCRAPER_ACTOR_IDS, "content-crawler")).toEqual([...SCRAPER_ACTOR_IDS])
    })

    it("does not withhold a one-off voice clone", () => {
      expect(renderHook(() => useOneOffCloneWithheld()).result.current).toBe(false)
    })

    it("withholds the input that follows Speaker Map until the answer offers it", () => {
      expect(isTargetHandleWithheld("camera-switch", CAMERA_SWITCH_SPEAKER_MAP_HANDLE)).toBe(true)
    })
  })

  it("while awaited, the framing source and the cameras settings wait for the answer", () => {
    expect(usecaseFramesViewer()).toBe("loading")
    expect(usecaseMulticamViewer()).toBe("loading")
  })

  it("after a failed read, the framing source is offered and the cameras settings are withheld", () => {
    failed()
    expect(usecaseFramesViewer()).toBe("offered")
    expect(usecaseMulticamViewer()).toBe("withheld")
  })

  describe("once the answer is in, it decides", () => {
    it("node types: exactly what it withholds", () => {
      __resetSurfaceAvailabilityForTests({ nodes: ["dubbing", "speaker-map", "speaker-frames", "voice-clone-one-off"], models: [] })
      expect(NODE_TYPES.filter(isNodeUnavailable).sort()).toEqual(["dubbing", "speaker-frames", "speaker-map", "voice-clone-one-off"])
      expect(getNodeOptions().map((o) => o.type)).not.toContain("dubbing")
      expect(isTargetHandleWithheld("camera-switch", CAMERA_SWITCH_SPEAKER_MAP_HANDLE)).toBe(true)
      expect(usecaseFramesViewer()).toBe("withheld")
      expect(usecaseMulticamViewer()).toBe("withheld")
      expect(renderHook(() => useOneOffCloneWithheld()).result.current).toBe(true)
    })

    it("an answer that withholds nothing offers everything, house models included", () => {
      __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
      expect(NODE_TYPES.filter(isNodeUnavailable)).toEqual([])
      expect(MODEL_IDS.filter(isModelUnavailable)).toEqual([])
      expect(isTargetHandleWithheld("camera-switch", CAMERA_SWITCH_SPEAKER_MAP_HANDLE)).toBe(false)
      expect(usecaseFramesViewer()).toBe("offered")
      expect(usecaseMulticamViewer()).toBe("offered")
      expect(renderHook(() => useOneOffCloneWithheld()).result.current).toBe(false)
    })

    it("models: exactly what it withholds, and its own word on whether models are restricted", () => {
      __resetSurfaceAvailabilityForTests({ nodes: [], models: ["nano-banana-2"], modelsRestricted: false })
      expect(MODEL_IDS.filter(isModelUnavailable)).toEqual(["nano-banana-2"])
      expect(withoutDeniedModels(IMAGE_GEN_MODELS, { nodeType: "generate-image" }).map((m) => m.value)).not.toContain("nano-banana-2")
      expect(modelRestrictionActive()).toBe(false)
    })

    it("Web Scrape sources: what it withdraws, the node's current source kept", () => {
      __resetSurfaceAvailabilityForTests({ nodes: [], models: [], webScrapeSources: { denied: ["instagram"] } })
      expect(offeredWebScrapeSources(SCRAPER_ACTOR_IDS, "content-crawler")).toEqual(SCRAPER_ACTOR_IDS.filter((id) => id !== "instagram"))
      expect(offeredWebScrapeSources(SCRAPER_ACTOR_IDS, "instagram")).toEqual([...SCRAPER_ACTOR_IDS])
    })
  })
})
