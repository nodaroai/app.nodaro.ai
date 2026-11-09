/**
 * `GET /v1/storage/status` under a deployment payer (decided 2026-11-08).
 *
 * Under a payer, no per-user storage ceiling is enforced: `checkStorageQuota`
 * answers `{ allowed: true }` there, with no figures
 * (utils/file-validation.ts). This route then read figures that were not there,
 * and answered 500 to every user on the instance. That broke every client
 * storage meter. Under a payer it reports the tracked usage and no limit
 * (`limitBytes: null`, "unlimited"), and stamps no warning crossing. The usage
 * is read in utils/file-validation.ts (`readTrackedStorageBytes`): this route
 * holds no service-role client of its own.
 * Without a payer it is untouched (storage-status.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  recordStorageWarnCrossing: vi.fn(async () => {}),
  // What the real `checkStorageQuota` answers under a deployment payer.
  checkStorageQuota: vi.fn(async () => ({ allowed: true })),
  readTrackedStorageBytes: vi.fn(async (): Promise<number | null> => 123_456),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/utils/file-validation.js", () => ({
  checkStorageQuota: h.checkStorageQuota,
  readTrackedStorageBytes: h.readTrackedStorageBytes,
}))
vi.mock("@/lib/storage-warn.js", () => ({ recordStorageWarnCrossing: h.recordStorageWarnCrossing, STORAGE_WARN_RATIO: 0.85 }))

import { storageStatusRoutes } from "../storage-status.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "@/lib/deployment-payer.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.readTrackedStorageBytes.mockResolvedValue(123_456)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(storageStatusRoutes)
  await app.ready()
})

afterEach(async () => {
  __resetDeploymentPayerForTests()
  await app.close()
})

describe("GET /v1/storage/status under a deployment payer", () => {
  it("reports the tracked usage and no limit, not a 500", async () => {
    __setDeploymentPayerForTests(PAYER, { tierForGates: "free" })
    const res = await app.inject({ method: "GET", url: "/v1/storage/status" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ usedBytes: 123_456, limitBytes: null })
    expect(h.readTrackedStorageBytes).toHaveBeenCalledWith(USER)
    expect(h.checkStorageQuota).not.toHaveBeenCalled()
    expect(h.recordStorageWarnCrossing).not.toHaveBeenCalled()
  })

  it("a usage counter that cannot be read is still a 500 (a real fault, not a figure)", async () => {
    __setDeploymentPayerForTests(PAYER)
    h.readTrackedStorageBytes.mockResolvedValue(null)
    const res = await app.inject({ method: "GET", url: "/v1/storage/status" })
    expect(res.statusCode).toBe(500)
  })

  it("without a payer the quota path is untouched", async () => {
    h.checkStorageQuota.mockResolvedValueOnce({ allowed: true, usedBytes: 10, quotaBytes: 100 } as never)
    const res = await app.inject({ method: "GET", url: "/v1/storage/status" })
    expect(res.json()).toEqual({ usedBytes: 10, limitBytes: 100 })
    expect(h.readTrackedStorageBytes).not.toHaveBeenCalled()
  })
})
