import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import type { Shot } from "../shot"
import { buildClip, clipResults } from "../shot"
import { serializeProduction, parseProduction } from "../shot-graph"

/**
 * FreeCut parity (Task 1): a clip result's `freecutProjectUrl` (the saved FreeCut
 * project's URL, used to RESTORE the FreeCut layers on re-edit) must survive a
 * project reload. Studio persists clips by RE-EMITTING the production graph from
 * `shots[]` on every save, so the field needs BOTH a serialize hop (`videoNode`)
 * AND a parse hop (`readClipResults`) — exercised here through the public
 * `serializeProduction` -> `parseProduction` round-trip (the same path the
 * existing `references` round-trip test uses; `videoNode`/`readClipResults` are
 * private module helpers, not exports).
 *
 * The #1 trap: `buildClip` COLLAPSES a lone result to the bare `{ url }` shape
 * unless the keep-predicate says otherwise. A single edited clip carrying ONLY
 * `freecutProjectUrl` (no chips, no siblings — the common first-edit case) would
 * silently DROP the field on reload. So the predicate must also retain when a
 * result carries `freecutProjectUrl`.
 */
describe("freecutProjectUrl round-trip", () => {
  /** Serialize shots to a v2 settings object, then wrap as a loaded Workflow. */
  function asWorkflow(shots: Shot[], selectedShotId?: string): Workflow {
    const { nodes, edges, settings } = serializeProduction(shots, selectedShotId)
    return {
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    }
  }

  it("survives the LONE-result collapse in buildClip (not dropped to bare {url})", () => {
    // Lone result with ONLY freecutProjectUrl (the common first-edit case).
    const clip = buildClip(
      { nodeId: "generate-video-s1", provider: "freecut-edit", duration: 5 },
      [
        {
          url: "https://cdn/edited.mp4",
          freecutProjectUrl: "https://cdn/projects/p.json",
        },
      ],
      0,
    )
    // It must NOT collapse to the bare {url} shape (which would drop the field):
    // the results list is retained and the field is intact.
    expect(clipResults(clip)[0].freecutProjectUrl).toBe(
      "https://cdn/projects/p.json",
    )
  })

  it("survives serialize -> parse for a LONE edited clip result", () => {
    // A still-backed shot whose lone clip result carries only freecutProjectUrl.
    const edited: Shot = {
      id: "shot-c",
      still: {
        nodeId: "generate-image-s1",
        url: "https://cdn/still.png",
        provider: "nano-banana",
        prompt: "a shot",
      },
      clip: buildClip(
        { nodeId: "generate-video-s1", provider: "freecut-edit", duration: 5 },
        [
          {
            url: "https://cdn/edited.mp4",
            freecutProjectUrl: "https://cdn/projects/p.json",
          },
        ],
        0,
      ),
    }

    // The field rides on the per-result blob of the serialized generate-video node.
    const { nodes } = serializeProduction([edited], "shot-c")
    const vid = nodes.find((n) => n.type === "generate-video")
    expect(
      (vid?.data?.generatedResults as Array<Record<string, unknown>>)[0]
        .freecutProjectUrl,
    ).toBe("https://cdn/projects/p.json")

    // And the full shot round-trips exactly (parse reconstructs the field).
    const parsed = parseProduction(asWorkflow([edited], "shot-c")).shots
    expect(clipResults(parsed[0].clip!)[0].freecutProjectUrl).toBe(
      "https://cdn/projects/p.json",
    )
    expect(parsed).toEqual([edited])
  })
})
