// @test-watches backend/src/lib/mcp/generated/exposable-quick-fields.ts
import { describe, it, expect } from "vitest"
import { VIDEO_V2V_MODELS } from "@/components/editor/config-panels/model-options"
import { exposableQuickFieldSpecs, renderExposableQuickFieldsModule } from "../exposable-quick-field-spec"

/**
 * The server's copy of the strip-derived app fields. The backend cannot import the strip registry, so it reads
 * a generated table; this test regenerates it and fails when the committed file differs (CI never rewrites it).
 * Fix a failure by regenerating: `npx vitest run <this file> -u` from frontend/.
 */
const specs = exposableQuickFieldSpecs()

describe("exposable quick-field specs", () => {
  it("Video to Video: a fixed model list, a provider-aware resolution, a boolean draft", () => {
    const v2v = specs["video-to-video"]!
    expect(v2v.provider).toEqual({ valueType: "string", fixed: true, values: VIDEO_V2V_MODELS.map((m) => String(m.value)).sort() })
    expect(v2v.v2vResolution!.fixed).toBe(false)
    expect(v2v.v2vResolution!.values).toEqual(expect.arrayContaining(["480p", "720p", "1080p"]))
    expect(v2v.draft).toEqual({ valueType: "boolean", fixed: false, values: [true] })
  })

  it("a numeric strip lever is typed number; one with a custom range carries it", () => {
    expect(specs["generate-video"]!.duration!.valueType).toBe("number")
    expect(specs["generate-video"]!.duration!.fixed).toBe(false)
    const voice = specs["assemble-narrated-video"]!.voiceVolume!
    expect(voice).toMatchObject({ valueType: "number", fixed: true })
    expect(voice.values).toContain(100)
    expect(specs["generate-3d-scene"]!.durationSeconds).toMatchObject({ valueType: "number", min: expect.any(Number), max: expect.any(Number) })
  })

  it("a provider-aware list is the union across models", () => {
    expect(specs["generate-video"]!.resolution!.values).toEqual(expect.arrayContaining(["480p", "720p", "1080p"]))
    // Video Depth's colormaps differ per provider: the union of both.
    expect(specs["video-depth"]!.colormap!.fixed).toBe(false)
  })

  it("never lists a hand-declared field or an opted-out control", () => {
    expect(specs["generate-video"]!.provider).toBeUndefined()
    expect(specs["ai-avatar"]!.engine).toBeUndefined()
    expect(specs["generate-video"]!.repeatCount).toBeUndefined()
  })

  it("the backend's generated table is current", async () => {
    await expect(
      renderExposableQuickFieldsModule(specs),
      "backend/src/lib/mcp/generated/exposable-quick-fields.ts is stale — regenerate it: " +
        "cd frontend && npx vitest run src/components/presentation/__tests__/exposable-quick-fields-table.test.ts -u",
    ).toMatchFileSnapshot(
      "../../../../../backend/src/lib/mcp/generated/exposable-quick-fields.ts",
    )
  })
})
