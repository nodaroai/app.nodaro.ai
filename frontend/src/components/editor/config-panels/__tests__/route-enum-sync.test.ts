/**
 * Frontend dropdown ↔ shared provider list sync tests.
 *
 * For every backend route that uses a shared provider list as its Zod enum
 * (e.g. `provider: z.enum(IMAGE_GEN_PROVIDERS)`), the corresponding frontend
 * dropdown must be a SUBSET of that list. If a developer adds a model to the
 * UI dropdown but forgets to add it to the shared list, the route Zod
 * rejects every request for that model.
 *
 * The typed lists (e.g. `VIDEO_T2V_MODELS: { value: TextToVideoProvider }[]`)
 * already get this for free — TypeScript prevents drift at compile time.
 * But several dropdowns are UNTYPED:
 *   - VIDEO_I2V_MODELS
 *   - MODIFY_IMAGE_MODELS (spreads typed array, but adds an untyped extra)
 *   - UPSCALE_IMAGE_MODELS
 *   - LIP_SYNC_MODELS, TTS_MODELS, SUNO_MODELS (each with its own typing)
 *
 * These runtime tests catch drift in the untyped lists.
 */

import { describe, it, expect } from "vitest"
import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  IMAGE_EDIT_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_TO_VIDEO_PROVIDERS,
  LIP_SYNC_PROVIDERS,
  TTS_PROVIDERS,
  SUNO_MODELS as SUNO_PROVIDERS_SHARED,
} from "@nodaro/shared"
import {
  IMAGE_GEN_MODELS,
  IMAGE_I2I_MODELS,
  MODIFY_IMAGE_MODELS,
  UPSCALE_IMAGE_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_V2V_MODELS,
  LIP_SYNC_MODELS,
  TTS_MODELS,
  SUNO_MODELS as SUNO_MODELS_FRONTEND,
} from "../model-options"

function checkSubset(
  label: string,
  frontendValues: ReadonlyArray<{ value: string }>,
  shared: ReadonlySet<string>,
) {
  const orphans = frontendValues
    .map((m) => m.value)
    .filter((v) => !shared.has(v))
  expect(
    orphans,
    `These ${label} dropdown entries are NOT in the shared provider list. The route Zod will reject every request for these models — either add them to the shared list in @nodaro/shared/model-constants.ts, or remove them from the dropdown: ${orphans.join(", ")}`,
  ).toEqual([])
}

describe("frontend dropdown ⊆ shared provider list", () => {
  it("IMAGE_GEN_MODELS values ⊆ IMAGE_GEN_PROVIDERS", () => {
    checkSubset("IMAGE_GEN_MODELS", IMAGE_GEN_MODELS, new Set(IMAGE_GEN_PROVIDERS))
  })

  it("IMAGE_I2I_MODELS values ⊆ IMAGE_I2I_PROVIDERS", () => {
    checkSubset("IMAGE_I2I_MODELS", IMAGE_I2I_MODELS, new Set(IMAGE_I2I_PROVIDERS))
  })

  it("MODIFY_IMAGE_MODELS values ⊆ IMAGE_I2I_PROVIDERS ∪ IMAGE_EDIT_PROVIDERS", () => {
    // MODIFY_IMAGE_MODELS spreads IMAGE_I2I_MODELS plus adds nano-banana-edit
    // (an IMAGE_EDIT_PROVIDERS entry). The route image-to-image.ts uses
    // IMAGE_I2I_PROVIDERS but the modify-image surface accepts both.
    const allowed = new Set<string>([...IMAGE_I2I_PROVIDERS, ...IMAGE_EDIT_PROVIDERS])
    checkSubset("MODIFY_IMAGE_MODELS", MODIFY_IMAGE_MODELS, allowed)
  })

  it("UPSCALE_IMAGE_MODELS values ⊆ IMAGE_EDIT_PROVIDERS", () => {
    // Upscale models are routed through the edit-image route per IMAGE_EDIT_PROVIDERS.
    // (UPSCALE_IMAGE_PROVIDERS exists in shared but no current route consumes it
    // — see backend route-enum-sync test for the larger UPSCALE_IMAGE_PROVIDERS
    // story.)
    const allowed = new Set<string>(IMAGE_EDIT_PROVIDERS)
    checkSubset("UPSCALE_IMAGE_MODELS", UPSCALE_IMAGE_MODELS, allowed)
  })

  it("VIDEO_I2V_MODELS values ⊆ IMAGE_TO_VIDEO_PROVIDERS", () => {
    checkSubset("VIDEO_I2V_MODELS", VIDEO_I2V_MODELS, new Set(IMAGE_TO_VIDEO_PROVIDERS))
  })

  it("VIDEO_T2V_MODELS values ⊆ TEXT_TO_VIDEO_PROVIDERS", () => {
    checkSubset("VIDEO_T2V_MODELS", VIDEO_T2V_MODELS, new Set(TEXT_TO_VIDEO_PROVIDERS))
  })

  it("VIDEO_V2V_MODELS values ⊆ VIDEO_TO_VIDEO_PROVIDERS", () => {
    checkSubset("VIDEO_V2V_MODELS", VIDEO_V2V_MODELS, new Set(VIDEO_TO_VIDEO_PROVIDERS))
  })

  it("LIP_SYNC_MODELS values ⊆ LIP_SYNC_PROVIDERS", () => {
    checkSubset("LIP_SYNC_MODELS", LIP_SYNC_MODELS, new Set(LIP_SYNC_PROVIDERS))
  })

  it("TTS_MODELS values ⊆ TTS_PROVIDERS", () => {
    checkSubset("TTS_MODELS", TTS_MODELS, new Set(TTS_PROVIDERS))
  })

  it("SUNO_MODELS (frontend) values ⊆ SUNO_MODELS (shared)", () => {
    checkSubset("SUNO_MODELS", SUNO_MODELS_FRONTEND, new Set(SUNO_PROVIDERS_SHARED))
  })
})
