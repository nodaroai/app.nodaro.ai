import { describe, expect, it } from "vitest"
import {
  EXTEND_VIDEO_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  OBJECT_MOTION_PROVIDERS,
  RETIRED_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  canonicalVideoProvider,
} from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"
import { PIPELINE_PINNABLE_VIDEO_MODELS, PipelineConfigSchema } from "../pipeline-types.js"

/**
 * A retired video model id (Seedance 1.5, retired upstream 2026-10-25; the one
 * Seedance Extend Video provider, split into one provider per model) has no
 * catalog entry and is in no provider list; every stored or sent copy of its
 * id runs as the model it became.
 */
describe("RETIRED_VIDEO_PROVIDERS", () => {
  it("a retired id is gone from the catalog and every provider list; the model it runs as is live in the list of its own kind", () => {
    for (const [retired, runsAs] of Object.entries(RETIRED_VIDEO_PROVIDERS)) {
      expect(MODEL_CATALOG[retired], retired).toBeUndefined()
      for (const list of [IMAGE_TO_VIDEO_PROVIDERS, TEXT_TO_VIDEO_PROVIDERS, OBJECT_MOTION_PROVIDERS, PIPELINE_PINNABLE_VIDEO_MODELS, EXTEND_VIDEO_PROVIDERS]) {
        expect((list as readonly string[]).includes(retired), retired).toBe(false)
      }
      expect(MODEL_CATALOG[runsAs]?.kind, runsAs).toBe("video")
      if (MODEL_CATALOG[runsAs]!.modes.includes("extend")) {
        // An Extend Video provider: live in the extend list.
        expect((EXTEND_VIDEO_PROVIDERS as readonly string[]).includes(runsAs), runsAs).toBe(true)
      } else {
        // A generation model: live in both modes.
        expect((IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).includes(runsAs), runsAs).toBe(true)
        expect((TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes(runsAs), runsAs).toBe(true)
      }
    }
  })

  it("canonicalVideoProvider maps a retired id and passes anything else through", () => {
    expect(canonicalVideoProvider("seedance")).toBe("seedance-2-mini")
    expect(canonicalVideoProvider("seedance-2-extend")).toBe("seedance-2-5-extend")
    expect(canonicalVideoProvider("seedance-2")).toBe("seedance-2")
    expect(canonicalVideoProvider("seedance-2-0-extend")).toBe("seedance-2-0-extend")
    expect(canonicalVideoProvider(undefined)).toBeUndefined()
    expect(canonicalVideoProvider("constructor")).toBe("constructor")
  })

  it("a saved pipeline pinned to a retired model reads as the model it runs as", () => {
    const parsed = PipelineConfigSchema.parse({ video_model: "seedance", stage_models: { shots_video: "seedance" } })
    expect(parsed.video_model).toBe("seedance-2-mini")
    expect(parsed.stage_models?.shots_video).toBe("seedance-2-mini")
  })
})
