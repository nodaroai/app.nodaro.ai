import { describe, it, expect } from "vitest"
import { he } from "../he"

/**
 * Right-to-left display invariants for the Hebrew dictionary.
 *
 * The bidi algorithm never mirrors arrow glyphs, and it hands the leading
 * punctuation of a Latin or numeric token to the surrounding Hebrew. Two rules
 * keep Hebrew text pointing and reading the right way:
 *
 * 1. Arrows. A "leads to" arrow between Hebrew words, or at the end of a
 *    Hebrew label, is ← — the reading direction. Only between two Latin
 *    letters is it →, because there the arrow belongs to a left-to-right run
 *    ("GIF → MP4", "my.telegram.org → API development tools"), and a ← there
 *    points backwards. Where both sides can be Latin at run time
 *    ({field} → {value}), RLM marks around the arrow pin it to the Hebrew flow.
 * 2. Leading punctuation. A token such as @name, .env, -1, +{n} or /data after
 *    a space or bracket in Hebrew text needs an LRM (U+200E) in front of it,
 *    or it renders as name@, env., 1-, 5+. The dictionary already writes
 *    ‎-1, ‎+{count} and ‎/in/abc this way.
 */

const LRM = "‎"
const RLM = "‏"
const HEBREW = /[֐-׿]/
const LATIN = /[A-Za-z]/

type Strong = "R" | "L" | "edge"

/** Nearest letter from `from` stepping by `step`; placeholder names are skipped. */
function nearestStrong(text: string, from: number, step: -1 | 1): Strong {
  const open = step === 1 ? "{" : "}"
  const close = step === 1 ? "}" : "{"
  let inPlaceholder = false
  for (let i = from; i >= 0 && i < text.length; i += step) {
    const c = text[i]
    if (inPlaceholder) {
      if (c === close) inPlaceholder = false
      continue
    }
    if (c === open) {
      inPlaceholder = true
      continue
    }
    if (c === RLM || HEBREW.test(c)) return "R"
    if (c === LRM || LATIN.test(c)) return "L"
  }
  return "edge"
}

/** Keys whose arrows are right for where they render (reviewed one by one). */
const ARROW_EXEMPT: Readonly<Record<string, string>> = {
  "present.navHint": "names the keyboard arrow keys themselves",
  "apps.deleted.backToApps": "a back link — in right-to-left text back points right",
  "utilcfg.backToFieldList": "a back link — in right-to-left text back points right",
  "node.arrowPerson": "node card caption; the canvas is pinned left-to-right",
  "node.pinterestBrowseTitle": "tooltip on a node card; the canvas is pinned left-to-right",
  "node.requiresNodaroConnect": "tooltip on a node card; the canvas is pinned left-to-right",
}

/** Keys rendered as code, where the leading-punctuation rule does not apply. */
const PUNCTUATION_EXEMPT: Readonly<Record<string, string>> = {
  "utilcfg.syntaxReferenceBody": "jq syntax table, rendered in a left-to-right <pre>",
  "utilcfg.jsonMoreHint": "a /* comment */ appended inside a JSON preview",
}

const entries = Object.entries(he as Record<string, string>)

describe("Hebrew dictionary — right-to-left marks", () => {
  it("points arrows in the reading direction", () => {
    const offenders: string[] = []
    for (const [key, value] of entries) {
      if (key in ARROW_EXEMPT) continue
      for (let i = 0; i < value.length; i++) {
        const c = value[i]
        if (c !== "→" && c !== "←") continue
        const left = nearestStrong(value, i - 1, -1)
        const right = nearestStrong(value, i + 1, 1)
        const latinRun = left === "L" && right === "L"
        if (c === "→" && !latinRun) offenders.push(`${key}: → in Hebrew flow — use ← (${value})`)
        if (c === "←" && latinRun) offenders.push(`${key}: ← between Latin words — use → (${value})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps a Latin token's leading punctuation attached with an LRM", () => {
    const offenders: string[] = []
    const token = /(^|[\s(\[“"״'])([@.+/-]+)(?=[A-Za-z0-9_{])/g
    for (const [key, value] of entries) {
      if (key in PUNCTUATION_EXEMPT || !HEBREW.test(value)) continue
      for (const m of value.matchAll(token)) {
        const at = (m.index ?? 0) + m[1].length
        if (nearestStrong(value, at - 1, -1) === "L") continue
        offenders.push(`${key}: add ${"\\u200E"} before "${value.slice(at, at + 12)}" (${value})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("lists only exemptions that still exist", () => {
    const keys = new Set(entries.map(([k]) => k))
    const stale = [...Object.keys(ARROW_EXEMPT), ...Object.keys(PUNCTUATION_EXEMPT)].filter((k) => !keys.has(k))
    expect(stale).toEqual([])
  })
})
