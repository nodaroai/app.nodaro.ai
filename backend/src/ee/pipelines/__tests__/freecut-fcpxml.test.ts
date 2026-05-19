import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../lib/storage.js", () => ({
  uploadBufferToR2: vi
    .fn()
    .mockResolvedValue("https://r2/pipelines/p1/exports/freecut.fcpxml"),
}))

import { uploadBufferToR2 } from "../../../lib/storage.js"
import {
  generateFcpxmlExport,
  buildFcpxml,
  type FcpxmlSceneInput,
} from "../freecut-fcpxml.js"

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

function getUploadedXml(): string {
  const calls = (uploadBufferToR2 as ReturnType<typeof vi.fn>).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  const buffer = calls[0]![0] as Buffer
  return buffer.toString("utf-8")
}

const baseScenes: FcpxmlSceneInput[] = [
  {
    sceneEntityId: "scene-1",
    compositeUrl: "https://r2/scene-1.mp4",
    shots: [
      {
        shot_id: "shot_01",
        duration_seconds: 10,
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
    sceneEntityId: "scene-2",
    compositeUrl: "https://r2/scene-2.mp4",
    shots: [
      {
        shot_id: "shot_02",
        duration_seconds: 8,
        cut_decision: {
          in_offset_sec: 0,
          out_offset_sec: 0,
          transition_to_next: "hard_cut",
        },
      },
    ],
  },
]

describe("generateFcpxmlExport", () => {
  it("1. happy path — multi-scene + music + narration produces well-formed FCPXML 1.10", async () => {
    const supabase = makeSupabase()
    const result = await generateFcpxmlExport({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: baseScenes,
      musicAssetUrl: "https://r2/music.mp3",
      narrationAssetUrl: "https://r2/narr.mp3",
    })

    expect(result.exportAssetId).toBe("asset-1")
    expect(result.format).toBe("fcpxml-v1.10")
    expect(result.exportAssetUrl).toBe(
      "https://r2/pipelines/p1/exports/freecut.fcpxml",
    )

    // R2 upload received an application/xml body under the pipeline key.
    const uploadCall = (uploadBufferToR2 as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(uploadCall[1]).toMatch(/^pipelines\/p1\/exports\/freecut-.*\.fcpxml$/)
    expect(uploadCall[2]).toBe("application/xml")
    expect(uploadCall[3]).toBe("u1")

    const xml = getUploadedXml()
    expect(xml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`)
    expect(xml).toContain(`<fcpxml version="1.10">`)
    expect(xml).toContain(`<format id="r1"`)
    // Both scenes as assets.
    expect(xml).toContain(`name="scene-1"`)
    expect(xml).toContain(`name="scene-2"`)
    // Music + narration assets.
    expect(xml).toContain(`name="music"`)
    expect(xml).toContain(`name="narration"`)
    // Both audio overlays in the spine on negative lanes.
    expect(xml).toMatch(/<asset-clip[^>]*lane="-1"[^>]*name="music"/)
    expect(xml).toMatch(/<asset-clip[^>]*lane="-2"[^>]*name="narration"/)
    // Dissolve transition emitted between scene 1 and scene 2.
    expect(xml).toContain(`<transition name="Cross Dissolve"`)

    // Asset row written with the right shape.
    const inserts = (supabase as never as {
      _assetInserts: Array<Record<string, unknown>>
    })._assetInserts
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.type).toBe("document")
    expect(inserts[0]!.mime_type).toBe("application/xml")
    expect(inserts[0]!.pipeline_id).toBe("p1")
    expect(inserts[0]!.user_id).toBe("u1")
    expect(
      (inserts[0]!.metadata as { format: string }).format,
    ).toBe("fcpxml-v1.10")
  })

  it("2. music only (no narration) → 1 audio lane (-1), no narration asset", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
      pipelineId: "p1",
      userId: "u1",
      scenes: baseScenes,
      musicAssetUrl: "https://r2/music.mp3",
    })
    const xml = getUploadedXml()
    expect(xml).toMatch(/<asset-clip[^>]*lane="-1"[^>]*name="music"/)
    expect(xml).not.toMatch(/lane="-2"/)
    expect(xml).not.toContain(`name="narration"`)
  })

  it("3. narration only (no music) → 1 audio lane (-2), no music asset", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
      pipelineId: "p1",
      userId: "u1",
      scenes: baseScenes,
      musicAssetUrl: "",
      narrationAssetUrl: "https://r2/narr.mp3",
    })
    const xml = getUploadedXml()
    expect(xml).toMatch(/<asset-clip[^>]*lane="-2"[^>]*name="narration"/)
    expect(xml).not.toMatch(/lane="-1"/)
    expect(xml).not.toContain(`name="music"`)
  })

  it("4. no audio (no music, no narration) → no audio lanes", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
      pipelineId: "p1",
      userId: "u1",
      scenes: baseScenes,
      musicAssetUrl: "",
    })
    const xml = getUploadedXml()
    expect(xml).not.toMatch(/lane="-1"/)
    expect(xml).not.toMatch(/lane="-2"/)
    expect(xml).not.toContain(`name="music"`)
    expect(xml).not.toContain(`name="narration"`)
  })

  it("5. per-shot trim maps to start + duration on asset-clip", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
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
    const xml = getUploadedXml()
    // start = inOffset (0.5s), duration = fullDur - inOffset - outOffset
    // (5 - 0.5 - 0.3 = 4.2s).
    expect(xml).toMatch(/start="0.500s"/)
    expect(xml).toMatch(/duration="4.200s"/)
  })

  it("6. hard_cut transition emits NO <transition> element between clips", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/s1.mp4",
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
          compositeUrl: "https://r2/s2.mp4",
          shots: [{ shot_id: "shot_02", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
    })
    const xml = getUploadedXml()
    expect(xml).not.toContain(`<transition`)
  })

  it("7. match_cut transition emits NO <transition> element (FCP has no match-cut primitive)", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/s1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0,
                out_offset_sec: 0,
                transition_to_next: "match_cut",
              },
            },
          ],
        },
        {
          sceneEntityId: "scene-2",
          compositeUrl: "https://r2/s2.mp4",
          shots: [{ shot_id: "shot_02", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
    })
    const xml = getUploadedXml()
    expect(xml).not.toContain(`<transition`)
  })

  it("8. dissolve transition duration honored on <transition>", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/s1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 10,
              cut_decision: {
                in_offset_sec: 0,
                out_offset_sec: 0,
                transition_to_next: "dissolve",
                transition_duration_sec: 0.75,
              },
            },
          ],
        },
        {
          sceneEntityId: "scene-2",
          compositeUrl: "https://r2/s2.mp4",
          shots: [{ shot_id: "shot_02", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
    })
    const xml = getUploadedXml()
    expect(xml).toMatch(/<transition[^>]*name="Cross Dissolve"[^>]*duration="0.750s"/)
  })

  it("9. XML escaping handles special chars in pipelineId + scene URLs", () => {
    const xml = buildFcpxml({
      pipelineId: "p1 & <test>",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene.mp4?x=1&y=2",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
      narrationAssetUrl: "",
    })
    // Project name escaped.
    expect(xml).toContain(`name="Nodaro p1 &amp; &lt;test&gt;"`)
    // src URL escaped.
    expect(xml).toContain(`src="https://r2/scene.mp4?x=1&amp;y=2"`)
  })

  it("10. single-scene pipeline → 1 asset-clip, no transitions", async () => {
    await generateFcpxmlExport({
      supabase: makeSupabase(),
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/single.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0,
                out_offset_sec: 0,
                transition_to_next: "dissolve",
              },
            },
          ],
        },
      ],
      musicAssetUrl: "",
    })
    const xml = getUploadedXml()
    expect(xml).not.toContain(`<transition`)
    // Exactly one asset-clip in the spine (audio overlays are absent here).
    const matches = xml.match(/<asset-clip\b/g) ?? []
    expect(matches.length).toBe(1)
  })

  it("11. snapshot — 2-scene + music + narration", async () => {
    const xml = buildFcpxml({
      pipelineId: "pipe-abc",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/s1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 4,
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
          sceneEntityId: "scene-2",
          compositeUrl: "https://r2/s2.mp4",
          shots: [{ shot_id: "shot_02", duration_seconds: 3 }],
        },
      ],
      musicAssetUrl: "https://r2/music.mp3",
      narrationAssetUrl: "https://r2/narr.mp3",
    })
    expect(xml).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <fcpxml version="1.10">
        <resources>
          <format id="r1" name="FFVideoFormat1080p30" frameDuration="1001/30000s" width="1920" height="1080"/>
          <asset id="r2" name="scene-1" src="https://r2/s1.mp4" duration="4.000s" hasVideo="1" hasAudio="1" format="r1"/>
          <asset id="r3" name="scene-2" src="https://r2/s2.mp4" duration="3.000s" hasVideo="1" hasAudio="1" format="r1"/>
          <asset id="r4" name="music" src="https://r2/music.mp3" duration="6.500s" hasAudio="1"/>
          <asset id="r5" name="narration" src="https://r2/narr.mp3" duration="6.500s" hasAudio="1"/>
        </resources>
        <library>
          <event name="Nodaro Pipeline Export">
            <project name="Nodaro pipe-abc">
              <sequence format="r1" duration="6.500s">
                <spine>
                  <asset-clip ref="r2" offset="0.000s" duration="4.000s" start="0.000s" name="scene-1"/>
                  <transition name="Cross Dissolve" offset="3.500s" duration="0.500s"/>
                  <asset-clip ref="r3" offset="3.500s" duration="3.000s" start="0.000s" name="scene-2"/>
                  <asset-clip ref="r4" lane="-1" offset="0s" duration="6.500s" name="music"/>
                  <asset-clip ref="r5" lane="-2" offset="0s" duration="6.500s" name="narration"/>
                </spine>
              </sequence>
            </project>
          </event>
        </library>
      </fcpxml>
      "
    `)
  })
})
