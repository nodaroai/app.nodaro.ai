import { describe, it, expect } from "vitest"
import { PEOPLE } from "../person.js"
import { STYLINGS } from "../styling.js"
import { MOODS } from "../mood.js"
import { POSES } from "../pose.js"
import { PHOTO_GENRES } from "../photo-genre.js"
import { getAdultOnlyEntries } from "../age-floor.js"

/**
 * A RATCHET, not a deriver (audit 2026-09-01 B1): the regex over-matches
 * ("nun … rosary at the waist", "construction worker … tool belt at the
 * waist", "karate fighter … barefoot") and under-matches real entries
 * ("state-fitted", "legwear-fishnets"). So: every entry the regex flags must
 * either carry `adultOnly` or be named in EXEMPT with a reason; and the
 * curated set must never shrink below CURATED. Adding a risky entry without
 * the flag fails here; adding a harmless entry that trips the regex is a
 * one-line exemption.
 */
const RISKY =
  /\bbust\b|\bhips\b|midriff|navel|bare shoulders|shoulders uncovered|\bsheer\b|lingerie|bikini|swimsuit|wet skin|glisten|clinging|plunging|lips (?:slightly )?(?:parted|open)|biting the lower lip|\bpout|half-lidded|lowered lids|seduct|sultry|smolder|voluptuous|tan lines|d[ée]colletage|body chain|near-naked|hugging the contours|close-fitting|latex|fishnet|thigh-high|stockings|corset|bra-style|mesh top|eroticism/i

/** Entries the regex trips on that are NOT body-exposure content. */
const EXEMPT: Readonly<Record<string, string>> = {
  "nun": "rosary at the waist — garment placement",
  "construction-worker": "tool belt at the waist",
  "karate-fighter": "barefoot in a fighting stance — martial arts",
  "mermaid": "from the waist up — creature framing",
  "merman": "from the waist up — creature framing",
  "outfit-bathrobe": "tied at the waist",
  "outfit-pirate": "sash at the waist",
  "outfit-chapan": "sash at the waist",
  "bottom-mom-jeans": "high-waisted — garment cut",
  "base-very-long-straight": "hair down to the waist",
  "base-very-long-wavy": "hair down to the waist",
  "base-very-long-curly": "hair down to the waist",
  "lip-state-bare": "bare, untreated lips — no makeup",
  "eye-state-glassy": "tear-glazed eyes — emotion",
  "hips-balanced": "neutral default, empty hint",
  "bust-average": "neutral default, empty hint",
  "waist-average": "neutral default, empty hint",
  "alice-wonderland": "knee-high stockings on a child-coded fairytale costume — not body exposure",
  "hair-wet": "wet hair only — no clothing or body exposure implied",
  "fabric-chiffon": "sheer fabric as a mainstream fashion material — not body exposure",
  "top-crop-top": "cropped top ending above the midriff — mainstream fashion silhouette, not exposure-focused like bra/bikini tops",
  "caught-off-guard": "lips parted from a startled reaction, not a seductive expression",
  "hands-on-hips": "neutral confident stance — hips referenced as a body part, no exposure or sexual content",
  "hand-position-hands-on-hips": "neutral confident stance, hand-position variant of hands-on-hips",
}

/** The hand-curated set. The test fails if any of these loses the flag. */
const CURATED = [
  // person — body axes
  "bust-small", "bust-full", "bust-very-full", "waist-defined", "waist-straight", "hips-wide", "hips-narrow",
  "silhouette-hourglass", "silhouette-pear",
  // person — lips / eyes / skin / features / types / vibes
  "lip-state-glossy", "lip-state-parted", "lip-state-bitten", "lip-state-pouting",
  "eye-state-half-lidded",
  "texture-shower-fresh-wet", "texture-glistening", "texture-tan-lines", "texture-oily",
  "feature-bare-shoulders", "feature-collarbone-visible", "feature-midriff-visible", "feature-navel-visible",
  "feature-chest-tattoo", "feature-back-tattoo", "feature-leg-tattoo",
  "femme-fatale", "thick", "vampire-woman", "feral-wildman", "buenos-aires-tango",
  // styling
  "top-bra-top", "top-bikini-top", "top-mesh-top", "top-sheer-top", "top-corset",
  "state-fitted", "state-sheer", "state-wet", "state-cropped", "state-off-shoulder", "state-halter-neck", "state-plunging-neck",
  "outfit-lingerie", "outfit-bikini", "outfit-one-piece-swim", "outfit-school-uniform",
  "fabric-latex",
  "legwear-sheer-tights", "legwear-fishnets", "legwear-thigh-highs", "legwear-lace-top-stockings",
  "footwear-thigh-high-boots",
  "jewelry-choker-chain", "jewelry-choker-leather", "jewelry-choker-velvet", "jewelry-body-chain",
  // mood / pose / photo-genre
  "seductive", "sultry", "smoldering", "flirty",
  "biting-lip", "arched-back", "sitting-edge-of-bed", "lounging", "lying-down",
  "brand-helmut-newton", "glamour-portrait",
] as const

const ALL = [...PEOPLE, ...STYLINGS, ...MOODS, ...POSES, ...PHOTO_GENRES]

describe("adultOnly ratchet", () => {
  it("every id in CURATED exists and carries the flag", () => {
    const byId = new Map(ALL.map((e) => [e.id, e]))
    const missing = CURATED.filter((id) => !byId.has(id))
    expect(missing, "curated ids that do not exist").toEqual([])
    const unflagged = CURATED.filter((id) => byId.get(id)!.adultOnly !== true)
    expect(unflagged, "curated ids missing adultOnly").toEqual([])
  })

  it("every entry the RISKY regex trips on is flagged or exempted with a reason", () => {
    const offenders = ALL.filter(
      (e) => RISKY.test(`${e.promptHint} ${e.term ?? ""}`) && e.adultOnly !== true && !(e.id in EXEMPT),
    ).map((e) => `${e.id}: ${e.promptHint}`)
    expect(offenders, "flag these or add them to EXEMPT with a reason").toEqual([])
  })

  it("no exemption is stale (an exempt id that is now flagged, or gone)", () => {
    const byId = new Map(ALL.map((e) => [e.id, e]))
    for (const id of Object.keys(EXEMPT)) {
      expect(byId.has(id), `EXEMPT names a missing id ${id}`).toBe(true)
      expect(byId.get(id)!.adultOnly, `EXEMPT ${id} is now flagged — drop the exemption`).toBeUndefined()
    }
  })

  it("neutral defaults with an empty hint are never flagged", () => {
    for (const e of ALL) if (e.promptHint === "") expect(e.adultOnly, e.id).toBeUndefined()
  })

  it("getAdultOnlyEntries covers exactly the flagged set", () => {
    const flagged = ALL.filter((e) => e.adultOnly === true).map((e) => e.id).sort()
    expect(getAdultOnlyEntries().map((e) => e.id).sort()).toEqual(flagged)
  })
})
