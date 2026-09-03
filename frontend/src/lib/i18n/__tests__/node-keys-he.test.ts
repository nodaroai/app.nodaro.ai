import { describe, it, expect } from "vitest"
import { en } from "../en"
import { he } from "../he"

/**
 * Guard for the `node.*` namespace — the strings the node CARDS on the canvas
 * render (titles, icon-button tooltips, status badges, empty states,
 * placeholders). The cards were the last raw-English surface; a mechanical
 * pass moved 552 of their strings into the dictionaries, seeding `he` with the
 * English value as a placeholder. This test is what keeps a placeholder from
 * shipping again: every `node.*` key must exist in `he`, carry an actual
 * Hebrew letter, and keep en's `{placeholders}` intact.
 *
 * The key set is derived from `en` (canonical), NOT from a fixed list, so a
 * key another agent adds tomorrow is covered the moment it lands.
 */

/** `node.*` values with no Hebrew letter that are legitimately so (reviewed one by one). */
const LEGIT_LATIN_HE: readonly string[] = [
  // Format-only: punctuation wrapping two interpolated values ("({n} {u})"),
  // no prose to translate. Both dicts carry it byte-identical by design.
  "node.creditsSuffix",
  // Nothing else: every other node.* value carries Hebrew. Brand names
  // (NodarCut, Avatar V, HeyGen, Suno, MMAudio, Replicate, Lottie, WAV,
  // YouTube) stay Latin as TOKENS inside an otherwise Hebrew phrase — none is
  // the whole value. i18n.test.ts's "config-panel Hebrew" check now covers the
  // `node.` namespace too, against its own allowlist in that file, so a value
  // left fully Latin here would fail there as well.
]

const HEBREW = /[֐-׿]/
const PLACEHOLDERS = /\{[^}]+\}/g

const nodeKeys = Object.keys(en).filter((k) => k.startsWith("node."))

describe("node.* Hebrew coverage", () => {
  it("sees the whole node namespace (the guard is not vacuous)", () => {
    expect(nodeKeys.length).toBeGreaterThan(280)
    // Spot-check both ends of the namespace: a moderation key from the first
    // wave and a card string from the mechanical pass.
    expect(nodeKeys).toContain("node.moderation.remove")
    expect(nodeKeys).toContain("node.editInNodarcut")
  })

  it("every node.* key has a Hebrew value", () => {
    const missing = nodeKeys.filter((k) => typeof he[k as keyof typeof he] !== "string")
    expect(missing, `node.* keys with no he value:\n${missing.join("\n")}`).toEqual([])
  })

  it("every node.* Hebrew value is actually Hebrew (no English placeholder left)", () => {
    const LATIN_OK = new Set<string>(LEGIT_LATIN_HE)
    const bad = nodeKeys
      .filter((k) => !LATIN_OK.has(k))
      .map((k) => [k, he[k as keyof typeof he] as string | undefined] as const)
      .filter(([, v]) => typeof v === "string" && !HEBREW.test(v))
      .map(([k, v]) => `${k} = ${v}`)
    expect(bad, `node.* he values with no Hebrew letter:\n${bad.join("\n")}`).toEqual([])
    for (const k of LATIN_OK) {
      const v = he[k as keyof typeof he] as string | undefined
      expect(typeof v === "string" && !HEBREW.test(v), `${k} is Hebrew now — drop it from the Latin allowlist`).toBe(true)
    }
  })

  it("every node.* Hebrew value keeps en's {placeholders}", () => {
    const mismatched = nodeKeys
      .map((k) => {
        const enV = en[k as keyof typeof en] as string
        const heV = he[k as keyof typeof he] as string | undefined
        if (typeof heV !== "string") return null
        const want = (enV.match(PLACEHOLDERS) ?? []).slice().sort()
        const got = (heV.match(PLACEHOLDERS) ?? []).slice().sort()
        return want.join(",") === got.join(",") ? null : `${k}: en ${JSON.stringify(want)} vs he ${JSON.stringify(got)}`
      })
      .filter((x): x is string => x !== null)
    expect(mismatched, `node.* placeholder drift:\n${mismatched.join("\n")}`).toEqual([])
  })
})
