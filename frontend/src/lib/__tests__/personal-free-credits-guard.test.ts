// @test-watches frontend/src/**/*.{ts,tsx}
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A deployment that sells nothing (`billing.selfServe: false`) or has a single
 * payer gives no free credits of one's own, so every surface a person of such a
 * deployment can reach says so through ONE rule, `personalFreeCreditsShown`
 * (`lib/surface-selectors.ts`), or its render gate `PersonalFreeCreditsOnly`.
 * A new use of the free-tier figure or of a promise of free credits that skips
 * it would advertise a grant that deployment does not have, which is the bug
 * this guard is here to keep gone.
 *
 * The welcome offer is decided once, in `useWelcomeOffer` (the popup and banner
 * read its mode), and pinned by that hook's tests rather than by this scan.
 */

const SRC = join(__dirname, "..", "..")

/** The free-tier figure, and every dictionary key that promises free credits of one's own. */
const PROMISES = [
  "FREE_TIER_CREDITS",
  "auth.freeCredits",
  "present.getFreeCredits",
  "pricing.freeTierBadge",
  "pricing.freeCreditsCount",
  "pricing.noCreditCardSuffix",
  "credits.freeGrantOnPurchase",
  "credits.freeGrantBrowser",
] as const

/** The four self-host strings: each is on a screen a self-hosted install alone can reach, and promises nodaro.ai's own credits. */
const SELF_HOST_PROMISES = [
  "setup.step2Desc",
  "dash.calloutNeedProvider",
  "integ.cloudDescNotConnected",
  "connect.providerFreeCredits",
] as const

/** Sources allowed to name a promise without the rule, each for a reason that is not "reaching a person of a deployment that has none". */
const EXEMPT: Readonly<Record<string, string>> = {
  "lib/pricing-data.ts": "defines FREE_TIER_CREDITS",
  "app/setup/page.tsx": "self-host setup page (setup.step2Desc)",
  "components/dashboard/provider-setup-callout.tsx": "renders null when isCloud() (dash.calloutNeedProvider)",
  "components/integrations/nodaro-cloud-card.tsx": "renders null when isCloud() (integ.cloudDescNotConnected)",
  "components/editor/connect-provider-dialog.tsx": "its watcher never opens it when isCloud() (connect.providerFreeCredits)",
}

/** The dictionaries define these keys; every other source names them to use them. */
const DICTIONARIES = "lib/i18n/"

const GOES_THROUGH_THE_RULE = /\bpersonalFreeCreditsShown\b|\bPersonalFreeCreditsOnly\b/

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : []
  })
}

/** Comments and strings the code does not use: a word in a comment is not a promise on a screen. */
function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const code = line.trimStart()
      return !code.startsWith("//") && !code.startsWith("*") && !code.startsWith("/*")
    })
    .join("\n")
}

/** The promises a source names and does not gate, or an empty list. */
function ungatedPromises(source: string): readonly string[] {
  const code = codeOnly(source)
  if (GOES_THROUGH_THE_RULE.test(code)) return []
  return [...PROMISES, ...SELF_HOST_PROMISES].filter((promise) =>
    promise === "FREE_TIER_CREDITS"
      ? /\bFREE_TIER_CREDITS\b/.test(code)
      : new RegExp(`["'\`]${promise.replaceAll(".", "\\.")}["'\`]`).test(code),
  )
}

describe("every promise of free credits of one's own goes through personalFreeCreditsShown", () => {
  it("no source names the free-tier figure or a promise without the rule", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const rel = relative(SRC, file).replaceAll("\\", "/")
      if (rel.startsWith(DICTIONARIES) || EXEMPT[rel] !== undefined) return []
      const promises = ungatedPromises(readFileSync(file, "utf8"))
      return promises.length ? [`${rel}: ${promises.join(", ")}`] : []
    })
    expect(
      offenders,
      `A promise of free credits of one's own must go through personalFreeCreditsShown (lib/surface-selectors.ts) or PersonalFreeCreditsOnly (components/billing/personal-free-credits-only.tsx), or a deployment that sells nothing advertises a grant it does not have. Found:\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("every exemption still names a real file that still needs it", () => {
    for (const [rel, reason] of Object.entries(EXEMPT)) {
      const source = codeOnly(readFileSync(join(SRC, rel), "utf8"))
      const names = [...PROMISES, ...SELF_HOST_PROMISES].some((promise) => source.includes(promise))
      expect(names, `${rel} is exempt (${reason}) but names no promise any more`).toBe(true)
    }
  })

  it("the scan catches what it says it catches", () => {
    expect(ungatedPromises('t("auth.freeCredits", { credits })')).toEqual(["auth.freeCredits"])
    expect(ungatedPromises('import { FREE_TIER_CREDITS } from "@/lib/pricing-data"\nconst n = FREE_TIER_CREDITS')).toEqual(["FREE_TIER_CREDITS"])
    expect(ungatedPromises('t("present.getFreeCredits")')).toEqual(["present.getFreeCredits"])
    expect(ungatedPromises('t("auth.freeCredits")\npersonalFreeCreditsShown(p)')).toEqual([])
    expect(ungatedPromises('<PersonalFreeCreditsOnly>{t("pricing.freeTierBadge")}</PersonalFreeCreditsOnly>')).toEqual([])
    expect(ungatedPromises("// auth.freeCredits in a comment\nconst a = 1")).toEqual([])
  })
})
