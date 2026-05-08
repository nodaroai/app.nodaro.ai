/**
 * Provider router tests.
 *
 * router.ts is the central dispatch hub for every model call — 10 typed
 * wrappers (generateImage, editImage, imageToVideo, …, textToSpeech) all
 * delegate to the generic `routeAndExecute` engine. If routing breaks, every
 * provider call breaks.
 *
 * These tests mock the registry + config layers and verify:
 *   - typed wrapper → correct capability + executor signature
 *   - chain walking + fallback when first provider doesn't support model
 *   - empty-chain and no-support error paths
 *   - markup application and field passthrough (kieTaskId, seed, etc.)
 *   - resolveModule extracts the right submodule (image/video/audio)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ProviderCapability } from "../provider.interface.js"
import type { ProviderUsed, RoutingDecision } from "../config.js"

// ---------------------------------------------------------------------------
// Mocks — must be hoisted, since vi.mock() runs before imports.
// ---------------------------------------------------------------------------

const { configMocks, registryMocks } = vi.hoisted(() => {
  const configMocks = {
    buildRoutingDecision: vi.fn<
      (cap: ProviderCapability, model: string) => Promise<RoutingDecision>
    >(),
    applyMarkup: vi.fn<(cost: number | null, markup: number) => number | null>(),
    resolveMarkup: vi.fn<
      (decision: RoutingDecision, providerUsed: ProviderUsed) => number
    >(),
  }
  const registryMocks = {
    supportsModel: vi.fn<
      (providerId: string, cap: ProviderCapability, model: string) => boolean
    >(),
    getProvider: vi.fn<(providerId: string) => unknown>(),
  }
  return { configMocks, registryMocks }
})

vi.mock("../config.js", () => ({
  buildRoutingDecision: configMocks.buildRoutingDecision,
  applyMarkup: configMocks.applyMarkup,
  resolveMarkup: configMocks.resolveMarkup,
}))

vi.mock("../registry.js", () => ({
  providerRegistry: {
    supportsModel: registryMocks.supportsModel,
    getProvider: registryMocks.getProvider,
  },
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks registered)
// ---------------------------------------------------------------------------

import {
  generateImage,
  editImage,
  imageToVideo,
  textToVideo,
  videoToVideo,
  motionTransfer,
  videoUpscale,
  lipSync,
  generateMusic,
  textToSpeech,
} from "../router.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decision(opts: {
  chain?: ProviderUsed[]
  markup?: number
  active?: ProviderUsed
}): RoutingDecision {
  return {
    providerChain: opts.chain ?? ["kie"],
    ***REDACTED-OSS-SCRUB***
    activeProvider: opts.active ?? "kie",
    // settings is part of RoutingDecision but only consulted by config helpers,
    // not by router.ts — empty object satisfies the structural type.
    settings: {} as RoutingDecision["settings"],
  }
}

/** Build a fake provider instance with image/video/audio submodules. The
 *  caller provides the implementations they care about. */
function makeProviderInstance(impls: {
  image?: Record<string, unknown>
  video?: Record<string, unknown>
  audio?: Record<string, unknown>
}): unknown {
  return impls
}

beforeEach(() => {
  configMocks.buildRoutingDecision.mockReset()
  configMocks.applyMarkup.mockReset()
  configMocks.resolveMarkup.mockReset()
  registryMocks.supportsModel.mockReset()
  registryMocks.getProvider.mockReset()

  // Default markup behavior — used by most tests.
  configMocks.applyMarkup.mockImplementation((cost, markup) =>
    cost === null ? null : cost * (1 + markup / 100),
  )
  configMocks.resolveMarkup.mockImplementation((d) => d.markupPercent)
})

// ===========================================================================
// 1) routeAndExecute core engine, exercised through generateImage
// ===========================================================================

describe("routeAndExecute (via generateImage)", () => {
  it("dispatches to the first provider in the chain that supports the model", async () => {
    const generate = vi.fn().mockResolvedValue({
      url: "https://r2/img.png",
      cost: 0.02,
    })
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(
      makeProviderInstance({ image: { generateImage: generate } }),
    )

    const result = await generateImage("a dog", "nano-banana")

    expect(result.url).toBe("https://r2/img.png")
    expect(result.cost).toBe(0.02)
    expect(result.providerUsed).toBe("kie")
    expect(generate).toHaveBeenCalledWith("a dog", undefined, "nano-banana", undefined)
  })

  it("walks past providers that don't support the model and uses the next one", async () => {
    const replicateGen = vi.fn().mockResolvedValue({
      url: "https://r2/replicate.png",
      cost: 0.05,
    })
    configMocks.buildRoutingDecision.mockResolvedValue(
      decision({ chain: ["kie", "replicate"] }),
    )
    // kie does NOT support, replicate DOES.
    registryMocks.supportsModel
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => true)
    registryMocks.getProvider.mockImplementation((id) => {
      if (id === "replicate") {
        return makeProviderInstance({ image: { generateImage: replicateGen } })
      }
      return null
    })

    const result = await generateImage("a dog", "runway-only-model")

    expect(result.providerUsed).toBe("replicate")
    expect(replicateGen).toHaveBeenCalledOnce()
  })

  it("throws when the routing decision returns an empty chain", async () => {
    configMocks.buildRoutingDecision.mockResolvedValue(
      decision({ chain: [], active: "kie" }),
    )

    await expect(generateImage("a dog", "anything")).rejects.toThrow(
      /No provider available for image-generation/,
    )
  })

  it("throws when no provider in the chain supports the model", async () => {
    configMocks.buildRoutingDecision.mockResolvedValue(
      decision({ chain: ["kie", "replicate"] }),
    )
    registryMocks.supportsModel.mockReturnValue(false)

    await expect(generateImage("a dog", "unknown-model")).rejects.toThrow(
      /Model "unknown-model" is not supported for image-generation by any registered provider/,
    )
  })

  it("applies markup using resolveMarkup and applyMarkup", async () => {
    const generate = vi.fn().mockResolvedValue({ url: "u", cost: 1 })
    ***REDACTED-OSS-SCRUB***
    configMocks.resolveMarkup.mockReturnValue(40) // override
    configMocks.applyMarkup.mockImplementation((cost) => (cost === null ? null : cost * 2))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(
      makeProviderInstance({ image: { generateImage: generate } }),
    )

    const result = await generateImage("p", "m")

    expect(configMocks.resolveMarkup).toHaveBeenCalledWith(
      ***REDACTED-OSS-SCRUB***
      "kie",
    )
    expect(configMocks.applyMarkup).toHaveBeenCalledWith(1, 40)
    expect(result.displayCost).toBe(2)
    expect(result.cost).toBe(1)
  })

  it("preserves null cost through markup", async () => {
    const generate = vi.fn().mockResolvedValue({ url: "u", cost: null })
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(
      makeProviderInstance({ image: { generateImage: generate } }),
    )

    const result = await generateImage("p", "m")

    expect(result.cost).toBeNull()
    expect(result.displayCost).toBeNull()
  })

  it("propagates passthrough fields: kieTaskId, seed, fallbackFlag, providerMs", async () => {
    const generate = vi.fn().mockResolvedValue({
      url: "u",
      cost: 0.5,
      kieTaskId: "task-abc",
      seed: 12345,
      fallbackFlag: true,
      providerMs: 4321,
    })
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(
      makeProviderInstance({ image: { generateImage: generate } }),
    )

    const result = await generateImage("p", "m")

    expect(result.kieTaskId).toBe("task-abc")
    expect(result.seed).toBe(12345)
    expect(result.fallbackFlag).toBe(true)
    expect(result.providerMs).toBe(4321)
  })

  it("throws when the resolved provider instance is missing the requested submodule", async () => {
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    // No `image` submodule → resolveModule throws.
    registryMocks.getProvider.mockReturnValue(makeProviderInstance({ video: {} }))

    await expect(generateImage("p", "m")).rejects.toThrow(
      /does not have a "image" module/,
    )
  })

  it("propagates errors from the executor (not silenced by router)", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("KIE 502"))
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(
      makeProviderInstance({ image: { generateImage: generate } }),
    )

    await expect(generateImage("p", "m")).rejects.toThrow(/KIE 502/)
  })

  it("does NOT fall back to next provider on executor error (only on unsupported-model)", async () => {
    const kieGen = vi.fn().mockRejectedValue(new Error("KIE 502"))
    const replicateGen = vi.fn()
    configMocks.buildRoutingDecision.mockResolvedValue(
      decision({ chain: ["kie", "replicate"] }),
    )
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockImplementation((id) =>
      id === "kie"
        ? makeProviderInstance({ image: { generateImage: kieGen } })
        : makeProviderInstance({ image: { generateImage: replicateGen } }),
    )

    await expect(generateImage("p", "m")).rejects.toThrow(/KIE 502/)
    expect(replicateGen).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 2) Each typed wrapper hits the right capability & calls the right method
// ===========================================================================

describe("typed wrapper dispatch", () => {
  function setupSuccessfulCall(
    submodule: "image" | "video" | "audio",
    method: string,
    impl: (...args: unknown[]) => Promise<unknown>,
  ) {
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(
      makeProviderInstance({ [submodule]: { [method]: impl } }),
    )
  }

  it("editImage routes via image-editing capability + editImage method", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("image", "editImage", fn)

    await editImage("https://input.png", "nano-banana-edit", "make it red", { foo: 1 })

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith(
      "image-editing",
      "nano-banana-edit",
    )
    expect(fn).toHaveBeenCalledWith("https://input.png", "make it red", "nano-banana-edit", { foo: 1 })
  })

  it("imageToVideo routes via image-to-video capability + imageToVideo method", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("video", "imageToVideo", fn)

    await imageToVideo("img", "veo3", "prompt", 8, "endframe", { mode: "pro" })

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith("image-to-video", "veo3")
    expect(fn).toHaveBeenCalledWith("img", "prompt", "veo3", 8, "endframe", { mode: "pro" })
  })

  it("textToVideo routes via text-to-video capability + textToVideo method", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("video", "textToVideo", fn)

    await textToVideo("a duck", "kling", 10, "16:9", { sound: true })

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith("text-to-video", "kling")
    expect(fn).toHaveBeenCalledWith("a duck", "kling", 10, "16:9", { sound: true })
  })

  it("videoToVideo routes via video-to-video capability", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("video", "videoToVideo", fn)

    await videoToVideo("vid", "wan", "p", { aspectRatio: "16:9" })

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith("video-to-video", "wan")
    expect(fn).toHaveBeenCalledWith("vid", "p", "wan", { aspectRatio: "16:9" })
  })

  it("motionTransfer routes via motion-transfer capability", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("video", "motionTransfer", fn)

    await motionTransfer("img", "vid", "kling", "p", { resolution: "720p" })

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith("motion-transfer", "kling")
    expect(fn).toHaveBeenCalledWith("img", "vid", "p", { resolution: "720p" })
  })

  it("videoUpscale routes via video-upscale capability", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("video", "videoUpscale", fn)

    await videoUpscale("vid", "topaz", "2", { mode: "fast" })

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith("video-upscale", "topaz")
    expect(fn).toHaveBeenCalledWith("vid", "2", { mode: "fast" })
  })

  it("lipSync routes via lip-sync capability", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("video", "lipSync", fn)

    await lipSync("img", "audio", "kling-avatar", "motion-prompt", "720p")

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith("lip-sync", "kling-avatar")
    expect(fn).toHaveBeenCalledWith("img", "audio", "motion-prompt", "kling-avatar", "720p")
  })

  it("generateMusic routes via music-generation capability + audio submodule", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("audio", "generateMusic", fn)

    await generateMusic("rock anthem", "suno-v5", 60, "lyrics here")

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith("music-generation", "suno-v5")
    expect(fn).toHaveBeenCalledWith("rock anthem", "suno-v5", 60, "lyrics here")
  })

  it("textToSpeech routes via text-to-speech capability + audio submodule", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    setupSuccessfulCall("audio", "textToSpeech", fn)

    await textToSpeech("hello world", "elevenlabs-turbo", "voice-id-1", { speed: 1 })

    expect(configMocks.buildRoutingDecision).toHaveBeenCalledWith(
      "text-to-speech",
      "elevenlabs-turbo",
    )
    expect(fn).toHaveBeenCalledWith("hello world", "voice-id-1", "elevenlabs-turbo", { speed: 1 })
  })
})

// ===========================================================================
// 3) resolveModule submodule routing — image vs video vs audio
// ===========================================================================

describe("resolveModule submodule selection", () => {
  it("image capability requires image submodule", async () => {
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    // Provider has video + audio but NOT image — should fail for image op
    registryMocks.getProvider.mockReturnValue(makeProviderInstance({ video: {}, audio: {} }))

    await expect(generateImage("p", "m")).rejects.toThrow(/does not have a "image" module/)
  })

  it("video capability requires video submodule", async () => {
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(makeProviderInstance({ image: {} }))

    await expect(textToVideo("p", "m")).rejects.toThrow(/does not have a "video" module/)
  })

  it("audio capability requires audio submodule", async () => {
    configMocks.buildRoutingDecision.mockResolvedValue(decision({ chain: ["kie"] }))
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockReturnValue(makeProviderInstance({ video: {} }))

    await expect(textToSpeech("hi", "m")).rejects.toThrow(/does not have a "audio" module/)
  })
})

// ===========================================================================
// 4) Chain semantics: walks ALL providers in order
// ===========================================================================

describe("chain order is preserved", () => {
  it("uses the first provider in the chain when both support the model", async () => {
    const kieGen = vi.fn().mockResolvedValue({ url: "kie-result", cost: 0.01 })
    const replicateGen = vi.fn().mockResolvedValue({ url: "replicate-result", cost: 0.02 })
    configMocks.buildRoutingDecision.mockResolvedValue(
      decision({ chain: ["kie", "replicate"] }),
    )
    registryMocks.supportsModel.mockReturnValue(true)
    registryMocks.getProvider.mockImplementation((id) =>
      id === "kie"
        ? makeProviderInstance({ image: { generateImage: kieGen } })
        : makeProviderInstance({ image: { generateImage: replicateGen } }),
    )

    const result = await generateImage("p", "m")

    expect(result.url).toBe("kie-result")
    expect(result.providerUsed).toBe("kie")
    expect(replicateGen).not.toHaveBeenCalled()
  })

  it("supportsModel called once per provider until match (no extra polling)", async () => {
    const replicateGen = vi.fn().mockResolvedValue({ url: "u", cost: 0 })
    configMocks.buildRoutingDecision.mockResolvedValue(
      decision({ chain: ["kie", "replicate"] }),
    )
    registryMocks.supportsModel.mockImplementation((id) => id === "replicate")
    registryMocks.getProvider.mockImplementation((id) =>
      id === "replicate"
        ? makeProviderInstance({ image: { generateImage: replicateGen } })
        : null,
    )

    await generateImage("p", "m")

    expect(registryMocks.supportsModel).toHaveBeenCalledTimes(2)
    expect(registryMocks.supportsModel).toHaveBeenNthCalledWith(1, "kie", "image-generation", "m")
    expect(registryMocks.supportsModel).toHaveBeenNthCalledWith(2, "replicate", "image-generation", "m")
  })
})
