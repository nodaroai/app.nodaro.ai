import { afterEach, describe, expect, it, vi } from "vitest"
import { liveStripeKeyProblem } from "../stripe-mode-settings.js"

/**
 * STRIPE_REQUIRE_TEST_MODE: a deployment that must never reach Stripe's live
 * mode (a staging environment on a copy of production's database) refuses to
 * start while any setting holds a live Stripe key, naming the setting and
 * never the key.
 */

// Fake keys, built here rather than written out: a key-shaped literal is what the secret scan looks for.
const fakeKey = (kind: "sk" | "rk" | "pk", mode: "live" | "test"): string => [kind, mode, "0".repeat(12)].join("_")
const FAKE_TAIL = "0".repeat(12)

describe("liveStripeKeyProblem", () => {
  const live = { STRIPE_SECRET_KEY: fakeKey("sk", "live"), VITE_STRIPE_PUBLISHABLE_KEY: fakeKey("pk", "live") }

  it("unset or empty, nothing is checked: every deployment as before", () => {
    expect(liveStripeKeyProblem(live)).toBeNull()
    expect(liveStripeKeyProblem({ ...live, STRIPE_REQUIRE_TEST_MODE: "" })).toBeNull()
  })

  it("any other value than true is refused, so a typo can never switch the guard off quietly", () => {
    for (const value of ["1", "TRUE", "true\n", " true", "yes", "false"]) {
      expect(liveStripeKeyProblem({ STRIPE_REQUIRE_TEST_MODE: value }), JSON.stringify(value)).toMatch(/^STRIPE_REQUIRE_TEST_MODE must be/)
    }
  })

  it("on, a word that merely ends in a key's letters is no key", () => {
    expect(liveStripeKeyProblem({ STRIPE_REQUIRE_TEST_MODE: "true", QUEUE: "task_live_jobs", NET: "network_live_status", PATH_LIKE: "/opt/disk_live_data" })).toBeNull()
  })

  it("on, test-mode keys (secret, restricted or publishable) pass", () => {
    expect(liveStripeKeyProblem({ STRIPE_REQUIRE_TEST_MODE: "true", STRIPE_SECRET_KEY: fakeKey("rk", "test"), OTHER: fakeKey("pk", "test"), EMPTY: "" })).toBeNull()
  })

  it("on, any live key in any setting is refused, naming every such setting and never a key", () => {
    const cases: Array<[string, string]> = [
      ["STRIPE_SECRET_KEY", fakeKey("sk", "live")],
      ["STRIPE_SECRET_KEY", fakeKey("rk", "live")],
      ["VITE_STRIPE_PUBLISHABLE_KEY", fakeKey("pk", "live")],
      ["PLUGIN_CONFIG", JSON.stringify({ stripe: fakeKey("sk", "live") })],
    ]
    for (const [name, value] of cases) {
      const problem = liveStripeKeyProblem({ STRIPE_REQUIRE_TEST_MODE: "true", [name]: value })
      expect(problem, name).toMatch(/^STRIPE_REQUIRE_TEST_MODE /)
      expect(problem).toContain(name)
      expect(problem).not.toContain(FAKE_TAIL)
    }
    expect(liveStripeKeyProblem({ STRIPE_REQUIRE_TEST_MODE: "true", ...live })).toContain("STRIPE_SECRET_KEY, VITE_STRIPE_PUBLISHABLE_KEY")
  })
})

describe("the server refuses to start with a live key when test mode is required", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("names the setting, never the key", async () => {
    vi.resetModules()
    vi.stubEnv("STRIPE_REQUIRE_TEST_MODE", "true")
    vi.stubEnv("STRIPE_SECRET_KEY", fakeKey("sk", "live"))
    const loaded = import("../config.js")
    await expect(loaded).rejects.toThrow(/STRIPE_REQUIRE_TEST_MODE .*STRIPE_SECRET_KEY/)
    await expect(loaded).rejects.not.toThrow(new RegExp(FAKE_TAIL))
  })
})
