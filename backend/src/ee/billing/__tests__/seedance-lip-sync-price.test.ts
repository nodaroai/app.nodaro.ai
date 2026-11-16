// @test-units-by-name looks up only the Seedance lip-sync credit rows it names
// @test-watches backend/src/**/*.ts
/**
 * A Seedance Lip Sync run (a portrait plus the voice line as reference AUDIO,
 * no reference video, 8 s) is priced on the model's PLAIN row at the
 * resolution it sends (decided 2026-11-16; measured: a direct run of image +
 * reference audio was billed the plain rate). The route, the workflow run and
 * the estimate name the same row, which is seeded, for every family member and
 * every resolution the Lip Sync surface takes — and the workflow run sends the
 * resolution it priced.
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { isSeedanceLipSyncProvider, seedanceLipSyncCreditId, seedanceLipSyncResolution } from "@nodaro/shared/credits"
import { SEEDANCE_LIP_SYNC_PROVIDERS } from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { resolveLipSyncIdentifier } from "../../../routes/lip-sync.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { pipelineLipSyncPricing } from "../../pipelines/services/pipeline-lip-sync.js"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const FAMILY = ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5", "seedance-2-5-flash"]
/** Every value the Lip Sync route's resolution takes, and none. */
const ASKED = [undefined, "480p", "720p", "1080p", "4k"]

describe("Seedance Lip Sync price", () => {
  it("covers exactly the Seedance members of the Lip Sync family (MiniMax Hailuo 3 keeps its own rule)", () => {
    expect([...SEEDANCE_LIP_SYNC_PROVIDERS].filter(isSeedanceLipSyncProvider).sort()).toEqual([...FAMILY].sort())
    expect(isSeedanceLipSyncProvider("minimax-h3")).toBe(false)
    expect(resolveLipSyncIdentifier({ provider: "minimax-h3" })).toBe("minimax-h3:8s")
  })

  for (const provider of FAMILY) {
    for (const resolution of ASKED) {
      it(`${provider} @ ${resolution ?? "none"}: route = workflow run = estimate, a plain seeded row, and the sent resolution is the priced one`, () => {
        const id = seedanceLipSyncCreditId(provider, resolution)
        expect(id).not.toMatch(/-ref$/)
        expect(STATIC_CREDIT_COSTS[id], id).toBeTypeOf("number")
        expect(resolveLipSyncIdentifier({ provider, resolution })).toBe(id)
        const data = { provider, ...(resolution ? { resolution } : {}) }
        const built = buildPayload({ id: "n", type: "lip-sync", data }, "job-1", { imageUrl: "https://cdn/x.png", audioUrl: "https://cdn/a.mp3" })
        expect(built.modelIdentifier).toBe(id)
        expect((built.payload as { resolution?: string }).resolution).toBe(seedanceLipSyncResolution(provider, resolution))
        expect(getNodeModelIdentifier({ type: "lip-sync", data }, {})).toBe(id)
        // The film pipeline's Lip Sync step reserves and sends the same.
        expect(pipelineLipSyncPricing(provider, resolution, undefined)).toEqual({ modelIdentifier: id, resolution: seedanceLipSyncResolution(provider, resolution) })
        // The resolution is one the model renders.
        expect(MODEL_CATALOG[provider]!.resolutions).toContain(seedanceLipSyncResolution(provider, resolution))
      })
    }
  }

  for (const resolution of ASKED) {
    it(`minimax-h3 @ ${resolution ?? "none"}: route = workflow run = pipeline = estimate = minimax-h3:8s (decided 2026-11-16), a seeded row, and what is sent is unchanged`, () => {
      const id = "minimax-h3:8s"
      expect(STATIC_CREDIT_COSTS[id]).toBeTypeOf("number")
      expect(resolveLipSyncIdentifier({ provider: "minimax-h3", resolution })).toBe(id)
      const data = { provider: "minimax-h3", ...(resolution ? { resolution } : {}) }
      const built = buildPayload({ id: "n", type: "lip-sync", data }, "job-1", { imageUrl: "https://cdn/x.png", audioUrl: "https://cdn/a.mp3" })
      expect(built.modelIdentifier).toBe(id)
      expect((built.payload as { resolution?: string }).resolution).toBe(resolution)
      expect(getNodeModelIdentifier({ type: "lip-sync", data }, {})).toBe(id)
      expect(pipelineLipSyncPricing("minimax-h3", resolution, undefined)).toEqual({ modelIdentifier: id, resolution })
    })
  }

  it("clamps an unrendered resolution to the model's top tier, and defaults to 720p", () => {
    expect(seedanceLipSyncCreditId("seedance-2", "4k")).toBe("seedance-2:8s:4k")
    expect(seedanceLipSyncCreditId("seedance-2-fast", "4k")).toBe("seedance-2-fast:8s:720p")
    expect(seedanceLipSyncCreditId("seedance-2-mini", "1080p")).toBe("seedance-2-mini:8s:720p")
    expect(seedanceLipSyncCreditId("seedance-2-5", "4k")).toBe("seedance-2-5:8s:1080p")
    expect(seedanceLipSyncCreditId("seedance-2-5-flash", "1080p")).toBe("seedance-2-5-flash:8s:720p")
    expect(seedanceLipSyncCreditId("seedance-2-5-flash")).toBe("seedance-2-5-flash:8s:720p")
  })
})

describe("no file builds a Seedance lip-sync credit id by hand", () => {
  it("no Lip Sync source writes a Seedance `:8s:` row itself; every one calls seedanceLipSyncCreditId", () => {
    const src = join(fileURLToPath(new URL(".", import.meta.url)), "../../..")
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (name === "__tests__" || name === "node_modules") return []
        return statSync(path).isDirectory() ? walk(path) : name.endsWith(".ts") ? [path] : []
      })
    // A template that names a provider and an 8-second lip-sync row with a resolution (and, before 2026-11-16, `-ref`).
    const handBuilt = /`\$\{provider\}:8s:\$\{[^}]+\}(-ref)?`/
    // A Lip Sync source: one that names the lane. (The reference-video rows of
    // Generate Video and Edit Video Pro build their own `:8s:<res>-ref` rates.)
    const lipSync = /lip[-_ ]?sync/i
    const offenders = walk(src)
      .filter((f) => {
        const text = readFileSync(f, "utf8")
        return lipSync.test(text) && handBuilt.test(text)
      })
      .map((f) => relative(src, f))
    expect(offenders).toEqual([])
  })
})
