import { describe, expect, it, vi } from "vitest"
vi.mock("../../config.js", () => ({ config: { SCENE3D_STAGE_REDIS_URL: "" } }))
vi.mock("../scene3d-artifact-toolkit.js", () => ({ authorizeScene3DJob: vi.fn() }))
import { assertScene3DJournalPersistence, createDurableScene3DStageJournal } from "../scene3d-stage-storage.js"
const valid = ["appendonly", "yes", "appendfsync", "always", "maxmemory-policy", "noeviction", "no-appendfsync-on-rewrite", "no"]
describe("durable scene stage storage", () => {
  it("does not fall back to shared Redis when the dedicated journal is absent", () => {
    expect(createDurableScene3DStageJournal()).toBeUndefined()
  })
  it("accepts synchronous append-only persistence without eviction", () => {
    expect(() => assertScene3DJournalPersistence(valid)).not.toThrow()
  })
  it.each([["appendonly", "no"], ["appendfsync", "everysec"], ["maxmemory-policy", "allkeys-lru"],
    ["no-appendfsync-on-rewrite", "yes"]])("refuses unsafe %s=%s", (key, value) => {
    const settings = [...valid]; settings[settings.indexOf(key) + 1] = value
    expect(() => assertScene3DJournalPersistence(settings)).toThrow("requires append-only")
  })
  it.each([null, [], ["appendonly"], { appendonly: "yes" }])("fails closed on unverifiable persistence", raw => {
    expect(() => assertScene3DJournalPersistence(raw)).toThrow()
  })
})
