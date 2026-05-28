import { describe, it, expect, vi, beforeEach } from "vitest"

// The helper dynamic-imports ./events.js for the SSE publish — stub it so the
// import resolves without a real event bus.
vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

import { applyShotMutationAndEmit } from "../shot-recovery.js"

/**
 * Minimal Supabase stub that captures the `metadata` payload handed to
 * `.from("pipeline_entities").update({ metadata }).eq(...).eq(...)`. The final
 * `.eq()` is awaited, so the chain terminus is a thenable that also exposes
 * `.eq` (the route calls `.eq("id", …).eq("pipeline_id", …)`).
 */
function makeSupabase() {
  const captured: { metadata?: Record<string, unknown> } = {}
  const terminus = Promise.resolve({ error: null }) as Promise<{ error: null }> & {
    eq: () => typeof terminus
  }
  terminus.eq = () => terminus
  const chain = {
    update: (payload: { metadata: Record<string, unknown> }) => {
      captured.metadata = payload.metadata
      return chain
    },
    eq: () => terminus,
  }
  const supabase = { from: () => chain } as unknown as Parameters<
    typeof applyShotMutationAndEmit
  >[0]["supabase"]
  return { supabase, captured }
}

function makeReply() {
  const reply = {
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  }
  return reply as unknown as Parameters<typeof applyShotMutationAndEmit>[0]["reply"]
}

const baseSceneData = {
  shots: [
    { shot_id: "shot_01", video_critic_failed: true },
    { shot_id: "shot_02" },
  ],
  composite_video_url: "https://r2/old-composite.mp4",
  composite_video_asset_id: "old-composite-asset",
} as unknown as Parameters<typeof applyShotMutationAndEmit>[0]["sceneData"]

beforeEach(() => vi.clearAllMocks())

describe("applyShotMutationAndEmit — clearSceneComposite", () => {
  it("drops composite_video_url + composite_video_asset_id when clearSceneComposite is true (Regenerate)", async () => {
    const { supabase, captured } = makeSupabase()

    const ok = await applyShotMutationAndEmit({
      supabase,
      reply: makeReply(),
      pipelineId: "p1",
      sceneEntity: { id: "scene-1", metadata: { scene_node_data: baseSceneData } },
      sceneData: baseSceneData,
      shotIndex: 0,
      shotId: "shot_01",
      sceneId: "scene-1",
      shotMutator: (s) => ({ ...s, video_critic_failed: false }),
      clearSceneComposite: true,
    })

    expect(ok).toBe(true)
    const scene = (captured.metadata?.scene_node_data ?? {}) as Record<string, unknown>
    // The composite is invalidated so the re-enqueued drive re-animates the
    // scene (runSceneInternalPipeline short-circuits on composite_video_url).
    expect(scene.composite_video_url).toBeUndefined()
    expect(scene.composite_video_asset_id).toBeUndefined()
    // The shot mutation still applied + sibling shot untouched.
    const shots = scene.shots as Array<Record<string, unknown>>
    expect(shots[0]?.video_critic_failed).toBe(false)
    expect(shots[1]?.shot_id).toBe("shot_02")
  })

  it("keeps composite_video_url when clearSceneComposite is falsy (Skip / accept)", async () => {
    const { supabase, captured } = makeSupabase()

    await applyShotMutationAndEmit({
      supabase,
      reply: makeReply(),
      pipelineId: "p1",
      sceneEntity: { id: "scene-1", metadata: { scene_node_data: baseSceneData } },
      sceneData: baseSceneData,
      shotIndex: 0,
      shotId: "shot_01",
      sceneId: "scene-1",
      shotMutator: (s) => ({ ...s, video_critic_failed: false }),
      // clearSceneComposite omitted → user accepted the bad shot, composite stays
    })

    const scene = (captured.metadata?.scene_node_data ?? {}) as Record<string, unknown>
    expect(scene.composite_video_url).toBe("https://r2/old-composite.mp4")
    expect(scene.composite_video_asset_id).toBe("old-composite-asset")
  })
})
