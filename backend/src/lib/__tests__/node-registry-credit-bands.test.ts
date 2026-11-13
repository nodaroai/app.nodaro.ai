/**
 * `GET /v1/nodes` credit bands must be DERIVED, never hand-typed.
 *
 * Context: `NodeDescriptor.creditCost` is the discovery contract — served by
 * `GET /v1/nodes` and printed as "**Credit cost:**" at the top of every
 * generated `backend/skills/nodes/*.md`, which is what an MCP agent reads
 * before it decides whether a node is affordable. It is NOT what bills: the
 * route's `creditGuard` and the orchestrator's payload-builder resolve a
 * specific identifier and price it against `model_pricing` with
 * `STATIC_CREDIT_COSTS` as the fallback.
 *
 * That asymmetry is why a hand-typed band fails SILENTLY. Nothing throws, no
 * charge changes — the number is simply a lie. Every one of them was, until
 * this file existed: the 2026-07-30 ×10 credit re-denomination swept
 * `STATIC_CREDIT_COSTS`, `model_pricing`, `MODEL_CATALOG` and the
 * video-analysis table, and left ~20 literals in `node-registry.ts` at a tenth
 * of the real price (`generate-image "1-8"` against a 2..620 table,
 * `audio-separation "3-8"` against 30..80, `motion-transfer "8-68"` against
 * 80..1500), plus a handful of flat numbers in the same state.
 *
 * So the bands are now read off the price table at module load, from the id set
 * each node can actually reserve on (`CREDIT_BAND_SOURCES`). This test is the
 * gate that keeps them that way:
 *
 *  1. No node may carry a hand-typed `"min-max"` band — every string band's
 *     node type must be declared in `CREDIT_BAND_SOURCES` (the one documented
 *     exception is a render's `"per-minute"` — Apply EDL's and Speaker View's —
 *     which is not a band at all).
 *  2. Every declared band must EQUAL the derivation, recomputed here from the
 *     raw source data — so editing the rendered string by hand fails.
 *  3. Every id a source names must be really priced, and the band's ends must
 *     be real rows (times the rate span, where the row is a rate) — so a
 *     provider enum that gains a member with no price cannot widen a band to a
 *     number nobody charges, and cannot silently be skipped either.
 *  4. A node that keeps a hand-typed NUMBER must agree with the node-type row
 *     `getEnrichedRegistry()` would otherwise have supplied — the same
 *     staleness, one field narrower.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { USE_CASE_NODE_TYPES } from "@nodaro/shared/nodes"
import { NODE_REGISTRY, CREDIT_BAND_SOURCES } from "../node-registry.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { FIXED_ROW_CREDIT_IDS } from "../fixed-row-credit-ids.js"
import { NEMOTRON_TRANSCRIBE_PRICING, nemotronTranscribeBaseCredits } from "@nodaro/shared/credits"
import { buildPayload } from "../../services/workflow-engine/payload-builder.js"
import type { SimpleNode } from "../../services/workflow-engine/types.js"

/**
 * Credit-cost strings that are deliberately NOT a `min-max` band.
 *
 * The renders (`apply-edl`, `speaker-view`) are priced per minute of RENDERED
 * output, so there is no ceiling to state — the descriptor says so in words
 * instead of quoting a number the run would not honour. Add an entry here only
 * with the same kind of reason.
 */
const NON_BAND_CREDIT_STRINGS: Readonly<Record<string, string>> = {
  "apply-edl": "per-minute",
  // Priced per clip from the clip's own model and length at admission; there is no fixed band to state.
  "ugc-clip": "per-clip",
  "speaker-view": "per-minute",
  // Priced per started block of 1,000 sampled frames (P3.7): the count is the
  // run's own, so there is no fixed band to state.
  "speaker-frames": "per-1000-frames",
  // Every use-case node (the use-case branch of /v1/nodes): its steps bill as
  // their own jobs at their own rows (the transcribe, the plan, the render per
  // minute), plus a flat per-run fee.
  ...Object.fromEntries(USE_CASE_NODE_TYPES.map((type) => [type, "per-minute"])),
}

/** The static table as the lookup a source's `band` computer takes. */
const staticCredits = (id: string, units = 1): number | undefined => {
  const base = STATIC_CREDIT_COSTS[id]
  return typeof base === "number" ? Math.ceil(base * units) : undefined
}

/** Recompute a band from the source data, independently of the registry. */
function deriveBand(type: string): number | string {
  const source = CREDIT_BAND_SOURCES[type]!
  const computed = source.band?.(staticCredits)
  if (computed) return computed[0] === computed[1] ? computed[0] : `${computed[0]}-${computed[1]}`
  const [minUnits, maxUnits] = source.span ?? [1, 1]
  const prices = source.ids.map((id) => STATIC_CREDIT_COSTS[id]!)
  const min = Math.min(...prices) * minUnits
  const max = Math.max(...prices) * maxUnits
  return min === max ? min : `${min}-${max}`
}

const BANDED = NODE_REGISTRY.filter((d) => CREDIT_BAND_SOURCES[d.type] !== undefined)

describe("node-registry credit bands are derived from the price table", () => {
  it("covers every node that declares one (the sanity floor)", () => {
    // A test that silently checks nothing is worse than no test. The registry
    // prices roughly forty nodes off the table; if the export ever comes back
    // empty, fail here rather than pass vacuously below.
    expect(Object.keys(CREDIT_BAND_SOURCES).length).toBeGreaterThanOrEqual(35)
    expect(BANDED.length).toBe(Object.keys(CREDIT_BAND_SOURCES).length)
  })

  it("no string band is hand-typed — every one has a declared source", () => {
    const handTyped = NODE_REGISTRY.filter(
      (d) =>
        typeof d.creditCost === "string" &&
        CREDIT_BAND_SOURCES[d.type] === undefined &&
        NON_BAND_CREDIT_STRINGS[d.type] === undefined,
    ).map((d) => `${d.type} = "${d.creditCost}"`)
    expect(
      handTyped,
      "these nodes advertise a credit band that is not derived from STATIC_CREDIT_COSTS — " +
        "add the node's reservable id set to CREDIT_BAND_SOURCES in node-registry.ts and " +
        "declare `creditCost: creditBandFor(\"<type>\")` instead of a literal",
    ).toEqual([])
  })

  it("every non-band credit string is the documented one", () => {
    for (const [type, expected] of Object.entries(NON_BAND_CREDIT_STRINGS)) {
      const entry = NODE_REGISTRY.find((d) => d.type === type)
      expect(entry, `${type} is missing from NODE_REGISTRY`).toBeDefined()
      expect(entry!.creditCost).toBe(expected)
    }
  })

  it("every source names only identifiers the price table really prices", () => {
    const unpriced: string[] = []
    for (const [type, source] of Object.entries(CREDIT_BAND_SOURCES)) {
      expect(source.ids.length, `${type} declares an empty credit-band id set`).toBeGreaterThan(0)
      for (const id of source.ids) {
        if (typeof STATIC_CREDIT_COSTS[id] !== "number") unpriced.push(`${type} → ${id}`)
      }
    }
    // `creditBandFor` SKIPS an unpriced id rather than throwing (the discovery
    // registry must not be able to fail boot over a pricing gap), so this is
    // the assertion that stops the skip from hiding one: an id the node can
    // reserve on with no row is already a runtime 503 `price_not_configured`.
    expect(
      unpriced,
      "these credit-band identifiers have no STATIC_CREDIT_COSTS row, so they are skipped " +
        "when the band is computed — the advertised band excludes a price the node can really reserve",
    ).toEqual([])
  })

  it("every declared creditCost equals the derivation for its node", () => {
    const drifted: string[] = []
    for (const descriptor of BANDED) {
      const derived = deriveBand(descriptor.type)
      if (descriptor.creditCost !== derived) {
        drifted.push(`${descriptor.type}: declared ${JSON.stringify(descriptor.creditCost)}, derived ${JSON.stringify(derived)}`)
      }
    }
    expect(
      drifted,
      "a creditCost was edited by hand instead of being read from the price table — " +
        "reprice the row in STATIC_CREDIT_COSTS (and model_pricing), never the advertised band",
    ).toEqual([])
  })

  it("each band's ends are real prices from its own id set", () => {
    for (const descriptor of BANDED) {
      const source = CREDIT_BAND_SOURCES[descriptor.type]!
      // A `band` computer in force states its own ends (the flag-on describe
      // below pins them); with none in force the ids × span rule applies.
      if (source.band?.(staticCredits)) continue
      const [minUnits, maxUnits] = source.span ?? [1, 1]
      const prices = source.ids.map((id) => STATIC_CREDIT_COSTS[id]!)
      const cost = descriptor.creditCost!
      const [min, max] =
        typeof cost === "number"
          ? [cost, cost]
          : cost.split("-").map(Number)
      expect(
        prices.some((p) => p * minUnits === min),
        `${descriptor.type}: band floor ${min} is not ${minUnits}× any priced row in its id set`,
      ).toBe(true)
      expect(
        prices.some((p) => p * maxUnits === max),
        `${descriptor.type}: band ceiling ${max} is not ${maxUnits}× any priced row in its id set`,
      ).toBe(true)
      expect(min, `${descriptor.type}: band floor exceeds its ceiling`).toBeLessThanOrEqual(max)
    }
  })

  it("a hand-typed number still agrees with the node-type row enrichment would supply", () => {
    // The nodes NOT in CREDIT_BAND_SOURCES keep a literal. Where the price
    // table has a row under the node's own type, that row is what
    // `getEnrichedRegistry()` would have served had the literal been omitted —
    // so a literal that disagrees with it is the same silent staleness the
    // bands had (text-to-speech advertised 4 against a 30-credit row;
    // generative-pipeline 30 against 300).
    const drifted: string[] = []
    for (const descriptor of NODE_REGISTRY) {
      if (CREDIT_BAND_SOURCES[descriptor.type]) continue
      if (typeof descriptor.creditCost !== "number") continue
      const row = STATIC_CREDIT_COSTS[descriptor.type]
      if (row === undefined) continue // priced only in model_pricing, or free by construction
      if (row !== descriptor.creditCost) {
        drifted.push(`${descriptor.type}: declared ${descriptor.creditCost}, STATIC_CREDIT_COSTS["${descriptor.type}"] = ${row}`)
      }
    }
    expect(
      drifted,
      "these nodes advertise a credit cost their own price-table row contradicts — " +
        "drop the literal (enrichment fills it) or add the node to CREDIT_BAND_SOURCES",
    ).toEqual([])
  })

  it("a per-unit RATE row never widens a band: text-to-speech states the flat per-request rows, not its :per-100-chars / :per-1k-chars rows", () => {
    // `<model>:per-100-chars` (decided 2026-10-06) prices ONE started 100 characters
    // and is read only while SPEECH_LENGTH_PRICING_ENABLED is on; `familyIds` would
    // otherwise fold it in and advertise "2-30" for a run that is never below 16.
    // A `<model>:per-1k-chars` row (Gemini, decided 2026-11-12) is a rate too.
    const ids = CREDIT_BAND_SOURCES["text-to-speech"]!.ids
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.some((id) => id.endsWith(":per-100-chars") || id.endsWith(":per-1k-chars"))).toBe(false)
    expect(Object.keys(STATIC_CREDIT_COSTS).some((id) => id.endsWith(":per-100-chars"))).toBe(true)
    expect(NODE_REGISTRY.find((d) => d.type === "text-to-speech")!.creditCost).toBe(deriveBand("text-to-speech"))
    // Gemini 3.8 Flash-Lite's flat row (4, the price of 1,000 characters) up to v3 / v4's 30.
    expect(deriveBand("text-to-speech")).toBe("4-30")
    // The Gemini models voice two speakers too (decided 2026-11-12): from Flash-Lite's 4 up to ElevenLabs dialogue's 25.
    expect(deriveBand("text-to-dialogue")).toBe("4-25")
  })

  it("describe-to-picker advertises its whole ladder, premium-direct included", () => {
    // Repriced 2026-10-20 (migration 546): economy 10 (the Gemini 3.8 Flash
    // default) up to the stated premium-direct 136 — a premium model on the
    // vendor's own API (Opus 5.5 at its recipe effort high reserves it). The
    // node-type row the enrichment would supply on its own quotes only the
    // standard rung.
    expect(CREDIT_BAND_SOURCES["describe-to-picker"]?.ids).toContain("describe-to-picker:premium-direct")
    expect(NODE_REGISTRY.find((d) => d.type === "describe-to-picker")!.creditCost).toBe(deriveBand("describe-to-picker"))
    expect(deriveBand("describe-to-picker")).toBe("10-136")
  })
})

describe("with SPEECH_LENGTH_PRICING_ENABLED on, the speech bands state the length rule's own range", () => {
  // A boot-time flag: the registry is built at module load, so the module is
  // reloaded with the config mock on. `gen:skills` runs with the flag UNSET
  // (CI's env has none), so the generated skill docs keep the flag-off band.
  beforeEach(() => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", async (importOriginal) => {
      const orig = await importOriginal<typeof import("@/lib/config.js")>()
      return { ...orig, speechLengthPricingEnabled: () => true }
    })
  })
  afterEach(() => {
    vi.doUnmock("@/lib/config.js")
    vi.resetModules()
  })

  it("text-to-speech reads from the cheapest model's floor (Gemini 3.8 Flash-Lite) to turbo's cap; text-to-dialogue from the floor to the dialogue cap", async () => {
    const { NODE_REGISTRY: registry, CREDIT_BAND_SOURCES: sources } = await import("../node-registry.js")
    const { STATIC_CREDIT_COSTS: table } = await import("../../ee/billing/credits.js")
    const { getMaxTtsChars, getDialogueCapabilities, DIALOGUE_PROVIDERS } = await import("@nodaro/shared/models")
    const { speechPriceUnits, speechUnitCreditId, speechRowCredits, speechRowUnits, SPEECH_FLOOR_UNITS } = await import("@nodaro/shared/credits")
    const tts = registry.find((d) => d.type === "text-to-speech")!
    const dialogue = registry.find((d) => d.type === "text-to-dialogue")!
    // 8 units at Gemini 3.8 Flash-Lite's 4 per 1,000 (3.2 → 4) … 400 units × 2 (turbo at 40,000 characters)
    expect(tts.creditCost).toBe(`${Math.ceil((SPEECH_FLOOR_UNITS * table["gemini-3-8-flash-lite-tts:per-1k-chars"]!) / 10)}-${speechPriceUnits(getMaxTtsChars("elevenlabs-turbo")) * table["elevenlabs-turbo:per-100-chars"]!}`)
    expect(tts.creditCost).toBe("4-800")
    // Each dialogue model on its own row (per 100 characters, or per 1,000 on a Gemini model — the one-speaker row).
    const atCap = (id: string, units: number) => speechRowCredits(units, table[speechUnitCreditId(id)]!, speechRowUnits(id))
    const dialogueLow = Math.min(...DIALOGUE_PROVIDERS.map((id) => atCap(id, SPEECH_FLOOR_UNITS)))
    const dialogueHigh = Math.max(...DIALOGUE_PROVIDERS.map((id) => atCap(id, speechPriceUnits(getDialogueCapabilities(id).maxChars))))
    expect(dialogue.creditCost).toBe(`${dialogueLow}-${dialogueHigh}`)
    // 8 units at Gemini 3.8 Flash-Lite's 4 per 1,000 … 100 units × 4 at Dialogue v4's 10,000-character cap.
    expect(dialogue.creditCost).toBe("4-400")
    // The flag-on computer is what `deriveBand` would read too — the sources agree with the registry.
    const lookup = (id: string, units = 1) => (typeof table[id] === "number" ? Math.ceil(table[id]! * units) : undefined)
    expect(sources["text-to-speech"]!.band!(lookup)).toEqual([4, 800])
    expect(sources["text-to-dialogue"]!.band!(lookup)).toEqual([4, 400])
  })

  it("the charged descriptor (GET /v1/nodes) states the same range at the charged prices", async () => {
    const { NODE_REGISTRY: registry, chargedDescriptor } = await import("../node-registry.js")
    const { STATIC_CREDIT_COSTS: table } = await import("../../ee/billing/credits.js")
    const tts = registry.find((d) => d.type === "text-to-speech")!
    // A per-service margin of 10% on every row, the way the price table marks up.
    const prices = {
      credits: (id: string, units = 1) => (typeof table[id] === "number" ? Math.ceil((Math.ceil(table[id]! * units) * 110) / 100) : undefined),
      rate: () => undefined,
    }
    // Flash-Lite's floor charged: ceil(ceil(4 × 0.8) × 1.1) = 5.
    expect(chargedDescriptor(tts, prices).creditCost).toBe("5-880")
  })
})

/**
 * A single-row node advertises the row a run is charged — never its node-type
 * alias row. Forced Alignment's skill said 3 while a run was charged 30 (#1590,
 * stale since the re-denomination), and Remove Background's said 10 against a
 * charged 3, because both read `STATIC_CREDIT_COSTS[<node type>]`, a row
 * nothing charges. The id is named once (`fixed-row-credit-ids.ts`); this
 * proves the workflow run reserves exactly it and the advertised price is its.
 */
describe("a single-row node advertises the row its run reserves", () => {
  const inputs = {
    "forced-alignment": { audioUrl: "https://media.test/a.mp3", prompt: "hello there" },
    "audio-isolation": { audioUrl: "https://media.test/a.mp3" },
    "remove-background": { imageUrl: "https://media.test/a.png" },
  } as const

  for (const [type, id] of Object.entries(FIXED_ROW_CREDIT_IDS)) {
    it(`${type} reserves ${id}, and advertises that row's price`, () => {
      const node: SimpleNode = { id: "n", type, data: { label: type } }
      const built = buildPayload(node, "job-1", inputs[type as keyof typeof inputs] as never)
      expect(built.modelIdentifier).toBe(id)
      expect(CREDIT_BAND_SOURCES[type]?.ids).toEqual([id])
      const price = STATIC_CREDIT_COSTS[id]
      expect(typeof price).toBe("number")
      expect(NODE_REGISTRY.find((d) => d.type === type)!.creditCost).toBe(price)
    })
  }

  it("forced-alignment advertises 30, the price of the row it reserves", () => {
    expect(NODE_REGISTRY.find((d) => d.type === "forced-alignment")!.creditCost).toBe(30)
  })
})


/**
 * Add Captions on Nemotron 3.5 Transcribe is one charge, the Remotion render
 * plus the video's started minutes (decided 2026-11-13). Its renderer rows alone
 * advertised a band that topped out at the kinetic row, below every Nemotron
 * caption run; the band now reaches the 60-minute charge.
 */
describe("Add Captions' band reaches a Nemotron caption run", () => {
  it("states the FFmpeg row up to the render plus 60 minutes", () => {
    const kinetic = STATIC_CREDIT_COSTS["add-captions:kinetic"]!
    const rate = STATIC_CREDIT_COSTS[NEMOTRON_TRANSCRIBE_PRICING.RATE_CREDIT_ID]!
    const cost = NODE_REGISTRY.find((d) => d.type === "add-captions")!.creditCost
    expect(cost).toBe(`${STATIC_CREDIT_COSTS["add-captions"]}-${kinetic + nemotronTranscribeBaseCredits(rate, 60)}`)
    expect(cost).toBe("30-95")
  })

  it("prices the composite where the lookup does (the charged table), else the kinetic row plus the minutes", () => {
    const band = CREDIT_BAND_SOURCES["add-captions"]!.band!
    // A lookup that prices the composite ids itself (as the charged table does).
    const priced = (id: string) =>
      id === "add-captions:kinetic:nemotron:60m" ? 105 : id === "add-captions:kinetic:nemotron:1m" ? 57 : ({ "add-captions": 33, "add-captions:kinetic": 55 } as Record<string, number>)[id]
    expect(band(priced)).toEqual([33, 105])
  })
})
