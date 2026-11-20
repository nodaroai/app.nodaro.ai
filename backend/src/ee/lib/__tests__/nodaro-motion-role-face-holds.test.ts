import { describe, expect, it } from "vitest"
import type { EngineEnvironment } from "../engine-environments.js"
import {
  environmentsThatCannotTakeRoleFace,
  environmentsWhosePlatformCannotTakeRoleFace,
  faceChipChanged,
  roleFacePlatformHold,
  roleFaceTrendRefusal,
} from "../nodaro-motion-role-face-holds.js"
import type { TrendSlot } from "../trends/types.js"

/**
 * The Face chip on a trend's person slot (decided 2026-11-20): a trend stores it only once every environment's
 * platform claims `roleFace`, fresh (422, held first: an older platform's strict slot schema refuses the key, any
 * value), and, when its runs can keep a face, every environment's engine declares `castSwap.roleFace` (409). Held only
 * on a change; taking it away never is.
 */
const NOW = Date.parse("2026-11-20T12:00:00.000Z")
const ENGINE = { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: [], trendRun: true, roleFace: true }
const env = (name: string, castSwap: Record<string, unknown>, platform?: Record<string, unknown>, at = "2026-11-20T11:59:00.000Z"): EngineEnvironment => ({
  env: name,
  pluginBuildId: null,
  supports: { castSwap } as EngineEnvironment["supports"],
  updatedAt: "2026-11-20T00:00:00.000Z",
  ...(platform ? { platformClaim: { supports: platform, at } } : {}),
})
const both = (castSwap: Record<string, unknown>, platform?: Record<string, unknown>) => [env("staging", castSwap, platform), env("production", castSwap, platform)]

const person = (over: Partial<Extract<TrendSlot, { kind: "person" }>> = {}): TrendSlot => ({ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the singer", ...over })
const NONE = { slots: [person()] }
const OFFERED = { slots: [person({ chips: ["body", "outfit", "hair", "face"] })] }
const KEPT = { slots: [person({ defaults: { face: "original" } })] }
const NEW_ONLY = { slots: [person({ defaults: { face: "new" } })] }

describe("the sides", () => {
  it("name each environment whose engine or platform does not take it (none recorded, or a stale claim, too)", () => {
    expect(environmentsThatCannotTakeRoleFace(both(ENGINE))).toEqual([])
    expect(environmentsThatCannotTakeRoleFace([env("staging", ENGINE), env("production", { ...ENGINE, roleFace: undefined })])).toEqual(["production"])
    expect(environmentsThatCannotTakeRoleFace([env("staging", ENGINE)])).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakeRoleFace(both(ENGINE, { roleFace: true }), NOW)).toEqual([])
    expect(environmentsWhosePlatformCannotTakeRoleFace([env("staging", ENGINE, { roleFace: true }), env("production", ENGINE)], NOW)).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakeRoleFace(both(ENGINE, { roleFace: true }).map((e) => ({ ...e, platformClaim: { supports: { roleFace: true }, at: "2026-11-20T10:00:00.000Z" } })), NOW)).toEqual(["staging", "production"])
  })

  it("the platform hold says why, per context", () => {
    expect(roleFacePlatformHold("trend", both(ENGINE, { roleFace: true }), NOW)).toBeNull()
    expect(roleFacePlatformHold("publish", [env("staging", ENGINE, { roleFace: true }), env("production", ENGINE)], NOW)).toEqual({
      code: "platform_unsupported",
      message: expect.stringContaining("The platform in production does not take the Face chip yet"),
      envs: ["production"],
    })
  })
})

describe("a trend draft's change of its Face chip (`roleFaceTrendRefusal`)", () => {
  const lacking = [env("staging", ENGINE), env("production", { ...ENGINE, roleFace: undefined }, { roleFace: true })]
  const platforms = lacking.map((e) => ({ ...e, platformClaim: { supports: { roleFace: true }, at: "2026-11-20T11:59:00.000Z" } }))

  it("holds a change that stores it: the platform first (422), then the engine (409)", () => {
    for (const next of [OFFERED, KEPT]) {
      expect(roleFaceTrendRefusal(next, NONE, lacking, NOW)).toMatchObject({ status: 422, error: { code: "platform_unsupported", envs: ["staging"] } })
      expect(roleFaceTrendRefusal(next, NONE, platforms, NOW)).toMatchObject({ status: 409, error: { code: "engine_unsupported", envs: ["production"] } })
      expect(roleFaceTrendRefusal(next, NONE, both(ENGINE, { roleFace: true }), NOW)).toBeNull()
    }
  })

  it('holds a stored "new" on the platform only: no engine is asked to keep a face', () => {
    expect(roleFaceTrendRefusal(NEW_ONLY, NONE, lacking, NOW)?.status).toBe(422)
    expect(roleFaceTrendRefusal(NEW_ONLY, NONE, platforms, NOW)).toBeNull()
  })

  it("never holds what the draft already stores, nor taking it away", () => {
    expect(faceChipChanged(OFFERED, OFFERED)).toBe(false)
    expect(roleFaceTrendRefusal(OFFERED, OFFERED, lacking, NOW)).toBeNull()
    expect(roleFaceTrendRefusal(NONE, OFFERED, lacking, NOW)).toBeNull()
    expect(roleFaceTrendRefusal(NONE, undefined, lacking, NOW)).toBeNull()
    expect(faceChipChanged(KEPT, OFFERED)).toBe(true)
  })
})
