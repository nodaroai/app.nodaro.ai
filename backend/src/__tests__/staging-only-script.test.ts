/**
 * A staging-only script (src/scripts/compare-mcp-built-once.ts) runs only where
 * the operator has named this deployment's host, and never on a production host
 * (src/scripts/lib/staging-only.ts): it checks before it loads the app.
 */
import { describe, expect, it } from "vitest"
import { PRODUCTION_HOSTS, STAGING_CONFIRM_VARIABLE, stagingOnlyRefusal } from "../scripts/lib/staging-only.js"

const STAGING = "https://next.example.test"

describe("a staging-only script", () => {
  it("runs where the confirmation names this deployment's host", () => {
    expect(stagingOnlyRefusal({ PUBLIC_URL: STAGING, [STAGING_CONFIRM_VARIABLE]: "next.example.test" })).toBeNull()
    expect(stagingOnlyRefusal({ PUBLIC_URL: `${STAGING}/`, [STAGING_CONFIRM_VARIABLE]: " Next.Example.Test " })).toBeNull()
  })

  it.each([
    ["with no confirmation", { PUBLIC_URL: STAGING }, /set MCP_COMPARE_STAGING_HOST=next\.example\.test/],
    ["with an empty confirmation", { PUBLIC_URL: STAGING, [STAGING_CONFIRM_VARIABLE]: "  " }, /set MCP_COMPARE_STAGING_HOST/],
    ["when the confirmation names another host", { PUBLIC_URL: STAGING, [STAGING_CONFIRM_VARIABLE]: "app.example.test" }, /is app\.example\.test, but/],
    ["with no deployment address", { [STAGING_CONFIRM_VARIABLE]: "next.example.test" }, /PUBLIC_URL is not an http/],
  ])("refuses %s", (_name, env, reason) => {
    expect(stagingOnlyRefusal(env)).toMatch(reason)
  })

  it.each(["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "app.localhost", "backend"])("refuses the local address %s, even when it is the one confirmed", (host) => {
    expect(stagingOnlyRefusal({ PUBLIC_URL: `http://${host}:3000`, [STAGING_CONFIRM_VARIABLE]: host })).toMatch(/local address/)
  })

  it.each([...PRODUCTION_HOSTS])("refuses the production host %s, even when it is the one confirmed", (host) => {
    expect(stagingOnlyRefusal({ PUBLIC_URL: `https://${host}`, [STAGING_CONFIRM_VARIABLE]: host })).toMatch(/production host/)
  })
})
