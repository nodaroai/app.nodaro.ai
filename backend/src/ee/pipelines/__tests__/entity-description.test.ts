/**
 * Phase 3 — entity-description helpers (Step A approval).
 *
 * Covers the two helpers' contract:
 *   - approveDescriptionLlmOrEdited: status CAS, metadata write only when
 *     newDescription provided, SSE emit, error returns for missing/wrong state.
 *   - attachUploadedImageToEntity: asset insert, main_asset_id set, status flip
 *     to approved, URL-derivation when filename/mime/size omitted, runCritic
 *     defensive guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn(), subscribe: vi.fn(() => () => undefined) },
}))

import {
  approveDescriptionLlmOrEdited,
  attachUploadedImageToEntity,
} from "../entity-description.js"
import { pipelineEvents } from "../events.js"

// ─── In-memory Supabase mock ────────────────────────────────────────────────

interface EntityRow {
  id: string
  pipeline_id: string
  entity_type: string
  entity_key: string
  status: string
  metadata: Record<string, unknown> | null
  main_asset_id?: string | null
}

interface AssetRow {
  id: string
  user_id: string
  type: string
  filename: string
  mime_type: string
  size_bytes: number
  r2_key: string
  r2_url: string
  upload_source: string
  pipeline_id: string
  pipeline_entity_id: string
}

interface MockState {
  entities: EntityRow[]
  /** All asset inserts captured for assertion. */
  assetInserts: AssetRow[]
  /** Force the asset insert to fail (simulates db_error). */
  forceAssetInsertFail?: boolean
  /** Force the entity UPDATE CAS to return 0 rows (race-loss simulator). */
  forceEntityCasMiss?: boolean
  /** Counter for generated asset ids. */
  assetIdCounter: number
}

function makeSupabase(state: MockState): unknown {
  return {
    from: (table: string) => {
      if (table === "pipeline_entities") {
        return {
          select: () => ({
            eq: (col1: string, val1: unknown) => ({
              eq: (col2: string, val2: unknown) => ({
                maybeSingle: async () => {
                  const row = state.entities.find(
                    (e) =>
                      (e as unknown as Record<string, unknown>)[col1] === val1 &&
                      (e as unknown as Record<string, unknown>)[col2] === val2,
                  )
                  return { data: row ?? null, error: null }
                },
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            const filters: Record<string, unknown> = {}
            const chain = {
              eq: (col: string, v: unknown) => {
                filters[col] = v
                return chain
              },
              select: (_cols: string) => ({
                then: async (
                  resolve: (v: {
                    data: { id: string }[] | null
                    error: null
                  }) => unknown,
                ) => {
                  if (state.forceEntityCasMiss) {
                    return resolve({ data: [], error: null })
                  }
                  const matched: { id: string }[] = []
                  for (const row of state.entities) {
                    const allMatch = Object.entries(filters).every(
                      ([k, v]) =>
                        (row as unknown as Record<string, unknown>)[k] === v,
                    )
                    if (allMatch) {
                      Object.assign(row, patch)
                      matched.push({ id: row.id })
                    }
                  }
                  return resolve({ data: matched, error: null })
                },
              }),
            }
            return chain
          },
        }
      }
      if (table === "assets") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: (_cols: string) => ({
              single: async () => {
                if (state.forceAssetInsertFail) {
                  return { data: null, error: { message: "db down" } }
                }
                const id = `asset-${++state.assetIdCounter}`
                const stored: AssetRow = {
                  id,
                  user_id: row.user_id as string,
                  type: row.type as string,
                  filename: row.filename as string,
                  mime_type: row.mime_type as string,
                  size_bytes: row.size_bytes as number,
                  r2_key: row.r2_key as string,
                  r2_url: row.r2_url as string,
                  upload_source: row.upload_source as string,
                  pipeline_id: row.pipeline_id as string,
                  pipeline_entity_id: row.pipeline_entity_id as string,
                }
                state.assetInserts.push(stored)
                return { data: { id }, error: null }
              },
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

function freshEntity(
  overrides?: Partial<EntityRow> & { initialStatus?: string },
): EntityRow {
  return {
    id: "entity-1",
    pipeline_id: "pipeline-1",
    entity_type: "character",
    entity_key: "captain_hayes",
    status: overrides?.initialStatus ?? "pending_description",
    metadata: {
      name: "Captain Hayes",
      visual_description: "Late-30s pilot, tan flight suit",
      role: "protagonist",
    },
    main_asset_id: null,
    ...overrides,
  }
}

function freshState(opts: {
  entity?: EntityRow
  forceAssetInsertFail?: boolean
  forceEntityCasMiss?: boolean
} = {}): MockState {
  return {
    entities: [opts.entity ?? freshEntity()],
    assetInserts: [],
    assetIdCounter: 0,
    forceAssetInsertFail: opts.forceAssetInsertFail,
    forceEntityCasMiss: opts.forceEntityCasMiss,
  }
}

beforeEach(() => vi.clearAllMocks())

// ─── approveDescriptionLlmOrEdited ──────────────────────────────────────────

describe("approveDescriptionLlmOrEdited", () => {
  it("mode='llm' (no newDescription) flips status without touching metadata", async () => {
    const state = freshState()
    const result = await approveDescriptionLlmOrEdited({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.newStatus).toBe("pending")
    const entity = state.entities[0]!
    expect(entity.status).toBe("pending")
    // visual_description unchanged
    expect((entity.metadata as Record<string, unknown>).visual_description).toBe(
      "Late-30s pilot, tan flight suit",
    )
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "entity:status",
        status: "pending",
        entityId: "entity-1",
      }),
    )
  })

  it("mode='user_edited' writes the new visual_description into metadata", async () => {
    const state = freshState()
    await approveDescriptionLlmOrEdited({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
      newDescription: "70s veteran, military haircut, scar on left cheek",
    })
    const entity = state.entities[0]!
    expect(entity.status).toBe("pending")
    expect((entity.metadata as Record<string, unknown>).visual_description).toBe(
      "70s veteran, military haircut, scar on left cheek",
    )
    // Other metadata preserved
    expect((entity.metadata as Record<string, unknown>).name).toBe("Captain Hayes")
  })

  it("rejects when entity is not in pending_description state", async () => {
    const state = freshState({ entity: freshEntity({ initialStatus: "approved" }) })
    const result = await approveDescriptionLlmOrEdited({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("entity_not_pending_description")
  })

  it("returns entity_not_found when entity row doesn't exist", async () => {
    const state = freshState({ entity: freshEntity({ id: "different-entity" }) })
    const result = await approveDescriptionLlmOrEdited({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("entity_not_found")
  })

  it("returns entity_not_pending_description on CAS-lost race (concurrent approval)", async () => {
    const state = freshState({ forceEntityCasMiss: true })
    const result = await approveDescriptionLlmOrEdited({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("entity_not_pending_description")
  })
})

// ─── attachUploadedImageToEntity ────────────────────────────────────────────

describe("attachUploadedImageToEntity", () => {
  it("creates an assets row + flips entity to approved with main_asset_id set", async () => {
    const state = freshState()
    const result = await attachUploadedImageToEntity({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
      userId: "user-1",
      assetUrl: "https://r2.example.com/uploads/captain.jpg",
      filename: "captain.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12345,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newStatus).toBe("approved")
      expect(result.assetId).toBe("asset-1")
    }
    expect(state.assetInserts).toHaveLength(1)
    const asset = state.assetInserts[0]!
    expect(asset).toMatchObject({
      user_id: "user-1",
      type: "image",
      filename: "captain.jpg",
      mime_type: "image/jpeg",
      size_bytes: 12345,
      r2_url: "https://r2.example.com/uploads/captain.jpg",
      r2_key: "uploads/captain.jpg",
      upload_source: "manual_upload",
      pipeline_id: "pipeline-1",
      pipeline_entity_id: "entity-1",
    })
    const entity = state.entities[0]!
    expect(entity.status).toBe("approved")
    expect(entity.main_asset_id).toBe("asset-1")
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "entity:status",
        status: "approved",
        mainAssetUrl: "https://r2.example.com/uploads/captain.jpg",
      }),
    )
  })

  it("derives filename + mime_type + r2_key from URL when those fields are omitted", async () => {
    const state = freshState()
    await attachUploadedImageToEntity({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
      userId: "user-1",
      assetUrl: "https://r2.example.com/uploads/abc-123.png",
      // no filename, no mimeType, no sizeBytes
    })
    const asset = state.assetInserts[0]!
    expect(asset.filename).toBe("abc-123.png")
    expect(asset.mime_type).toBe("image/png") // derived from .png extension
    expect(asset.r2_key).toBe("uploads/abc-123.png")
    expect(asset.size_bytes).toBe(0) // default
  })

  it("returns asset_insert_failed when the assets INSERT errors", async () => {
    const state = freshState({ forceAssetInsertFail: true })
    const result = await attachUploadedImageToEntity({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
      userId: "user-1",
      assetUrl: "https://r2.example.com/uploads/captain.jpg",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("asset_insert_failed")
    // Entity must NOT be flipped if asset insert failed.
    expect(state.entities[0]!.status).toBe("pending_description")
  })

  it("rejects when entity isn't in pending_description (idempotency / race protection)", async () => {
    const state = freshState({ entity: freshEntity({ initialStatus: "approved" }) })
    const result = await attachUploadedImageToEntity({
      supabase: makeSupabase(state) as never,
      pipelineId: "pipeline-1",
      entityId: "entity-1",
      userId: "user-1",
      assetUrl: "https://r2.example.com/uploads/captain.jpg",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("entity_not_pending_description")
    // No asset should be inserted when entity is in the wrong state.
    expect(state.assetInserts).toHaveLength(0)
  })

  it("throws when runCritic=true (defensive guard — D2 override not wired in Phase 3)", async () => {
    const state = freshState()
    await expect(
      attachUploadedImageToEntity({
        supabase: makeSupabase(state) as never,
        pipelineId: "pipeline-1",
        entityId: "entity-1",
        userId: "user-1",
        assetUrl: "https://r2.example.com/uploads/captain.jpg",
        runCritic: true,
      }),
    ).rejects.toThrow(/runCritic=true is not wired in Phase 3/)
  })
})
