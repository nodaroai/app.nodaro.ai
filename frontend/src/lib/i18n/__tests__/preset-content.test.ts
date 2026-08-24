import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS } from "@nodaro/prompts"
import { PRESET_CONTENT_HE } from "../preset-content.he"

const TIMEOUT = 20_000

/**
 * The Hebrew preset copy is keyed by preset id. A typo in a key is invisible
 * at runtime — the entry simply never matches and the preset silently
 * renders its English name — and TypeScript can't catch it either, because
 * the map is a plain `Record<string, …>`. These tests are that guard.
 */
describe("PRESET_CONTENT_HE", () => {
  const catalogIds = new Set(
    Object.values(FACTORY_PRESETS).flatMap((list) => list.map((p) => p.id)),
  )

  it(
    "every translated id exists in the factory catalog",
    () => {
      const orphans = Object.keys(PRESET_CONTENT_HE).filter((id) => !catalogIds.has(id))
      expect(orphans, `translated ids not in the catalog: ${orphans.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )

  it(
    "covers every preset in the catalog",
    () => {
      const missing = [...catalogIds].filter((id) => !PRESET_CONTENT_HE[id])
      expect(missing, `presets with no Hebrew copy: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )

  it(
    "never ships an empty name",
    () => {
      for (const [id, copy] of Object.entries(PRESET_CONTENT_HE)) {
        expect(copy.name.trim(), `${id} has an empty name`).not.toBe("")
      }
    },
    TIMEOUT,
  )
})
