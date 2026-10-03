import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS } from "@nodaro/prompts"
import { PRESET_CONTENT_MAPS } from "../labels"

const TIMEOUT = 20_000

/**
 * Each locale's preset copy (preset-content.<locale>.ts) is keyed by preset id.
 * A typo in a key is invisible at runtime — the entry simply never matches
 * and the preset silently renders its English name — and TypeScript can't
 * catch it either, because the map is a plain `Record<string, …>`. These tests
 * are that guard, for every locale registered in PRESET_CONTENT_MAPS.
 */
describe("preset copy", () => {
  const catalogIds = new Set(
    Object.values(FACTORY_PRESETS).flatMap((list) => list.map((p) => p.id)),
  )
  const locales = Object.entries(PRESET_CONTENT_MAPS)

  it(
    "every translated id exists in the factory catalog",
    () => {
      const orphans = locales.flatMap(([locale, copy]) =>
        Object.keys(copy ?? {}).filter((id) => !catalogIds.has(id)).map((id) => `${locale}: ${id}`),
      )
      expect(orphans, `translated ids not in the catalog: ${orphans.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )

  it(
    "covers every preset in the catalog",
    () => {
      const missing = locales.flatMap(([locale, copy]) =>
        [...catalogIds].filter((id) => !copy?.[id]).map((id) => `${locale}: ${id}`),
      )
      expect(missing, `presets with no copy: ${missing.join(", ")}`).toEqual([])
    },
    TIMEOUT,
  )

  it(
    "never ships an empty name",
    () => {
      for (const [locale, copy] of locales) {
        for (const [id, entry] of Object.entries(copy ?? {})) {
          expect(entry.name.trim(), `${locale}: ${id} has an empty name`).not.toBe("")
        }
      }
    },
    TIMEOUT,
  )
})
