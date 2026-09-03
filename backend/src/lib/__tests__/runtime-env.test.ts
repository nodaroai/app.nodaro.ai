/**
 * The runtime-environment leaf: one source of truth for "which deployment am
 * I?", used to scope the workflow-execution reconcile sweeps.
 *
 * Staging and production share ONE Supabase database but have SEPARATE Redis
 * instances, so each environment's sweeps must only touch rows its own
 * orchestrator claimed. Everything below is what the sweeps depend on.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  getRuntimeEnv,
  scopeToRuntimeEnv,
  PRODUCTION_RUNTIME_ENV,
  LEGACY_PRODUCTION_SCAN_FILTER,
} from "../runtime-env.js"

const SAVED: Record<string, string | undefined> = {}
const KEYS = ["RUNTIME_ENV", "RAILWAY_ENVIRONMENT_NAME"] as const

beforeEach(() => {
  for (const k of KEYS) {
    SAVED[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED[k]
  }
})

describe("getRuntimeEnv precedence", () => {
  it("prefers RUNTIME_ENV over RAILWAY_ENVIRONMENT_NAME", () => {
    process.env.RUNTIME_ENV = "staging"
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    expect(getRuntimeEnv()).toBe("staging")
  })

  it("falls back to Railway's environment name", () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    expect(getRuntimeEnv()).toBe("production")
  })

  it("defaults to \"local\" when neither is set", () => {
    expect(getRuntimeEnv()).toBe("local")
  })

  it("treats a blank value as unset (a docker-compose `RUNTIME_ENV=` line)", () => {
    process.env.RUNTIME_ENV = "   "
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    expect(getRuntimeEnv()).toBe("production")
  })

  it("reads process.env at call time — never memoized at import", () => {
    process.env.RUNTIME_ENV = "staging"
    expect(getRuntimeEnv()).toBe("staging")
    process.env.RUNTIME_ENV = "production"
    expect(getRuntimeEnv()).toBe("production")
  })
})

describe("scopeToRuntimeEnv", () => {
  /** Minimal stand-in for the PostgREST filter builder: records the filter. */
  function makeQuery() {
    const calls: Array<{ method: "eq" | "or"; args: string[] }> = []
    const q = {
      calls,
      eq(column: string, value: string) {
        calls.push({ method: "eq", args: [column, value] })
        return this
      },
      or(filters: string) {
        calls.push({ method: "or", args: [filters] })
        return this
      },
    }
    return q
  }

  it("scopes a non-production environment to its own rows only", () => {
    const q = scopeToRuntimeEnv(makeQuery(), "staging")
    expect(q.calls).toEqual([{ method: "eq", args: ["runtime_env", "staging"] }])
  })

  it("lets production also claim legacy rows (NULL runtime_env)", () => {
    const q = scopeToRuntimeEnv(makeQuery(), PRODUCTION_RUNTIME_ENV)
    expect(q.calls).toEqual([{ method: "or", args: [LEGACY_PRODUCTION_SCAN_FILTER] }])
    expect(LEGACY_PRODUCTION_SCAN_FILTER).toBe("runtime_env.eq.production,runtime_env.is.null")
  })

  it("defaults to the live environment when no env is passed", () => {
    process.env.RUNTIME_ENV = "preview-42"
    const q = scopeToRuntimeEnv(makeQuery())
    expect(q.calls).toEqual([{ method: "eq", args: ["runtime_env", "preview-42"] }])
  })
})
