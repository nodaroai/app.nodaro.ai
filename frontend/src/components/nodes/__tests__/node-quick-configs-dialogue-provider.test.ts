/**
 * The Text to Dialogue quick-strip model pill writes the provider AND, when the
 * USER picks a model, the same patch the config panel's dropdown writes
 * (`dialogueModelSwitchPatch`). The fail-safe snap calls `write` without data and
 * writes the provider alone; an unset node shows v3 dialogue without a write.
 */
import { describe, it, expect } from "vitest"
import { DIALOGUE_PROVIDERS, DEFAULT_DIALOGUE_PROVIDER } from "@nodaro/shared"
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
})
