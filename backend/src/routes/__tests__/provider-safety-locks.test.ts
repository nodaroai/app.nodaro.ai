/** `GET /v1/provider-safety/locks`: which models' node filter checkbox is locked on. */
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"

const h = vi.hoisted(() => ({ overrides: {} as Record<string, Record<string, boolean | number>> }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ provider_safety_overrides: h.overrides }) }))

import { providerSafetyLocksRoutes } from "../provider-safety-locks.js"

beforeEach(() => {
  h.overrides = {}
})

async function forcedOn(): Promise<string[]> {
  const app = Fastify()
  await app.register(providerSafetyLocksRoutes)
  const res = await app.inject({ method: "GET", url: "/v1/provider-safety/locks" })
  expect(res.statusCode).toBe(200)
  return (res.json() as { forcedOn: string[] }).forcedOn
}

describe("GET /v1/provider-safety/locks", () => {
  it("is empty with nothing set, and on a model an admin did not force", async () => {
    expect(await forcedOn()).toEqual([])
    h.overrides = { qwen: { enable_safety_checker: true }, "flux-2-pro": { safety_tolerance: 2 } }
    expect(await forcedOn()).toEqual([])
  })

  it("names the models with the node filter forced on, and nothing else about them", async () => {
    h.overrides = { "seedance-2": { nsfw_checker: true }, "seedance-2-fast": { nsfw_checker: false } }
    expect(await forcedOn()).toEqual(["seedance-2"])
  })
})
