// @test-watches backend/src/**/*.ts
/**
 * Who a reservation may auto-recharge — `autoRechargeTargetFor` is the ONE
 * place that decides, and every reserve site must ask it. What these pin:
 * personal → the requester; workspace → nobody; deployment → the PAYER, and
 * only for work stamped in-app (fail-closed for API tokens, triggers and
 * loopbacks); the read-only status the billing surfaces show; and a source
 * guard that fails the build when a new call site decides inline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const h = vi.hoisted(() => ({
  profile: { data: null as unknown, error: null as unknown },
  config: { AUTO_RECHARGE_ENABLED: true as boolean },
}))

vi.mock("../../../lib/supabase.js", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(h.profile),
  }
  return { supabase: { from: () => chain, rpc: vi.fn() } }
})
vi.mock("../../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return { ...actual, config: new Proxy(actual.config, { get: (t, k) => (k in h.config ? h.config[k as "AUTO_RECHARGE_ENABLED"] : t[k as keyof typeof t]) }) }
})

const { autoRechargeTargetFor, readAutoRechargeStatus } = await import("../auto-recharge.js")

const ENT = { watermark: false as const, dailyCapCredits: null, parallelism: 4, tierForGates: "basic" as const }
const DEP = { payer: "deployment" as const, userId: "requester", payerId: "payer", entitlements: ENT }

describe("autoRechargeTargetFor", () => {
  it("personal (absent or explicit) → the requester's own account", () => {
    expect(autoRechargeTargetFor("requester", undefined)).toBe("requester")
    expect(autoRechargeTargetFor("requester", { payer: "user", userId: "requester" })).toBe("requester")
  })

  it("workspace → nobody: a member's card is never charged for class work", () => {
    const ws = {
      payer: "workspace" as const,
      userId: "requester",
      workspaceId: "ws",
      orgId: "org",
      memberCap: null,
      entitlements: {
        ...ENT,
        tierForGates: "business" as const,
        freeTierBlocklist: false as const,
        webFreeMode: false as const,
        appCreditsAllowance: false as const,
      },
    }
    expect(autoRechargeTargetFor("requester", ws)).toBeNull()
  })

  it("deployment without the in-app stamp → nobody (fail-closed)", () => {
    expect(autoRechargeTargetFor("requester", DEP)).toBeNull()
  })

  it("deployment with the in-app stamp → the PAYER account, never the requester", () => {
    expect(autoRechargeTargetFor("requester", { ...DEP, autoRecharge: true })).toBe("payer")
  })
})

describe("readAutoRechargeStatus", () => {
  beforeEach(() => {
    h.config.AUTO_RECHARGE_ENABLED = true
    h.profile = {
      data: {
        auto_recharge_enabled: true,
        auto_recharge_threshold_credits: 5000,
        auto_recharge_amount_usd: 50,
        auto_recharge_failure_count: 0,
        auto_recharge_last_attempt_at: "2026-10-26T10:00:00.000Z",
      },
      error: null,
    }
  })

  it("a complete, enabled config with the kill switch on is active", async () => {
    expect(await readAutoRechargeStatus("payer")).toEqual({
      enabled: true,
      active: true,
      thresholdCredits: 5000,
      amountUsd: 50,
      failureCount: 0,
      lastAttemptAt: "2026-10-26T10:00:00.000Z",
    })
  })

  it("enabled but the instance kill switch is off → not active", async () => {
    h.config.AUTO_RECHARGE_ENABLED = false
    expect(await readAutoRechargeStatus("payer")).toMatchObject({ enabled: true, active: false })
  })

  it("three failures → not active (the charge path stops there too)", async () => {
    h.profile = { data: { ...(h.profile.data as object), auto_recharge_failure_count: 3 }, error: null }
    expect(await readAutoRechargeStatus("payer")).toMatchObject({ enabled: true, active: false, failureCount: 3 })
  })

  it("an incomplete config → not active", async () => {
    h.profile = { data: { ...(h.profile.data as object), auto_recharge_amount_usd: null }, error: null }
    expect(await readAutoRechargeStatus("payer")).toMatchObject({ active: false, amountUsd: null })
  })

  it("a failed read answers null — unknown, never 'off'", async () => {
    h.profile = { data: null, error: { message: "boom" } }
    expect(await readAutoRechargeStatus("payer")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Source guard: every reserve site asks autoRechargeTargetFor
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full)
  }
  return out
}

describe("auto-recharge call sites", () => {
  const callers = sourceFiles(SRC)
    .filter((f) => !f.endsWith(join("ee", "billing", "auto-recharge.ts")))
    .map((f) => ({ file: relative(SRC, f), text: readFileSync(f, "utf8") }))
    .filter(({ text }) => /\battemptAutoRecharge\(/.test(text))

  it("the known reserve sites still exist (a rename must update this guard)", () => {
    expect(callers.map((c) => c.file).sort()).toEqual(
      [
        join("ee", "billing", "credits.ts"),
        join("ee", "pipelines", "credits.ts"),
        join("ee", "pipelines", "scene-helper-credits.ts"),
      ].sort(),
    )
  })

  it("every call charges the account autoRechargeTargetFor chose — never a raw user id", () => {
    for (const { file, text } of callers) {
      const calls = [...text.matchAll(/\battemptAutoRecharge\(([^)]*)\)/g)].map((m) => m[1]!.trim())
      expect(calls.length, file).toBeGreaterThan(0)
      for (const arg of calls) expect(arg, `${file}: attemptAutoRecharge(${arg})`).toBe("rechargeTarget")
      expect(text, file).toMatch(/const rechargeTarget = autoRechargeTargetFor\(/)
    }
  })
})
