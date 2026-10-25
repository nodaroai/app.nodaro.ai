import { describe, expect, it } from "vitest"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  OBJECT_MOTION_PROVIDERS,
  RETIRED_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  canonicalVideoProvider,
} from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"
import { PIPELINE_PINNABLE_VIDEO_MODELS, PipelineConfigSchema } from "../pipeline-types.js"

/**
 * A retired video model (Seedance 1.5, retired upstream 2026-10-25) has no
 * catalog entry and is in no provider list; every stored or sent copy of its
 * id runs as the model it became.
 */
describe("RETIRED_VIDEO_PROVIDERS", () => {
  it("a retired id is gone from the catalog and every provider list; the model it runs as is live in both modes", () => {
    for (const [retired, runsAs] of Object.entries(RETIRED_VIDEO_PROVIDERS)) {
      expect(MODEL_CATALOG[retired], retired).toBeUndefined()
      for (const list of [IMAGE_TO_VIDEO_PROVIDERS, TEXT_TO_VIDEO_PROVIDERS, OBJECT_MOTION_PROVIDERS, PIPELINE_PINNABLE_VIDEO_MODELS]) {
        expect((list as readonly string[]).includes(retired), retired).toBe(false)
      }
      expect(MODEL_CATALOG[runsAs]?.kind, runsAs).toBe("video")
      expect((IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).includes(runsAs)).toBe(true)
      expect((TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes(runsAs)).toBe(true)
    }
  })

  it("canonicalVideoProvider maps a retired id and passes anything else through", () => {
    expect(canonicalVideoProvider("seedance")).toBe("seedance-2-mini")
    expect(canonicalVideoProvider("seedance-2")).toBe("seedance-2")
    expect(canonicalVideoProvider(undefined)).toBeUndefined()
    expect(canonicalVideoProvider("constructor")).toBe("constructor")
  })

  it("a saved pipeline pinned to a retired model reads as the model it runs as", () => {
    const parsed = PipelineConfigSchema.parse({ video_model: "seedance", stage_models: { shots_video: "seedance" } })
    expect(parsed.video_model).toBe("seedance-2-mini")
    expect(parsed.stage_models?.shots_video).toBe("seedance-2-mini")
  })
})
