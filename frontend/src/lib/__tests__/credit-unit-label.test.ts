import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Phase B (H14) — no credit figure may be rendered next to a hand-rolled unit
 * label. With a display unit configured, a site that still says "CR" (or the
 * Hebrew "קר׳"), or that glues a raw number to the word "credits", shows the
 * platform's credits under the customer's unit — or the customer's unit under
 * a raw number. Neither is detectable by eye, so this is enforced by scan.
 *
 * Every user-facing render of a credit figure goes through ONE of:
 *   - <CreditCost …> (components/ui/credit-cost.tsx) — converts + labels
 *   - creditUnits() / creditUnitLabel() / formatCreditUnits() / serverUnitLabel()
 *     (lib/credit-units.ts) — for template strings and i18n params
 *   - an i18n key that takes the label as a `u` parameter
 *
 * ALLOWLIST is deliberately EMPTY and must stay empty: the design forbids
 * setting `billing.unitLabel` on any deployment while a literal site remains.
 * ee/app/(admin)/ is exempt by directory — admin screens are the platform
 * operator's own view of the platform's own credits (audits, anomalies,
 * per-user grants) and are not shown to a hosted instance's users.
 */
const FRONTEND_SRC = join(__dirname, "..", "..")

/** Files that legitimately contain the literals (the funnel itself + dictionaries). */
const SOURCE_EXEMPT = new Set([
  "lib/credit-units.ts",
  "lib/surface-selectors.ts",
  "components/ui/credit-cost.tsx",
])
const DIR_EXEMPT = ["__tests__", "node_modules", "lib/i18n", "ee/app/(admin)"]

const ALLOWLIST: readonly string[] = []

/** `… CR` / `… CR)` / `CR/run` / `"CR"` — the short Latin label as a unit, and the Hebrew abbreviation. */
const SHORT_LABEL = /(?<![A-Za-z])CR(?![A-Za-z])|קר׳/
/** A raw figure glued to the long word: `{x} credits`, `${x} credits`, `x} credit`
 *  — but not a JSX prop named `credits` following another prop (`{id} credits=`). */
const GLUED_WORD = /\}\s*credits?\b(?!\s*=)|\$\{[^}\n]*\}\s*credits?\b(?!\s*=)/
/** Lines that clearly are not rendering a unit (identifiers, imports, comments). */
const NOISE = /^\s*(\/\/|\/\*|\*|import\b)|CR_|_CR|CREDIT|SECRET|CR[A-Z]/

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(FRONTEND_SRC, full)
    if (statSync(full).isDirectory()) {
      if (DIR_EXEMPT.some((d) => rel === d || rel.startsWith(`${d}/`) || entry === d)) continue
      yield* walk(full)
    } else if (/\.(tsx|ts)$/.test(entry) && !SOURCE_EXEMPT.has(rel)) {
      yield full
    }
  }
}

function justified(line: string, prev: string | undefined): boolean {
  return (
    line.includes("creditUnits(") ||
    line.includes("creditUnitLabel(") ||
    line.includes("formatCreditUnits(") ||
    line.includes("serverUnitLabel(") ||
    line.includes("<CreditCost") ||
    line.includes("credit-units:") ||
    (prev?.includes("credit-units:") ?? false)
  )
}

describe("credit-unit label scan (Phase B, H14)", () => {
  it("no user-facing file renders a credit figure with a hand-rolled unit label", () => {
    const offenders: string[] = []
    for (const file of walk(FRONTEND_SRC)) {
      const rel = relative(FRONTEND_SRC, file)
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, i) => {
        if (NOISE.test(line)) return
        if (!SHORT_LABEL.test(line) && !GLUED_WORD.test(line)) return
        if (justified(line, lines[i - 1])) return
        const key = `${rel}:${i + 1}`
        if (ALLOWLIST.includes(key)) return
        offenders.push(`${key}  ${line.trim()}`)
      })
    }
    expect(
      offenders,
      `Render credit figures through <CreditCost>, creditUnits()/creditUnitLabel()/formatCreditUnits(), or serverUnitLabel() (lib/credit-units.ts). Hand-rolled unit labels found:\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("the allowlist is empty — a display unit may only be configured once every site is migrated", () => {
    expect(ALLOWLIST).toEqual([])
  })

  /**
   * The i18n keys whose value carries the unit take it as `{u}`. `t()`'s params
   * are an untyped record, so a caller that forgets `u` renders a literal "{u}"
   * on screen. Every call of one of these keys must pass `u:` within the same
   * statement (allow up to three lines for a multi-line params object).
   */
  const U_KEYS = [
    "node.creditsSuffix",
    "run.creditsShort",
    "apps.crRunSuffix",
    "apps.flatFee",
    "apps.monetizationCalc",
    "marketplace.crPerRun",
    "marketplace.flatFeeLabel",
    "marketplace.costSummary",
    "cost.col.perRunCredits",
    "credits.perCreditSuffix",
  ]
  it("every caller of a unit-bearing i18n key passes the label as `u`", () => {
    const offenders: string[] = []
    const keyRe = new RegExp(`\\b(t|tx|translate)\\((?:[^,)]*,\\s*)?["'](${U_KEYS.map((k) => k.replace(/\./g, "\\.")).join("|")})["']`)
    for (const file of walk(FRONTEND_SRC)) {
      const rel = relative(FRONTEND_SRC, file)
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, i) => {
        if (!keyRe.test(line)) return
        const window = lines.slice(i, i + 4).join("\n")
        if (/\bu:/.test(window)) return
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(offenders, `These i18n keys carry the unit as {u} — pass u: creditUnitLabel(t("credits.unitShort")):\n${offenders.join("\n")}`).toEqual([])
  })
})
