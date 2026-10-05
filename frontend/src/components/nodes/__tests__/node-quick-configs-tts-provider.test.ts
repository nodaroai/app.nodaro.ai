/**
 * The Text to Speech quick-strip model pill writes the provider AND, when the
 * USER picks a model, clears the voice settings the new model does not honour and
 * resets a language it is not offered in — the same patch the config panel's
 * dropdown writes (`ttsModelSwitchPatch`, read from the model's capability sheet),
 * so the two surfaces cannot disagree. The fail-safe snap calls `write` without
 * the node's data and so writes the provider alone.
 *
 * `toStrictEqual` throughout: `toEqual` treats `{ speed: undefined }` as `{}`, and
 * the store removes a stored value only when the patch carries its key.
 */
import { describe, it, expect } from "vitest"
import { TTS_PROVIDERS, TTS_PROVIDER_ALIASES } from "@nodaro/shared"
import { getQuickConfigs, coerceQuickConfigValue } from "../node-quick-configs"

const control = getQuickConfigs("text-to-speech").find((c) => c.field === "provider")!
const optionValues = typeof control.options === "function" ? [] : control.options.map((o) => o.value)

const tuned = { provider: "elevenlabs-turbo", stability: 0.4, similarityBoost: 0.8, style: 0.3, speed: 1.15, languageCode: "he" }

describe("text-to-speech quick-strip model pill", () => {
  it("offers every provider but the legacy alias", () => {
    const expected = TTS_PROVIDERS.filter((id) => !(id in TTS_PROVIDER_ALIASES))
    expect([...optionValues].sort()).toEqual([...expected].sort())
  })

  it("a user's pick of v3 writes the provider and clears what v3 cannot use; Hebrew stays", () => {
    const patch = control.write!("elevenlabs-v3", tuned)
    expect(patch).toStrictEqual({ provider: "elevenlabs-v3", similarityBoost: undefined, style: undefined, speed: undefined })
    expect(Object.keys(patch).sort()).toEqual(["provider", "similarityBoost", "speed", "style"])
  })

  it("a user's pick of v4 clears style and speed and keeps similarity", () => {
    const patch = control.write!("elevenlabs-v4", tuned)
    expect(patch).toStrictEqual({ provider: "elevenlabs-v4", style: undefined, speed: undefined })
    expect(Object.keys(patch).sort()).toEqual(["provider", "speed", "style"])
  })

  it("a user's pick of turbo keeps every lever but resets a language turbo is not offered in", () => {
    expect(control.write!("elevenlabs-turbo", { ...tuned, provider: "elevenlabs-v3" })).toStrictEqual({ provider: "elevenlabs-turbo", languageCode: "" })
  })

  it("writes only the provider when the node already fits the model", () => {
    expect(control.write!("elevenlabs-turbo", { stability: 0.5, languageCode: "en" })).toStrictEqual({ provider: "elevenlabs-turbo" })
  })

  it("without the node's data (the fail-safe snap) writes the provider alone", () => {
    for (const id of optionValues) expect(control.write!(id), id).toStrictEqual({ provider: id })
  })

  it("never clears stability — every model honours it", () => {
    for (const id of optionValues) expect("stability" in control.write!(id, tuned)).toBe(false)
  })

  it("still reads the stored provider like any other dropdown", () => {
    expect(coerceQuickConfigValue(control, "elevenlabs-v3")).toBe("elevenlabs-v3")
  })
})
