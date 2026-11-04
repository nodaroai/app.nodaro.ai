// @test-watches supabase/migrations/*.sql
// @test-units-by-name prices the models it names, no node type
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { KIE_CREDIT_USD, KIE_IMAGE_MODELS } from "../../../providers/kie/models.js"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * Seedance 2.5 at 1080p and GPT Image 2 at 2K / 4K.
 *
 * Seedance 2.5's 1080p rows sit on KIE's rates of 158 cr/s with no video and
 * 95 cr/s with a video, through the table's own conversion:
 *   credits = ceil(rate × seconds / 4) × 10
 * the same rates as the finalize rows (`seedance-2-5-hd`), which render the
 * same resolution. GPT Image 2 is on the ladder GPT Image 2.5 already has, on
 * the same KIE rates of 6 / 10 / 16 cr at 1K / 2K / 4K.
 *
 * A `model_pricing` row outranks the static table, so a migration moves the
 * rows that still hold the old price. What that statement does on a database
 * (a retuned row stays, a missing row stays missing, a rerun is a no-op) is
 * proven by supabase/tests/seedance-1080p-gpt-image-2-prices.behavior.sql.
 */

const SECONDS = Array.from({ length: 27 }, (_, i) => i + 4)
const row = (rate: number, seconds: number) => Math.ceil((rate * seconds) / 4) * 10

const GPT_IMAGE_2_LADDER = { "": 15, ":2K": 25, ":4K": 40 } as const
const GPT_IMAGE_2_IDS = ["gpt-image-2", "gpt-image-2-i2i"] as const

describe("Seedance 2.5 at 1080p", () => {
  it("one row per second, 4-30 s, with no video: 158 cr/s", () => {
    for (const s of SECONDS) expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:1080p`], `${s}s`).toBe(row(158, s))
    expect(STATIC_CREDIT_COSTS["seedance-2-5:4s:1080p"]).toBe(1580)
    expect(STATIC_CREDIT_COSTS["seedance-2-5:8s:1080p"]).toBe(3160)
  })

  it("one row per second, 4-30 s, with a video: 95 cr/s", () => {
    for (const s of SECONDS) expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:1080p-ref`], `${s}s`).toBe(row(95, s))
    expect(STATIC_CREDIT_COSTS["seedance-2-5:4s:1080p-ref"]).toBe(950)
  })

  it("each row equals the finalize row of that length", () => {
    for (const s of SECONDS) {
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:1080p`], `${s}s`).toBe(STATIC_CREDIT_COSTS[`seedance-2-5-hd:${s}s`])
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:1080p-ref`], `${s}s-ref`).toBe(STATIC_CREDIT_COSTS[`seedance-2-5-hd:${s}s-ref`])
    }
  })

  it("480p, 720p, the bare id and the finalize rows keep their rates", () => {
    for (const s of SECONDS) {
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:480p`], `${s}s 480p`).toBe(row(28, s))
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:480p-ref`], `${s}s 480p-ref`).toBe(row(17, s))
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:720p`], `${s}s 720p`).toBe(row(63, s))
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:720p-ref`], `${s}s 720p-ref`).toBe(row(38, s))
      expect(STATIC_CREDIT_COSTS[`seedance-2-5-hd:${s}s`], `${s}s hd`).toBe(row(158, s))
      expect(STATIC_CREDIT_COSTS[`seedance-2-5-hd:${s}s-ref`], `${s}s hd-ref`).toBe(row(95, s))
    }
    expect(STATIC_CREDIT_COSTS["seedance-2-5"]).toBe(1260)
  })
})

describe("GPT Image 2", () => {
  it("15 / 25 / 40 at 1K / 2K / 4K, image-to-image too", () => {
    for (const id of GPT_IMAGE_2_IDS) {
      for (const [suffix, credits] of Object.entries(GPT_IMAGE_2_LADDER)) {
        expect(STATIC_CREDIT_COSTS[`${id}${suffix}`], `${id}${suffix}`).toBe(credits)
      }
    }
  })

  it("GPT Image 2.5 keeps the same ladder", () => {
    for (const id of ["gpt-image-2-5-flare", "gpt-image-2-5-flare-i2i", "gpt-image-2-5-sunburst", "gpt-image-2-5-sunburst-i2i"]) {
      for (const [suffix, credits] of Object.entries(GPT_IMAGE_2_LADDER)) {
        expect(STATIC_CREDIT_COSTS[`${id}${suffix}`], `${id}${suffix}`).toBe(credits)
      }
    }
  })

  it("the KIE config states 6 KIE credits at 1K, and the job's recorded cost is that many", () => {
    for (const id of GPT_IMAGE_2_IDS) {
      expect(KIE_IMAGE_MODELS[id]!.credits, id).toBe(6)
      expect(KIE_IMAGE_MODELS[id]!.cost, id).toBeCloseTo(6 * KIE_CREDIT_USD, 10)
    }
  })
})

describe("the model catalog lists what the table charges", () => {
  it.each(["gpt-image-2", "gpt-image-2-i2i", "seedance-2-5", "seedance-2-5-hd"])("%s", (id) => {
    const rows = MODEL_CATALOG[id]!.pricing ?? []
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(STATIC_CREDIT_COSTS[r.identifier], r.identifier).toBe(r.credits)
  })
})

describe("the migration moves each row only from its old price", () => {
  const dir = join(__dirname, "..", "..", "..", "..", "..", "supabase/migrations")
  const file = readdirSync(dir).find((f) => /^\d+_seedance_1080p_gpt_image_2_prices\.sql$/.test(f))
  const sql = file ? readFileSync(join(dir, file), "utf8") : ""
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
  const moved = new Map(
    statements.flatMap((s) => {
      const m = /^UPDATE public\.model_pricing SET credit_cost = (\d+) WHERE model_identifier = '([^']+)' AND credit_cost = (\d+)$/.exec(s)
      return m ? [[m[2]!, { from: Number(m[3]), to: Number(m[1]) }] as const] : []
    }),
  )

  it("every statement is one guarded single-row update, so nothing is created and no other column moves", () => {
    expect(file, "the migration file").toBeDefined()
    expect(statements.length).toBe(moved.size)
    expect(moved.size).toBe(27 * 2 + 4)
  })

  it("names exactly the rows that change, from the old prices to the table's", () => {
    const expected = new Map<string, { from: number; to: number }>()
    for (const s of SECONDS) {
      expected.set(`seedance-2-5:${s}s:1080p`, { from: row(114, s), to: STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:1080p`]! })
      expected.set(`seedance-2-5:${s}s:1080p-ref`, { from: row(68.5, s), to: STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:1080p-ref`]! })
    }
    for (const id of GPT_IMAGE_2_IDS) {
      expected.set(`${id}:2K`, { from: 30, to: STATIC_CREDIT_COSTS[`${id}:2K`]! })
      expected.set(`${id}:4K`, { from: 60, to: STATIC_CREDIT_COSTS[`${id}:4K`]! })
    }
    expect(Object.fromEntries(moved)).toEqual(Object.fromEntries(expected))
  })
})
