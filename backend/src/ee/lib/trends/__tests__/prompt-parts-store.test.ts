/**
 * A trend's overrides of the Cast Swap engine's prompt parts
 * (`TrendVersionData.promptParts`). What must hold:
 *
 *  - the stored shape is strict: a known part id only, its text 1–2000, the
 *    default's hash 16 hex;
 *  - a run sends the texts only, and a trend with none sends no key (its body
 *    is exactly what it was before overrides existed);
 *  - an engine that does not take them gets the body without them;
 *  - publishing needs an engine that takes them, in every environment;
 *  - what the engine is asked: the trend's shape, each placeholder picture its
 *    own address (the engine numbers a repeated address once), the most
 *    pictures a slot takes;
 *  - the server-owned draft fields come from the stored draft, never the body.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import type { EngineEnvironment } from "../../engine-environments.js"
import { composeTrendRun } from "../compose.js"
import { publishBlockers } from "../publish-check.js"
import { trendVersionDataSchema } from "../schemas.js"
import { placeholderImageUrl, promptPartsRequestFor, promptPartTexts, storedOverridesFrom } from "../prompt-parts-store.js"
import { withServerOwnedFields } from "../server-owned.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { PromptPartsAnswer } from "../../../../lib/cast-swap-prompt-parts-contract.js"
import type { TrendVersionData } from "../types.js"

const HASH = "0123456789abcdef"
const FACE = { text: "Keep each face exactly as in {image}'s picture.", defaultHash: HASH }

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: "https://cdn.example/src.mp4",
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [
      { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman", defaults: { outfit: "original" } },
      { key: "dog", kind: "pet", label: { en: "Dog" }, required: false, roleName: "the dog" },
    ],
    references: [{ images: ["https://cdn.example/glass.png"], line: "the glass {image}" }],
    prePrompt: "Night club.",
    trendPrompt: "Dance hard.",
    examples: [],
    ...over,
  }
}

const ALL = {
  roleKinds: ["person", "pet"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  trendPrePrompt: true,
}
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-10-27T00:00:00Z",
})
const REQUIRED = ["staging", "production"]
const run = (d: TrendVersionData) =>
  composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })

afterEach(() => _resetPluginSupportsForTests())

describe("the stored overrides", () => {
  it("take a known part id with its text and the default's hash", () => {
    expect(trendVersionDataSchema.safeParse(data({ promptParts: { face: FACE, avoid: { text: "-", defaultHash: HASH } } })).success).toBe(true)
  })

  it("refuse an unknown part, an empty or over-long text, and a hash that is not 16 hex", () => {
    for (const promptParts of [
      { faces: FACE },
      { face: { ...FACE, text: "" } },
      { face: { ...FACE, text: "x".repeat(2001) } },
      { face: { ...FACE, defaultHash: "abc" } },
      { face: { ...FACE, extra: 1 } },
    ]) {
      expect(trendVersionDataSchema.safeParse(data({ promptParts: promptParts as never })).success, JSON.stringify(promptParts)).toBe(false)
    }
  })

  it("are stored with the hash of the default the engine answered, never another", () => {
    const answer = { parts: [{ id: "face", defaultHash: "fedcba9876543210" }, { id: "opener", defaultHash: HASH }] } as unknown as PromptPartsAnswer
    expect(storedOverridesFrom({ face: "x {image}" }, answer)).toEqual({ face: { text: "x {image}", defaultHash: "fedcba9876543210" } })
    // A part the engine did not answer for: outside the contract.
    expect(storedOverridesFrom({ person: "y {image}" }, answer)).toBeNull()
  })
})

describe("a run", () => {
  it("sends the texts only", () => {
    const body = run(data({ promptParts: { face: FACE, avoid: { text: "-", defaultHash: HASH } } })).body
    expect(body.promptParts).toEqual({ face: FACE.text, avoid: "-" })
    expect(promptPartTexts(undefined)).toBeUndefined()
    expect(promptPartTexts({})).toBeUndefined()
  })

  it("of a trend with no overrides sends no key at all", () => {
    expect(run(data()).body).not.toHaveProperty("promptParts")
    expect(run(data({ promptParts: {} })).body).not.toHaveProperty("promptParts")
  })

  it("is sent without them to an engine that does not take them, and with them to one that does", () => {
    setPluginSupports({ castSwap: { ...ALL, promptParts: true } as never })
    const kept = run(data({ promptParts: { face: FACE } }))
    withoutUnsupportedFields(kept)
    expect(kept.body.promptParts).toEqual({ face: FACE.text })

    setPluginSupports({ castSwap: ALL as never })
    const dropped = run(data({ promptParts: { face: FACE } }))
    withoutUnsupportedFields(dropped)
    expect(dropped.body).not.toHaveProperty("promptParts")
  })
})

describe("publishing", () => {
  it("needs an engine that takes the overrides, in each environment", () => {
    const d = data({ promptParts: { face: FACE } })
    const blockers = publishBlockers(d, [env("staging", { ...ALL, promptParts: true }), env("production", ALL)], REQUIRED)
    expect(blockers.filter((b) => b.code === "prompt_parts_unsupported")).toEqual([
      expect.objectContaining({ code: "prompt_parts_unsupported", env: "production", need: "promptParts" }),
    ])
    expect(publishBlockers(d, [env("staging", { ...ALL, promptParts: true }), env("production", { ...ALL, promptParts: true })], REQUIRED)).toEqual([])
  })

  it("of a trend with no overrides never needs it", () => {
    expect(publishBlockers(data(), [env("staging", ALL), env("production", ALL)], REQUIRED)).toEqual([])
  })
})

describe("what the engine is asked", () => {
  it("is the trend's shape: its engine, its clip preparation, its roles with the most pictures a slot takes, each its own address", () => {
    const req = promptPartsRequestFor(data({ engine: "kling-4", promptParts: { face: FACE } }))
    expect(req).toEqual({
      engine: "kling-4",
      source: "faces",
      promptStyle: "precise",
      hasAudio: true,
      roles: [
        { kind: "person", name: "the woman", images: [1, 2, 3].map((j) => placeholderImageUrl(1, j)), body: "new", outfit: "original", hair: "new" },
        { kind: "pet", name: "the dog", images: [1, 2, 3].map((j) => placeholderImageUrl(2, j)), body: "new", coat: "new" },
      ],
      references: [{ images: ["https://cdn.example/glass.png"], line: "the glass {image}" }],
      prePrompt: "Night club.",
      postPrompt: "Dance hard.",
      overrides: { face: FACE.text },
    })
    const urls = req.roles.flatMap((r) => (r as { images: string[] }).images)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it("names a depth mode, and the overrides being checked instead of the stored ones", () => {
    const req = promptPartsRequestFor(data({ faceMasking: { mode: "always", source: "full-depth" }, promptParts: { face: FACE } }), { avoid: "-" })
    expect(req.source).toBe("full-depth")
    expect(req.overrides).toEqual({ avoid: "-" })
    expect(promptPartsRequestFor(data())).not.toHaveProperty("overrides")
  })
})

describe("the server-owned draft fields", () => {
  it("come from the stored draft: a body's are ignored, and one the stored draft lacks stays absent", () => {
    const stored = data({ promptParts: { face: FACE } })
    const merged = withServerOwnedFields({ ...data(), name: { en: "New" }, promptParts: { avoid: { text: "-", defaultHash: HASH } }, sourceCrop: { x: 1 } }, stored)
    expect(merged.name).toEqual({ en: "New" })
    expect(merged.promptParts).toEqual({ face: FACE })
    expect(merged).not.toHaveProperty("sourceCrop")
    expect(merged.examples).toEqual(stored.examples)
  })
})
