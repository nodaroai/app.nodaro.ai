/**
 * A pipeline placing an approved entity on its canvas writes the stored graph
 * back with the new node (decided 2026-11-13): a stored Seedance reference
 * task type no model its node runs lists goes — that one key, nothing else
 * (`withListedReferenceTaskTypes`) — and a graph without one is written back
 * as it was read.
 */
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

vi.mock("../../../../lib/new-node-models.js", () => ({
  withOfferedServerNodeModels: async (nodes: unknown[]) => ({ nodes, moved: [] }),
}))

import { materializeEntityOnCanvas } from "../canvas-materializer.js"

const at = { x: 0, y: 0 }
const KLING = { id: "kling", type: "generate-video", position: at, data: { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", referenceTaskType: "edit" } }
const SD25 = { id: "sd25", type: "generate-video", position: at, data: { provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" } }
const IMG = { id: "img", type: "generate-image", position: at, data: { provider: "gpt-image", aspectRatio: "16:9", resolution: "2K" } }
const KLING_STORED = { id: "kling", type: "generate-video", position: at, data: { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9" } }

/** A client whose workflow holds `stored`; returns the node list the update writes. */
async function place(stored: unknown[]): Promise<unknown[]> {
  let written: unknown[] | undefined
  const chain = (table: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq"]) c[m] = () => c
    c.maybeSingle = async () => ({ data: null, error: null })
    c.single = async () => ({ data: table === "pipelines" ? { workflow_id: "wf-1" } : { nodes: stored }, error: null })
    c.update = (row: { nodes: unknown[] }) => {
      written = row.nodes
      return { eq: async () => ({ error: null }) }
    }
    c.insert = async () => ({ error: null })
    return c
  }
  await materializeEntityOnCanvas({
    supabase: { from: chain } as unknown as SupabaseClient,
    pipelineId: "p-1",
    pipelineEntityId: "e-1",
    entityType: "character",
    entityKey: "hero",
    entityName: "Hero",
    visualDescription: "a hero",
    mainAssetId: null,
    mainAssetUrl: null,
    position: at,
  })
  expect(written).toBeDefined()
  return written!
}

describe("a pipeline entity placed on the canvas", () => {
  it("the stored Kling node loses only that key; the rest of the stored graph is written back as read, the entity node added", async () => {
    const written = await place([KLING, SD25, IMG])
    expect(written.slice(0, 3)).toStrictEqual([KLING_STORED, SD25, IMG])
    expect(written[1]).toBe(SD25)
    expect(written).toHaveLength(4)
  })

  it("a stored graph without the field is written back as read", async () => {
    const written = await place([SD25, IMG])
    expect(written[0]).toBe(SD25)
    expect(written[1]).toBe(IMG)
    expect(JSON.stringify(written.slice(0, 2))).toBe(JSON.stringify([SD25, IMG]))
  })
})
