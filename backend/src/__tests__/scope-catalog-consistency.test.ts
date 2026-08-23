import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_SCOPES } from "@/lib/scopes.js"

/**
 * Every scope the backend can grant is described on the consent screen.
 *
 * A scope the backend accepts but the consent screen cannot name is a
 * permission somebody agreed to without being told what it was. That is not
 * a cosmetic gap: the consent screen is the ENTIRE record of what the person
 * agreed to, and a blank line in it means the agreement did not cover the
 * thing it was supposed to.
 *
 * The two lists live in different trees — the backend decides, the frontend
 * explains — and nothing but this test connects them. It is a source-text
 * check on purpose: the consent page is a React component whose rendering
 * would prove far less than the map it renders from.
 */

const CONSENT_PAGE = readFileSync(
  join(__dirname, "..", "..", "..", "frontend", "src", "app", "oauth", "authorize", "page.tsx"),
  "utf8",
)

/** The keys of the SCOPE_DESCRIPTIONS map on the consent page. */
function describedScopes(): Set<string> {
  const start = CONSENT_PAGE.indexOf("const SCOPE_DESCRIPTIONS")
  expect(start, "SCOPE_DESCRIPTIONS not found on the consent page").toBeGreaterThanOrEqual(0)
  const end = CONSENT_PAGE.indexOf("\n}", start)
  const block = CONSENT_PAGE.slice(start, end)
  return new Set([...block.matchAll(/"([a-z]+:[a-z]+)":/g)].map((m) => m[1]))
}

describe("the scope catalog and the consent screen", () => {
  it("describes every scope the backend can grant", () => {
    const described = describedScopes()
    const undescribed = ALL_SCOPES.filter((s) => !described.has(s))
    expect(undescribed, "these scopes could be granted with nothing shown to the person granting them").toEqual([])
  })

  it("describes nothing the backend cannot grant", () => {
    // A described scope that does not exist is a promise the API never keeps.
    const known = new Set<string>(ALL_SCOPES)
    const orphans = [...describedScopes()].filter((s) => !known.has(s))
    expect(orphans).toEqual([])
  })

  it("includes the workspace scopes, and they are not grandfathered", () => {
    // A token issued before organizations existed was consented to by someone
    // who could not have been agreeing to let an app choose where their work
    // lands.
    for (const scope of ["workspaces:read", "workspaces:write"]) {
      expect(ALL_SCOPES).toContain(scope)
      expect(describedScopes()).toContain(scope)
    }
  })

  it("declares no organization scope that nothing checks", () => {
    // A scope in this catalog is published in `scopes_supported` and handed
    // to any DCR client that asks for everything. Declaring one before
    // anything enforces it authorizes every token issued in the meantime for
    // a capability that did not exist — grandfathering, moved forward in
    // time. Add these back in the same change that makes them mean something.
    expect(ALL_SCOPES).not.toContain("organizations:read")
    expect(ALL_SCOPES).not.toContain("members:write")
  })
})
