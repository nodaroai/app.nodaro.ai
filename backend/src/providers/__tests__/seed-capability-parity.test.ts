/**
 * Seed capability: MODEL_CATALOG `noSeed` × KIE `omitSeed`.
 *
 * Two declarations answer "does a seed on this model do anything":
 *  - the KIE model config's `omitSeed` (backend) — the request builder never
 *    sends a seed, because the provider's schema has none and KIE refuses one;
 *  - the catalog's `noSeed` (`@nodaro/shared`) — what the editor reads to hide
 *    its Seed field, since the frontend cannot see the KIE config.
 *
 * They must agree in both directions. A KIE config that drops the seed while
 * the catalog says nothing leaves a Seed field in the editor that does
 * nothing; a catalog flag with no KIE `omitSeed` behind it hides a field that
 * still works.
 */

import { describe, it, expect, vi } from "vitest"

// credits.ts (transitively imported by kie/models.ts) loads supabase + config
// at module scope. Mock both to keep this hermetic.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/billing/stripe-config.js", () => ({
  FREE_TIER_RESTRICTIONS: { blockedModels: [], dailyCreditCap: 10 },
  TIER_STORAGE_LIMITS: {},
}))

import {
  KIE_VIDEO_MODELS,
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS,
  type KieModelConfig,
} from "../kie/models.js"
import { MODEL_CATALOG, VIDEO_MODE_ALIASES } from "@nodaro/shared"

const KIE_VIDEO_TABLES: ReadonlyArray<[string, Record<string, KieModelConfig>]> = [
  ["KIE_VIDEO_MODELS", KIE_VIDEO_MODELS],
  ["KIE_TEXT_TO_VIDEO_MODELS", KIE_TEXT_TO_VIDEO_MODELS],
  ["KIE_VIDEO_TO_VIDEO_MODELS", KIE_VIDEO_TO_VIDEO_MODELS],
]

/** The catalog ids a KIE key serves: itself, and — for a mode-alias twin —
 *  every id of its alias group that has a catalog entry. */
function catalogIdsFor(kieKey: string): string[] {
  const group = VIDEO_MODE_ALIASES.find((g) => kieKey === g.base || kieKey === g.i2v || kieKey === g.t2v)
  const ids = group ? [group.base, group.i2v, group.t2v, kieKey] : [kieKey]
  return [...new Set(ids)].filter((id) => MODEL_CATALOG[id] !== undefined)
}

const omitSeedKeys = KIE_VIDEO_TABLES.flatMap(([table, models]) =>
  Object.entries(models)
    .filter(([, cfg]) => cfg.omitSeed === true)
    .map(([key]) => ({ table, key })),
)

describe("seed capability — catalog noSeed agrees with KIE omitSeed", () => {
  it("has at least the known no-seed models (guards a vacuous pass)", () => {
    const keys = omitSeedKeys.map((k) => k.key)
    expect(keys).toContain("seedance-2-5")
    expect(keys).toContain("happyhorse")
  })

  it.each(omitSeedKeys)("$table[$key] drops the seed → its catalog entry says noSeed", ({ key }) => {
    const ids = catalogIdsFor(key)
    expect(ids.length, `${key} has no catalog entry`).toBeGreaterThan(0)
    for (const id of ids) {
      expect(MODEL_CATALOG[id].noSeed, `MODEL_CATALOG["${id}"].noSeed`).toBe(true)
    }
  })

  const flagged = Object.values(MODEL_CATALOG).filter((m) => m.noSeed === true)

  it.each(flagged.map((m) => ({ id: m.id })))("MODEL_CATALOG[$id].noSeed is backed by a KIE omitSeed", ({ id }) => {
    const backing = omitSeedKeys.filter(({ key }) => catalogIdsFor(key).includes(id))
    expect(backing.length, `${id} says noSeed but no KIE config omits the seed`).toBeGreaterThan(0)
  })
})
