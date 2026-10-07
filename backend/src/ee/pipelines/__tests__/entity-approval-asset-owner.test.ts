/**
 * An approved entity lands on the canvas with its main image only when the
 * pipeline's owner made that asset (decided 2026-10-07; migration 480).
 *
 * `pipeline_entities.main_asset_id` names an asset by id. Read back with the
 * service role, a pointer at another user's asset would put that user's
 * private image URL on this user's canvas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../events.js", () => ({ pipelineEvents: { publish: vi.fn() } }))
vi.mock("../depends-on.js", () => ({ transitionEntityNodeAndEmit: vi.fn(async () => undefined) }))
vi.mock("../services/canvas-materializer.js", () => ({ materializeEntityOnCanvas: vi.fn(async () => undefined) }))

import { approveEntityCore } from "../entity-approval.js"
import { materializeEntityOnCanvas } from "../services/canvas-materializer.js"

/**
 * A fixture asset id: `assets.id` is a uuid column, and the ownership lookup
 * only asks about uuid-shaped ids, so a named fixture asset maps to a stable
 * uuid (one per name, in first-use order).
 */
const fixtureAssetIds = new Map<string, string>()
function aid(name: string): string {
  let id = fixtureAssetIds.get(name)
  if (!id) {
    id = `00000000-0000-4000-8000-${String(fixtureAssetIds.size + 1).padStart(12, "0")}`
    fixtureAssetIds.set(name, id)
  }
  return id
}

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)))
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push((row) => row[col] === val)
          return chain
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((row) => vals.includes(row[col]))
          return chain
        },
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      }
      return chain
    },
  } as never
}

const PIPELINE = "pipe-1"
const OWNER = "owner-1"

beforeEach(() => vi.clearAllMocks())

describe("approveEntityCore — the canvas node's main image", () => {
  it("uses the owner's own asset", async () => {
    const supabase = fakeSupabase({
      pipelines: [{ id: PIPELINE, user_id: OWNER }],
      pipeline_entities: [{ id: "ent-1", entity_type: "character", entity_key: "hero", metadata: {}, main_asset_id: aid("own") }],
      assets: [{ id: aid("own"), user_id: OWNER, r2_url: "https://r2/own.png" }],
    })
    await approveEntityCore(supabase, PIPELINE, { id: "ent-1", entity_type: "character", entity_key: "hero" })
    expect(materializeEntityOnCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ mainAssetId: aid("own"), mainAssetUrl: "https://r2/own.png" }),
    )
  })

  it("attacker: a main_asset_id naming another user's asset puts nothing on the canvas", async () => {
    const supabase = fakeSupabase({
      pipelines: [{ id: PIPELINE, user_id: OWNER }],
      // Written before migration 480: the pointer names the victim's asset.
      pipeline_entities: [{ id: "ent-1", entity_type: "character", entity_key: "hero", metadata: {}, main_asset_id: aid("foreign") }],
      assets: [{ id: aid("foreign"), user_id: "victim", r2_url: "https://r2/victims-private.png" }],
    })
    await approveEntityCore(supabase, PIPELINE, { id: "ent-1", entity_type: "character", entity_key: "hero" })
    expect(materializeEntityOnCanvas).not.toHaveBeenCalled()
  })

  it("attacker: a scene with a foreign main_asset_id materializes without it", async () => {
    const supabase = fakeSupabase({
      pipelines: [{ id: PIPELINE, user_id: OWNER }],
      pipeline_entities: [{ id: "ent-s", entity_type: "scene", entity_key: "scene_01", metadata: {}, main_asset_id: aid("foreign") }],
      assets: [{ id: aid("foreign"), user_id: "victim", r2_url: "https://r2/victims-private.png" }],
    })
    await approveEntityCore(supabase, PIPELINE, { id: "ent-s", entity_type: "scene", entity_key: "scene_01" })
    expect(materializeEntityOnCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ mainAssetId: null, mainAssetUrl: null }),
    )
  })
})
