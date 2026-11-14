/**
 * The Text to Dialogue quick-strip model pill writes the provider AND, when the
 * USER picks a model, the same patch the config panel's dropdown writes
 * (`dialogueModelSwitchPatch`). The fail-safe snap calls `write` without data and
 * writes the provider alone; an unset node shows v3 dialogue without a write.
 */
import { describe, it, expect } from "vitest"
import { DIALOGUE_PROVIDERS, DEFAULT_DIALOGUE_PROVIDER } from "@nodaro/shared/models"
import { getQuickConfigs } from "../node-quick-configs"

const control = getQuickConfigs("text-to-dialogue").find((c) => c.field === "provider")!
const optionValues = typeof control.options === "function" ? [] : control.options.map((o) => o.value)

describe("text-to-dialogue quick-strip model pill", () => {
  it("offers every dialogue model, and shows v3 dialogue for an unset node", () => {
    expect([...optionValues].sort()).toEqual([...DIALOGUE_PROVIDERS].sort())
    expect(control.defaultValue).toBe(DEFAULT_DIALOGUE_PROVIDER)
  })

  it("a user's pick of v3 dialogue snaps the stability and clears similarity", () => {
    expect(control.write!("elevenlabs-dialogue", { provider: "elevenlabs-dialogue-v4", stability: 0.3, similarityBoost: 0.8 }))
      .toStrictEqual({ provider: "elevenlabs-dialogue", stability: 0.5, similarityBoost: undefined })
  })

  it("a user's pick of v4 dialogue writes the provider alone", () => {
    expect(control.write!("elevenlabs-dialogue-v4", { stability: 0.5 })).toStrictEqual({ provider: "elevenlabs-dialogue-v4" })
  })

  it("without the node's data (the fail-safe snap) writes the provider alone", () => {
    for (const id of optionValues) expect(control.write!(id), id).toStrictEqual({ provider: id })
  })

  it("keeps the language control beside it", () => {
    expect(getQuickConfigs("text-to-dialogue").map((c) => c.field)).toEqual(["provider", "languageCode"])
  })

  it("a user's pick of a Gemini model moves the lines' voices onto its own and resets the language (the panel's patch)", () => {
    const patch = control.write!("gemini-3-1-flash-tts", {
      provider: "elevenlabs-dialogue",
      languageCode: "en",
      dialogue: [{ id: "1", text: "Hi", voice: "Sarah" }, { id: "2", text: "Yo", voice: "Rachel" }],
    })
    expect(patch).toStrictEqual({
      provider: "gemini-3-1-flash-tts",
      languageCode: "",
      dialogue: [{ id: "1", text: "Hi", voice: "Kore", voiceLabel: "Kore" }, { id: "2", text: "Yo", voice: "Achernar", voiceLabel: "Achernar" }],
    })
  })

  it("the language control is offered only on a model offered in a language (none on Gemini)", () => {
    const language = getQuickConfigs("text-to-dialogue").find((c) => c.field === "languageCode")!
    const options = (data: Record<string, unknown>) => (typeof language.options === "function" ? language.options(data as never) : language.options)
    expect(options({ provider: "elevenlabs-dialogue" }).length).toBeGreaterThan(0)
    expect(options({}).length).toBeGreaterThan(0)
    expect(options({ provider: "gemini-3-8-flash-tts" })).toEqual([])
    expect(options({ provider: "gemini-2-5-pro-tts" })).toEqual([])
  })
})
