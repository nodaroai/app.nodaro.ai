import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"

/**
 * Track A — the sidebar entry for `/billing-admin` (spec §9.3).
 *
 * The entry is rendered for exactly one identity: the deployment's billing
 * account. Everyone else must not see it, because the page behind it answers
 * 403 to them on every route it reads — an entry that always fails is worse
 * than no entry.
 *
 * The bug this guards is specific and was called out in the handoff: the
 * sidebar filters its items in TWO independent places, once for the collapsed
 * icon rail and once for the expanded sections. A `payerOnly` line in only one
 * of them leaves the entry visible in the collapsed rail — the half nobody
 * looks at while developing, and the half most users run.
 *
 * A source-text guard, in the `org-route-registration.test.ts` / orphan-guard
 * style: rendering this sidebar needs a router, an auth session and five query
 * hooks, and the property being pinned is structural (the predicate exists in
 * BOTH branches), not visual.
 */

const SIDEBAR = readFileSync(join(__dirname, "..", "app-sidebar.tsx"), "utf8")

describe("the billing-account sidebar entry", () => {
  it("exists, points at /billing-admin, and is payerOnly", () => {
    expect(SIDEBAR).toContain(
      `{ href: "/billing-admin", label: "billingAdmin.navLabel", icon: Wallet, payerOnly: true },`,
    )
  })

  it("reads the viewer flag from the server-probed hook, not from client config", () => {
    // The payer's uuid is redacted from /config.js on purpose, so there is no
    // client-side identity to compare against; the only honest signal is the
    // server's own 200-vs-403 on a requireDeploymentPayer route.
    expect(SIDEBAR).toContain(
      `import { useDeploymentPayerViewer } from "@/ee/hooks/queries/use-deployment-billing"`,
    )
    expect(SIDEBAR).toContain("const { isPayer } = useDeploymentPayerViewer()")
  })

  it("is filtered out in BOTH the collapsed rail and the expanded sections", () => {
    // One without the other is the bug: the entry survives in the rail.
    expect(SIDEBAR).toContain("if (item.payerOnly && !isPayer) return null")
    expect(SIDEBAR).toContain("if (item.payerOnly && !isPayer) return false")
  })

  it("labels itself with a key that exists in both shipped locales", () => {
    // The instance is Hebrew-default; an untranslated key renders the English
    // fallback beside eight Hebrew ones.
    expect(en["billingAdmin.navLabel"]).toBeTruthy()
    expect(he["billingAdmin.navLabel"]).toBeTruthy()
    expect(he["billingAdmin.navLabel"]).not.toBe(en["billingAdmin.navLabel"])
  })
})
