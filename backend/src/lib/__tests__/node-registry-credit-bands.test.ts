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
 *     exception is `apply-edl`'s `"per-minute"`, which is not a band at all).
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

import { describe, it, expect } from "vitest"
import { NODE_REGISTRY, CREDIT_BAND_SOURCES } from "../node-registry.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

/**
 * Credit-cost strings that are deliberately NOT a `min-max` band.
 *
 * `apply-edl` is priced per minute of RENDERED output, so there is no ceiling
 * to state — the descriptor says so in words instead of quoting a number the
 * run would not honour. Add an entry here only with the same kind of reason.
 */
const NON_BAND_CREDIT_STRINGS: Readonly<Record<string, string>> = {
  "apply-edl": "per-minute",
}

/** Recompute a band from the source data, independently of the registry. */
function deriveBand(type: string): number | string {
  const source = CREDIT_BAND_SOURCES[type]!
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

  it("a per-unit RATE row never widens a band: text-to-speech states the flat per-request rows, not its :per-100-chars rows", () => {
    // `<model>:per-100-chars` (decided 2026-10-06) prices ONE started 100 characters
    // and is read only while SPEECH_LENGTH_PRICING_ENABLED is on; `familyIds` would
    // otherwise fold it in and advertise "2-30" for a run that is never below 16.
    const ids = CREDIT_BAND_SOURCES["text-to-speech"]!.ids
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.some((id) => id.endsWith(":per-100-chars"))).toBe(false)
    expect(Object.keys(STATIC_CREDIT_COSTS).some((id) => id.endsWith(":per-100-chars"))).toBe(true)
    expect(NODE_REGISTRY.find((d) => d.type === "text-to-speech")!.creditCost).toBe(deriveBand("text-to-speech"))
    expect(deriveBand("text-to-speech")).toBe("15-30")
  })
})
