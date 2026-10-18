// @test-watches frontend/src/**/*.{ts,tsx} frontend/index.html
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The app may be prerendered by another Nodaro surface on the same site
 * (Caddyfile: Supports-Loading-Mode). A prerendered page runs before it is
 * shown — and may never be shown — so every one-shot action on load that counts
 * a real visit or acts on the visitor waits for activation (lib/prerender.ts).
 * Plain data fetches may run in a prerender (that is the point of it).
 */

const FRONTEND = join(__dirname, "..", "..", "..")
const SRC = join(FRONTEND, "src")
const read = (path: string) => readFileSync(join(FRONTEND, path), "utf8")
const USES_IT = /import \{ whenActivated \} from "@\/lib\/prerender"/

/** The audited one-shot actions on load, each with why it must wait. */
const AUDITED: ReadonlyArray<readonly [file: string, why: string, call: RegExp]> = [
  ["src/layouts/dashboard-layout.tsx", "the pending-plan redirect moves the visitor", /whenActivated\(\(\) => \{[\s\S]{0,400}nodaro_pending_plan/],
  ["src/layouts/dashboard-layout.tsx", "the signed-out redirect moves the visitor", /whenActivated\(\(\) =>\s*navigate\(loginPathFor\(/],
  ["src/hooks/use-auth.ts", "the signup-grant claim records the account's grant", /function maybeClaimSignupGrant\(userId: string\): void \{\s*if \(!hasCredits\(\)\) return\s*(?:\/\/[^\n]*\n\s*)*whenActivated\(/],
  ["src/app/pricing/page.tsx", "?plan= opens Stripe checkout by itself", /whenActivated\(\(\) => \{[\s\S]{0,200}handleSubscribe\(/],
  ["src/ee/components/consent/consent-gate.tsx", "the server counts the consent read as a showing", /whenActivated\(\(\) => \{[\s\S]{0,80}fetchConsentState\(/],
  ["src/ee/components/welcome-offer/welcome-offer-popup.tsx", "the welcome popup opens by itself once", /whenActivated\(\(\) => \{[\s\S]{0,120}setOpen\(true\)/],
  ["src/ee/app/(dashboard)/billing/page.tsx", "the checkout-success toast", /whenActivated\(\(\) => \{[\s\S]{0,80}toast\.success\(/],
  ["src/app/(dashboard)/library/use-library-deep-link.ts", "the deep link is spent and may toast", /whenActivated\(\(\) => \{[\s\S]{0,400}withoutDeepLinkParams/],
  ["src/components/competitors/tried-cards.tsx", "marks a card seen on the server", /whenActivated\(\(\) => \{[\s\S]{0,120}askSeen\(action\)/],
]

/** Calls that count a visit by nature (analytics, beacons), optional-call forms (`gtag?.(`) included. */
const VISIT_COUNTING = /navigator\.sendBeacon\??\.?\(|\bgtag\??\.?\(|\bclarity\??\.?\(|window\.dataLayer\b/g

/** The [open, close) span of each `whenActivated(…)` call's arguments, by bracket walk. */
function heldSpans(source: string): readonly (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = []
  for (let at = source.indexOf("whenActivated("); at !== -1; at = source.indexOf("whenActivated(", at + 1)) {
    const open = at + "whenActivated".length
    let depth = 0
    let close = source.length
    for (let i = open; i < source.length; i++) {
      if (source[i] === "(") depth++
      else if (source[i] === ")" && --depth === 0) {
        close = i
        break
      }
    }
    spans.push([open, close])
  }
  return spans
}

/** Every visit-counting call in `source` that is NOT inside a `whenActivated(…)` call's brackets. */
function unwrappedVisitCalls(source: string): readonly string[] {
  const spans = heldSpans(source)
  return [...source.matchAll(VISIT_COUNTING)]
    .filter((match) => !spans.some(([open, close]) => (match.index ?? 0) > open && (match.index ?? 0) < close))
    .map((match) => match[0])
}

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
    return (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe("one-shot actions wait for activation", () => {
  it.each(AUDITED)("%s — %s", (file, _why, call) => {
    const src = read(file)
    expect(src).toMatch(USES_IT)
    expect(src).toMatch(call)
  })

  it("anything that counts a visit by nature (beacons, analytics) waits too — each call, not just the file", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.endsWith(join("lib", "prerender.ts")))
      .flatMap((file) => unwrappedVisitCalls(readFileSync(file, "utf8")).map((call) => `${relative(SRC, file)}: ${call}`))
    expect(offenders).toEqual([])
  })

  it("the scan flags an unwrapped call and accepts a wrapped one (planted examples)", () => {
    const unwrapped = `useEffect(() => { navigator.sendBeacon("/v1/seen") }, [])`
    const wrapped = `useEffect(() => whenActivated(() => { navigator.sendBeacon("/v1/seen") }), [])`
    // Importing the helper is not enough: the call itself must be held.
    const importedButNotUsed = `import { whenActivated } from "@/lib/prerender"\nuseEffect(() => { window.gtag?.("event"); gtag("event", "view") }, [])`
    expect(unwrappedVisitCalls(unwrapped)).toEqual(["navigator.sendBeacon("])
    expect(unwrappedVisitCalls(wrapped)).toEqual([])
    expect(unwrappedVisitCalls(importedButNotUsed)).toEqual(["gtag?.(", "gtag("])
    // Optional-call forms count too.
    expect(unwrappedVisitCalls(`useEffect(() => { gtag?.("event") }, [])`)).toEqual(["gtag?.("])
    expect(unwrappedVisitCalls(`navigator.sendBeacon?.("/v1/seen")`)).toEqual(["navigator.sendBeacon?.("])
    expect(unwrappedVisitCalls(`whenActivated(() => { gtag?.("event") })`)).toEqual([])
    // A call AFTER a closed whenActivated(...) is not held by it.
    expect(unwrappedVisitCalls(`whenActivated(() => { start() })\nnavigator.sendBeacon("/v1/seen")`)).toEqual(["navigator.sendBeacon("])
  })

  it("the analytics snippet (index.html) starts only once the page is shown", () => {
    const html = read("index.html")
    expect(html).toMatch(/document\.prerendering[\s\S]{0,200}prerenderingchange/)
  })
})
