/**
 * What an admin's content-filter setting does to a request
 * (lib/provider-safety.ts). With nothing set, a request must be untouched: the
 * same object, byte for byte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  guard: true,
  check: true,
  overrides: {} as Record<string, Record<string, boolean | number>>,
}))

vi.mock("../provider-safety-guard-probe.js", () => ({ contentGuardRegistered: vi.fn(async () => state.guard) }))
vi.mock("../result-check.js", () => ({ hasResultCheck: () => state.check }))
vi.mock("../app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ provider_safety_overrides: state.overrides })) }))

import { applyProviderSafety, isLoosenedRun, looseningAllowed, requestCarriesInputMedia, resolveLeverChange, useProviderSafetySettings } from "../provider-safety.js"
import { DISABLE_SAFETY_CHECKER_LEVER, ENABLE_SAFETY_CHECKER_LEVER, NSFW_CHECKER_LEVER, NSFW_CHECKER_SENT_FALSE_LEVER, type SafetyLever } from "../../providers/safety-levers.js"
import type { ProviderSafetyEntry } from "../../providers/kie/models.js"
import { providerSafetyEntriesForJob, providerSafetyGroups } from "../../providers/safety-entries.js"

const scale: SafetyLever = { kind: "scale", param: "safety_tolerance", min: 1, max: 6, strictest: 1, shipped: 5, providerDefault: 2 }
const nsfw: ProviderSafetyEntry = { modelId: "seedance-2", wireModel: "bytedance/seedance-2", levers: [NSFW_CHECKER_SENT_FALSE_LEVER] }
const checker: ProviderSafetyEntry = { modelId: "qwen", wireModel: "qwen/text-to-image", levers: [ENABLE_SAFETY_CHECKER_LEVER] }
const klein: ProviderSafetyEntry = { modelId: "flux-2-klein", wireModel: "black-forest-labs/flux-2-klein-9b", levers: [DISABLE_SAFETY_CHECKER_LEVER] }
const fill: ProviderSafetyEntry = { modelId: "flux-fill", wireModel: "black-forest-labs/flux-fill-pro", levers: [{ ...scale, neverLoosen: true }] }

beforeEach(() => {
  useProviderSafetySettings()
  state.guard = true
  state.check = true
  state.overrides = {}
})

describe("resolveLeverChange", () => {
  const base = { hasInputMedia: false, looseningAllowed: true }
  it("nothing saved keeps today's request", () => {
    expect(resolveLeverChange({ lever: scale, value: undefined, ...base })).toBeNull()
  })
  it("a value equal to today's keeps today's request", () => {
    expect(resolveLeverChange({ lever: scale, value: 5, ...base })).toBeNull()
  })
  it("a value not on the scale is ignored", () => {
    expect(resolveLeverChange({ lever: scale, value: 9, ...base })).toBeNull()
  })
  it("stricter always applies, with an image and with no guard", () => {
    expect(resolveLeverChange({ lever: scale, value: 2, hasInputMedia: true, looseningAllowed: false })).toEqual({ apply: 2 })
  })
  it("looser applies only with a guard, no input media, and a model that may loosen", () => {
    expect(resolveLeverChange({ lever: scale, value: 6, ...base })).toEqual({ apply: 6 })
    expect(resolveLeverChange({ lever: scale, value: 6, hasInputMedia: false, looseningAllowed: false })).toBeNull()
    expect(resolveLeverChange({ lever: scale, value: 6, hasInputMedia: true, looseningAllowed: true })).toBeNull()
    expect(resolveLeverChange({ lever: { ...scale, neverLoosen: true }, value: 6, ...base })).toBeNull()
  })
  it("a boolean filter: off is looser than on, and on is applied", () => {
    expect(resolveLeverChange({ lever: ENABLE_SAFETY_CHECKER_LEVER, value: false, ...base })).toEqual({ apply: false })
    expect(resolveLeverChange({ lever: ENABLE_SAFETY_CHECKER_LEVER, value: false, hasInputMedia: false, looseningAllowed: false })).toBeNull()
    expect(resolveLeverChange({ lever: NSFW_CHECKER_SENT_FALSE_LEVER, value: true, hasInputMedia: true, looseningAllowed: false })).toEqual({ apply: true })
  })
  it("an inverted switch: disable_safety_checker true is looser", () => {
    expect(resolveLeverChange({ lever: DISABLE_SAFETY_CHECKER_LEVER, value: true, ...base })).toEqual({ apply: true })
    expect(resolveLeverChange({ lever: DISABLE_SAFETY_CHECKER_LEVER, value: true, hasInputMedia: false, looseningAllowed: false })).toBeNull()
    expect(resolveLeverChange({ lever: DISABLE_SAFETY_CHECKER_LEVER, value: false, ...base })).toBeNull()
  })
  it("a lever with an unconfirmed spelling changes nothing", () => {
    expect(resolveLeverChange({ lever: { ...scale, wireUnconfirmed: true }, value: 2, ...base })).toBeNull()
  })
})

describe("requestCarriesInputMedia", () => {
  it("sees an image, a list of them, and a nested one", () => {
    expect(requestCarriesInputMedia({ image_url: "https://cdn.test/a.png" })).toBe(true)
    expect(requestCarriesInputMedia({ image_urls: ["https://cdn.test/a.png"] })).toBe(true)
    expect(requestCarriesInputMedia({ input: { first_frame_url: "https://cdn.test/a.png" } })).toBe(true)
    expect(requestCarriesInputMedia({ video: "data:video/mp4;base64,AAAA" })).toBe(true)
  })
  it("a callback address is not input media, and neither is text", () => {
    expect(requestCarriesInputMedia({ callBackUrl: "https://hooks.test/x", prompt: "a cat" })).toBe(false)
    expect(requestCarriesInputMedia({ webhook_url: "https://hooks.test/x" })).toBe(false)
    expect(requestCarriesInputMedia(undefined)).toBe(false)
  })
})

describe("applyProviderSafety", () => {
  it("with nothing saved the request is the very same object", async () => {
    const input = { prompt: "a cat" }
    expect(await applyProviderSafety(nsfw, input)).toBe(input)
    expect(await applyProviderSafety(checker, input)).toBe(input)
    expect(await applyProviderSafety(null, input)).toBe(input)
  })

  it("forces a filter on even when the request carried the other value", async () => {
    state.overrides = { "seedance-2": { nsfw_checker: true } }
    expect(await applyProviderSafety(nsfw, { prompt: "a cat", nsfw_checker: false })).toEqual({ prompt: "a cat", nsfw_checker: true })
  })

  it("two settings on one model are both applied", async () => {
    const both: ProviderSafetyEntry = { modelId: "qwen", wireModel: "qwen/text-to-image", levers: [NSFW_CHECKER_LEVER, ENABLE_SAFETY_CHECKER_LEVER] }
    state.overrides = { qwen: { nsfw_checker: true, enable_safety_checker: false } }
    expect(await applyProviderSafety(both, { prompt: "a cat" })).toEqual({ prompt: "a cat", nsfw_checker: true, enable_safety_checker: false })
  })

  it("a saved value of today's leaves the request alone", async () => {
    state.overrides = { "seedance-2": { nsfw_checker: false } }
    const input = { prompt: "a cat", nsfw_checker: false }
    expect(await applyProviderSafety(nsfw, input)).toBe(input)
  })

  it("loosens only with a guard and no input media", async () => {
    state.overrides = { qwen: { enable_safety_checker: false } }
    expect(await applyProviderSafety(checker, { prompt: "a cat" })).toEqual({ prompt: "a cat", enable_safety_checker: false })
    const withImage = { prompt: "a cat", image_url: "https://cdn.test/a.png" }
    expect(await applyProviderSafety(checker, withImage)).toBe(withImage)
    state.guard = false
    const plain = { prompt: "a cat" }
    expect(await applyProviderSafety(checker, plain)).toBe(plain)
  })

  it("a guard alone still refuses: nothing yet looks at what a model made", async () => {
    state.check = false
    state.overrides = { qwen: { enable_safety_checker: false } }
    const plain = { prompt: "a cat" }
    expect(await looseningAllowed()).toBe(false)
    expect(await applyProviderSafety(checker, plain)).toBe(plain)
  })

  it("a result check alone still refuses", async () => {
    state.guard = false
    state.overrides = { qwen: { enable_safety_checker: false } }
    const plain = { prompt: "a cat" }
    expect(await looseningAllowed()).toBe(false)
    expect(await applyProviderSafety(checker, plain)).toBe(plain)
  })

  it("a guard plus a registered result check allows", async () => {
    state.overrides = { qwen: { enable_safety_checker: false } }
    expect(await looseningAllowed()).toBe(true)
    expect(await applyProviderSafety(checker, { prompt: "a cat" })).toEqual({ prompt: "a cat", enable_safety_checker: false })
  })

  it("forcing a filter on needs neither", async () => {
    state.guard = false
    state.check = false
    state.overrides = { "seedance-2": { nsfw_checker: true } }
    expect(await applyProviderSafety(nsfw, { prompt: "a cat", nsfw_checker: false })).toEqual({ prompt: "a cat", nsfw_checker: true })
  })

  it("a model that is never loosened keeps today's value, however the setting reads", async () => {
    state.overrides = { "flux-fill": { safety_tolerance: 6 } }
    const input = { prompt: "x", safety_tolerance: 5 }
    expect(await applyProviderSafety(fill, input)).toBe(input)
    state.overrides = { "flux-fill": { safety_tolerance: 2 } }
    expect(await applyProviderSafety(fill, input)).toEqual({ prompt: "x", safety_tolerance: 2 })
  })

  it("a settings read that fails keeps today's request", async () => {
    const { getAppSettings } = await import("../app-settings.js")
    vi.mocked(getAppSettings).mockRejectedValueOnce(new Error("db down"))
    const input = { prompt: "a cat" }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await applyProviderSafety(nsfw, input)).toBe(input)
    warn.mockRestore()
  })
})

describe("isLoosenedRun", () => {
  it("is false when nothing is set, and for a stricter setting", async () => {
    expect(await isLoosenedRun([checker])).toBe(false)
    state.overrides = { "seedance-2": { nsfw_checker: true } }
    expect(await isLoosenedRun([nsfw])).toBe(false)
  })

  it("is true for a model whose saved setting is looser", async () => {
    state.overrides = { qwen: { enable_safety_checker: false } }
    expect(await isLoosenedRun([checker])).toBe(true)
  })

  it("a saved setting counts with no guard too: privacy errs on the safe side", async () => {
    state.overrides = { qwen: { enable_safety_checker: false } }
    state.guard = false
    expect(await isLoosenedRun([checker])).toBe(true)
  })

  it("a model that is never loosened is not a loosened run", async () => {
    state.overrides = { "flux-fill": { safety_tolerance: 6 } }
    expect(await isLoosenedRun([fill])).toBe(false)
  })

  it("no entries means false, without reading anything", async () => {
    const { getAppSettings } = await import("../app-settings.js")
    vi.mocked(getAppSettings).mockClear()
    expect(await isLoosenedRun([])).toBe(false)
    expect(getAppSettings).not.toHaveBeenCalled()
  })
})

describe("which models a job answers for", () => {
  const looser = providerSafetyGroups()
    .flatMap((g) => g.entries)
    .find((e) => e.levers.some((l) => l.param === "enable_safety_checker" && !l.neverLoosen && !l.wireUnconfirmed))!
  const loosened = () => {
    state.overrides = { [looser.modelId]: { enable_safety_checker: false } }
  }

  it("a job on a core lane answers for the model it names", async () => {
    loosened()
    expect(await isLoosenedRun(providerSafetyEntriesForJob(looser.modelId, { pluginServed: false }))).toBe(true)
    expect(await isLoosenedRun(providerSafetyEntriesForJob("another-model", { pluginServed: false }))).toBe(false)
    expect(await isLoosenedRun(providerSafetyEntriesForJob(null, { pluginServed: false }))).toBe(false)
  })

  it("a plugin-served job answers for every model with a setting: its handler picks them as it goes", async () => {
    expect(await isLoosenedRun(providerSafetyEntriesForJob(null, { pluginServed: true }))).toBe(false)
    loosened()
    expect(await isLoosenedRun(providerSafetyEntriesForJob(null, { pluginServed: true }))).toBe(true)
    expect(await isLoosenedRun(providerSafetyEntriesForJob("another-model", { pluginServed: true }))).toBe(true)
  })

  it("a stricter setting leaves a plugin-served job as it was", async () => {
    state.overrides = { [looser.modelId]: { enable_safety_checker: true } }
    expect(await isLoosenedRun(providerSafetyEntriesForJob(null, { pluginServed: true }))).toBe(false)
  })
})
