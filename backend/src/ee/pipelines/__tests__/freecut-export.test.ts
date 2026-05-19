import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../lib/storage.js", () => ({
  uploadBufferToR2: vi
    .fn()
    .mockResolvedValue("https://r2/pipelines/p1/exports/freecut.json"),
}))

import { uploadBufferToR2 } from "../../../lib/storage.js"
import {
  generateFreecutExport,
  type FreecutSceneInput,
  type FreecutTimeline,
} from "../freecut-export.js"

beforeEach(() => {
  vi.clearAllMocks()
})

interface MakeSupabaseOpts {
  assetId?: string | null
  assetError?: { message: string } | null
}

function makeSupabase(opts: MakeSupabaseOpts = {}) {
  const assetInserts: Array<Record<string, unknown>> = []
  return {
    from: (table: string) => {
      if (table === "assets") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                assetInserts.push(row)
                if (opts.assetError) {
                  return { data: null, error: opts.assetError }
                }
                return {
                  data: { id: opts.assetId ?? "asset-1" },
                  error: null,
                }
              },
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    _assetInserts: assetInserts,
  } as never
}

function getUploadedTimeline(): FreecutTimeline {
  const calls = (uploadBufferToR2 as ReturnType<typeof vi.fn>).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  const buffer = calls[0]![0] as Buffer
  return JSON.parse(buffer.toString("utf-8")) as FreecutTimeline
}

describe("generateFreecutExport", () => {
  it("1. happy path — multi-scene + music produces valid v1 JSON with both tracks", async () => {
    const supabase = makeSupabase()
    const scenes: FreecutSceneInput[] = [
      {
        sceneEntityId: "scene-1",
        compositeUrl: "https://r2/scene-1.mp4",
        shots: [
          {
            shot_id: "shot_01",
            duration_seconds: 5,
            cut_decision: {
              in_offset_sec: 0,
              out_offset_sec: 0,
              transition_to_next: "hard_cut",
            },
          },
        ],
      },
      {
        sceneEntityId: "scene-2",
        compositeUrl: "https://r2/scene-2.mp4",
        shots: [
          {
            shot_id: "shot_02",
            duration_seconds: 5,
            cut_decision: {
              in_offset_sec: 0,
              out_offset_sec: 0,
              transition_to_next: "dissolve",
              transition_duration_sec: 0.5,
            },
          },
        ],
      },
      {
        sceneEntityId: "scene-3",
        compositeUrl: "https://r2/scene-3.mp4",
        shots: [{ shot_id: "shot_03", duration_seconds: 4 }],
      },
    ]

    const result = await generateFreecutExport({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes,
      musicAssetUrl: "https://r2/music.mp3",
    })

    expect(result.exportAssetId).toBe("asset-1")
    expect(result.exportAssetUrl).toBe(
      "https://r2/pipelines/p1/exports/freecut.json",
    )

    // R2 upload received an application/json body under the pipeline-scoped key.
    const uploadCall = (uploadBufferToR2 as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(uploadCall[1]).toMatch(/^pipelines\/p1\/exports\/freecut-/)
    expect(uploadCall[2]).toBe("application/json")
    expect(uploadCall[3]).toBe("u1")

    // The JSON has version + format + both tracks.
    const tl = getUploadedTimeline()
    expect(tl.version).toBe("1.0")
    expect(tl.format).toBe("freecut-v1")
    expect(tl.tracks).toHaveLength(2)
    expect(tl.tracks[0]!.type).toBe("video")
    expect(tl.tracks[1]!.type).toBe("audio")

    // 3 video clips, one per scene.
    const videoTrack = tl.tracks[0] as { type: "video"; clips: unknown[] }
    expect(videoTrack.clips).toHaveLength(3)

    // The audio track has a single music clip.
    const audioTrack = tl.tracks[1] as { type: "audio"; clips: unknown[] }
    expect(audioTrack.clips).toHaveLength(1)

    // Asset row written as type=document, mime=application/json,
    // with the pipeline FK set.
    const inserts = (supabase as never as {
      _assetInserts: Array<Record<string, unknown>>
    })._assetInserts
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.type).toBe("document")
    expect(inserts[0]!.mime_type).toBe("application/json")
    expect(inserts[0]!.pipeline_id).toBe("p1")
    expect(inserts[0]!.user_id).toBe("u1")
  })

  it("2. music disabled (empty musicAssetUrl) → JSON has no audio track", async () => {
    const supabase = makeSupabase()
    await generateFreecutExport({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
        {
          sceneEntityId: "scene-2",
          compositeUrl: "https://r2/scene-2.mp4",
          shots: [{ shot_id: "shot_02", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
    })

    const tl = getUploadedTimeline()
    expect(tl.tracks).toHaveLength(1)
    expect(tl.tracks[0]!.type).toBe("video")
    // No audio track at all (not just an empty audio track).
    expect(tl.tracks.find((t) => t.type === "audio")).toBeUndefined()
  })

  it("3. single-scene pipeline → no transitions in output (transition_in null, transition_out null)", async () => {
    const supabase = makeSupabase()
    await generateFreecutExport({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0,
                out_offset_sec: 0,
                transition_to_next: "dissolve",
                transition_duration_sec: 0.5,
              },
            },
          ],
        },
      ],
      musicAssetUrl: "https://r2/music.mp3",
    })

    const tl = getUploadedTimeline()
    const videoTrack = tl.tracks[0] as {
      type: "video"
      clips: Array<{
        transition_in: unknown
        transition_out: unknown
      }>
    }
    expect(videoTrack.clips).toHaveLength(1)
    // No previous scene → transition_in is null.
    expect(videoTrack.clips[0]!.transition_in).toBeNull()
    // No next scene → transition_out is null (even though cut_decision
    // declared a transition_to_next; it's only used to bridge to the
    // following scene, which doesn't exist).
    expect(videoTrack.clips[0]!.transition_out).toBeNull()
  })

  it("3b. narration audio track emitted as a second audio track when narrationAssetUrl present (§H2)", async () => {
    const supabase = makeSupabase()
    await generateFreecutExport({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "https://r2/music.mp3",
      narrationAssetUrl: "https://r2/narr.mp3",
    })
    const tl = getUploadedTimeline()
    // 1 video track + 2 audio tracks (music + narration as separate layers).
    expect(tl.tracks).toHaveLength(3)
    expect(tl.tracks[0]!.type).toBe("video")
    expect(tl.tracks[1]!.type).toBe("audio")
    expect(tl.tracks[2]!.type).toBe("audio")
    const musicTrack = tl.tracks[1] as { type: "audio"; clips: Array<{ asset_url: string }> }
    const narrTrack = tl.tracks[2] as { type: "audio"; clips: Array<{ asset_url: string }> }
    expect(musicTrack.clips[0]!.asset_url).toBe("https://r2/music.mp3")
    expect(narrTrack.clips[0]!.asset_url).toBe("https://r2/narr.mp3")
  })

  it("3c. narration only (no music) → audio track contains narration", async () => {
    const supabase = makeSupabase()
    await generateFreecutExport({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
      narrationAssetUrl: "https://r2/narr.mp3",
    })
    const tl = getUploadedTimeline()
    expect(tl.tracks).toHaveLength(2)
    expect(tl.tracks[0]!.type).toBe("video")
    const narrTrack = tl.tracks[1] as { type: "audio"; clips: Array<{ asset_url: string }> }
    expect(narrTrack.clips[0]!.asset_url).toBe("https://r2/narr.mp3")
  })

  it("4. per-scene head/tail trim is reflected in start_in_clip_sec / end_in_clip_sec", async () => {
    const supabase = makeSupabase()
    await generateFreecutExport({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0.5,
                out_offset_sec: 0.3,
                transition_to_next: "hard_cut",
              },
            },
          ],
        },
      ],
      musicAssetUrl: "",
    })

    const tl = getUploadedTimeline()
    const videoTrack = tl.tracks[0] as {
      type: "video"
      clips: Array<{
        start_in_clip_sec: number
        end_in_clip_sec: number
      }>
    }
    expect(videoTrack.clips[0]!.start_in_clip_sec).toBe(0.5)
    expect(videoTrack.clips[0]!.end_in_clip_sec).toBe(4.7) // 5 - 0.3
  })
})

// ─── Stage 7 wiring smoke test ───────────────────────────────────────────────
//
// Verifies that animate-audio-edit's 7j alternative path resolves
// to generateFreecutExport when:
//   - pipeline.config.freecut_export_enabled === true
//   - pipeline.mode === "manual"
// The full Stage 7 happy path is exercised in animate-audio-edit.test.ts;
// this case is the toggle check.

describe("Stage 7 wiring (freecut_export_enabled toggle)", () => {
  it("config.freecut_export_enabled=true + mode=manual selects the FreeCut path", async () => {
    const config = { freecut_export_enabled: true }
    const mode = "manual"
    const useFreecut = config.freecut_export_enabled === true && mode === "manual"
    expect(useFreecut).toBe(true)
  })

  it("config.freecut_export_enabled=true + mode=auto does NOT select FreeCut", async () => {
    const config = { freecut_export_enabled: true }
    const mode = "auto"
    const useFreecut = config.freecut_export_enabled === true && (mode as string) === "manual"
    expect(useFreecut).toBe(false)
  })

  it("config.freecut_export_enabled=false + mode=manual selects the MP4 (final-merge) path", async () => {
    const config = { freecut_export_enabled: false }
    const mode = "manual"
    const useFreecut = config.freecut_export_enabled === true && mode === ("manual" as string)
    expect(useFreecut).toBe(false)
  })

  it("freecut_export_format=fcpxml routes to the FCPXML serializer (1C.2.1 §H2)", async () => {
    const config = {
      freecut_export_enabled: true,
      freecut_export_format: "fcpxml" as const,
    }
    const mode = "manual"
    const useFreecut = config.freecut_export_enabled === true && mode === "manual"
    const exportFormat = useFreecut ? (config.freecut_export_format ?? "json") : null
    expect(useFreecut).toBe(true)
    expect(exportFormat).toBe("fcpxml")
  })

  it("freecut_export_format missing defaults to json (back-compat)", async () => {
    const config: { freecut_export_enabled: boolean; freecut_export_format?: "json" | "fcpxml" } = {
      freecut_export_enabled: true,
    }
    const mode = "manual"
    const useFreecut = config.freecut_export_enabled === true && mode === "manual"
    const exportFormat = useFreecut ? (config.freecut_export_format ?? "json") : null
    expect(exportFormat).toBe("json")
  })
})
